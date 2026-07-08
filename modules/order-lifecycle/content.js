// Casto Tools — module « Suivi de commande — Cycle de vie » (v1.3.0)
// Port 1:1 du userscript Tampermonkey éponyme :
//   Cde achat → ASN → Transit → Réception, via l'API Agent, timeline FR,
//   notifications d'évolution, injection d'une entrée de menu dans Com+.
//
// Différences avec le userscript (voir README) :
//   - GM_get/setValue          → chrome.storage.local (core/storage.js)
//   - GM_xmlhttpRequest        → proxy du service worker (CastoTools.request)
//   - hook XHR de capture auth → chrome.webRequest dans le service worker
//   - GM_addStyle              → styles.css injecté par le manifest
'use strict';

(() => {

    // -----------------------------
    // CONFIG
    // -----------------------------
    const STORAGE_KEY = 'lifecycleOrders_kfplc';
    const CHECK_INTERVAL_MS = 5 * 60 * 1000;      // boucle de vérification
    const RECHECK_THRESHOLD_MS = 15 * 60 * 1000;  // re-check d'une commande au plus toutes les 15 min
    const BULLETIN_DE_VENTE_LI_SELECTOR = 'li:has(a[data-auto="menu-dropdown-core.menu.titles.orders-core.menu.titles.basket"])';

    let trackedOrders = [];
    let mainPopup = null;
    let popupOverlay = null;
    let ordersContainer = null;
    let orderInput = null;

    // -----------------------------
    // AUTH (capturée par le service worker — clés partagées avec le script SAP)
    // -----------------------------
    async function hasAgentHeaders() {
        const auth = await castoStorage.get('sap_agent_auth', { headers: {} });
        return Object.keys((auth && auth.headers) || {}).length > 0;
    }

    // -----------------------------
    // REQUEST HELPERS (délégués au service worker)
    // -----------------------------
    function agentRequest({ method, url, data = null, headers = {}, timeout = 30000 }) {
        return CastoTools.request('agent', { method, url, data, headers, timeout });
    }

    function kdRequest({ method, url, data = null, headers = {}, timeout = 15000 }) {
        return CastoTools.request('kd', { method, url, data, headers, timeout });
    }

    async function validateKfplcAuth() {
        try {
            const r = await kdRequest({ method: 'GET', url: 'https://dc.dps.kd.kfplc.com/auth/validate/oauth2' });
            return r.status >= 200 && r.status < 300;
        } catch { return false; }
    }

    async function tryWithAuthValidate(doRequest) {
        try {
            const r1 = await doRequest();
            if (r1 && r1.status >= 200 && r1.status < 300) return r1;
            await validateKfplcAuth();
            return doRequest();
        } catch (e) {
            await validateKfplcAuth();
            return doRequest();
        }
    }

    // -----------------------------
    // DÉTECTION D'ERREUR DE CONNEXION (session Com+ expirée)
    // -----------------------------
    // Une session expirée se manifeste soit par un statut 401/403,
    // soit par une page de login renvoyée à la place des données.
    function isAuthProblem(response) {
        if (!response) return false;
        if (response.status === 401 || response.status === 403) return true;
        // Redirection vers une page de connexion : l'URL finale change
        const finalUrl = (response.finalUrl || '').toLowerCase();
        if (/login|signin|sso|cas|auth|logon/i.test(finalUrl) && !finalUrl.includes('order')) return true;
        // Ou : le corps de la réponse est une page de login
        const body = (response.responseText || '').slice(0, 5000).toLowerCase();
        return /j_security_check|mot de passe|type="password"|se connecter|session expirée|veuillez vous (re)?connecter/i.test(body);
    }
    function authError(step) {
        const e = new Error(`Session expirée (étape ${step})`);
        e.isAuthError = true;
        return e;
    }

    // -----------------------------
    // ÉTAPE 1 — orderNumber → atgOrderId
    // -----------------------------
    function fetchAtgOrderId(orderNumber) {
        const url = `https://prod-agent.castorama.fr/agent-front/jsp/storeStart/responseOrderStatusFindJson.jsp?orderNumber=${orderNumber}`;
        return tryWithAuthValidate(() => agentRequest({ method: "GET", url }))
            .then((response) => {
                if (isAuthProblem(response)) throw authError(1);
                if (response.status < 200 || response.status >= 300) throw new Error(`Erreur API (étape 1) status ${response.status}`);
                let data; try { data = JSON.parse(response.responseText); }
                catch (e) {
                    // Du HTML au lieu du JSON attendu = session Com+ morte dans la quasi-totalité des cas
                    throw authError(1);
                }
                const m = data.vieworderurl && data.vieworderurl.match(/orderId=([^&]+)/);
                if (m && m[1]) return m[1];
                // JSON valide mais sans vieworderurl : si la réponse est quasi vide,
                // c'est très probablement la session qui est tombée, pas la commande qui est inconnue.
                if (!data || Object.keys(data).length === 0) throw authError(1);
                throw new Error("Impossible d'extraire orderId (ATG).");
            });
    }

    // -----------------------------
    // ÉTAPE 2 — parser TOUT le tableau "Suivi de commande"
    // -----------------------------
    // Renvoie une liste d'événements : { docNumber, fournisseurNo, type, dateStr, qty, statut, supplier }
    function fetchOrderEvents(atgOrderId) {
        const url = `https://prod-agent.castorama.fr/agent-front/jsp/customer/order.jsp?orderId=${atgOrderId}`;
        return tryWithAuthValidate(() => agentRequest({
            method: "POST",
            url,
            data: "",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }
        })).then((response) => {
            if (isAuthProblem(response)) throw authError(2);
            if (response.status < 200 || response.status >= 300) throw new Error(`Erreur API (étape 2) status ${response.status}`);
            return {
                events: parseSuiviTables(response.responseText),
                clientName: parseClientName(response.responseText)
            };
        });
    }

    // Le nom du client n'est PAS dans le texte visible : il est dans un commentaire HTML
    // du type <!-- HardgoodShippingGroupDTO [... firstName=CASTORAMA, lastName=SAV,
    // alternativeContact=DURIEUX JULIE ...] -->. On fouille donc le HTML brut.
    function parseClientName(html) {
        // helper : extrait "clé=valeur" dans le blob DTO, en s'arrêtant à la virgule/crochet suivant
        const grab = (key) => {
            const m = html.match(new RegExp(key + '=([^,\\]\\r\\n]+)'));
            if (!m) return '';
            const v = m[1].trim();
            return (v && v !== '<null>' && v !== 'undefined' && v !== 'null') ? v : '';
        };

        const first = grab('firstName');
        const last  = grab('lastName');
        if (first || last) return [first, last].filter(Boolean).join(' ');

        // Fallback : contact alternatif (souvent le vrai nom de la personne)
        const alt = grab('alternativeContact');
        if (alt) return alt;

        // Dernier recours : displayName
        return grab('displayName');
    }

    // Parse le HTML : trouve chaque tableau dont l'en-tête contient "N° document"
    // et récupère le nom fournisseur (heading juste avant le tableau, ex. "CETIH ROANNE") si présent.
    function parseSuiviTables(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const events = [];
        const seen = new Set(); // anti-doublons

        // On ne garde que les tableaux "feuilles" : ceux qui ne contiennent PAS
        // eux-mêmes un autre tableau correspondant (évite de lire 2x les tables imbriquées)
        let tables = Array.from(doc.querySelectorAll('table')).filter(t => {
            const headText = t.textContent || '';
            return /N°\s*document/i.test(headText) && /Type de document/i.test(headText);
        });
        tables = tables.filter(t => !tables.some(other => other !== t && t.contains(other)));

        tables.forEach(table => {
            // Lire les en-têtes pour savoir quelle colonne contient quoi
            const headerCells = Array.from(table.querySelectorAll('th'));
            const colIndex = { doc: -1, fournisseur: -1, type: -1, date: -1, qty: -1, statut: -1 };
            headerCells.forEach((th, i) => {
                const t = (th.textContent || '').toLowerCase();
                if (t.includes('document') && t.includes('n°')) colIndex.doc = i;
                else if (t.includes('fournisseur')) colIndex.fournisseur = i;
                else if (t.includes('type')) colIndex.type = i;
                else if (t.includes('date')) colIndex.date = i;
                else if (t.includes('qté') || t.includes('qte') || t.includes('quantité')) colIndex.qty = i;
                else if (t.includes('statut')) colIndex.statut = i;
            });
            // Fournisseur : on remonte les éléments précédents pour trouver un texte court en majuscules
            let supplier = '';
            let prev = table.previousElementSibling;
            let hops = 0;
            while (prev && hops < 5) {
                const txt = (prev.textContent || '').trim();
                if (txt && txt.length < 60 && !/N°\s*document/i.test(txt) && !/Suivi de commande/i.test(txt)) {
                    supplier = txt;
                    break;
                }
                prev = prev.previousElementSibling; hops++;
            }

            const rows = Array.from(table.querySelectorAll('tr'))
                // ne garder que les lignes appartenant directement à CE tableau (pas à un tableau imbriqué)
                .filter(tr => tr.closest('table') === table)
                .filter(tr => tr.querySelectorAll('td').length > 0);

            rows.forEach(tr => {
                const cells = Array.from(tr.querySelectorAll('td'))
                    .filter(td => td.closest('table') === table)
                    .map(td => (td.textContent || '').trim());
                if (!cells.length) return;

                const pick = (idx, fallbackIdx) => {
                    if (idx >= 0 && idx < cells.length) return cells[idx];
                    return (fallbackIdx >= 0 && fallbackIdx < cells.length) ? cells[fallbackIdx] : '';
                };
                const docNumber     = pick(colIndex.doc, 0);
                const fournisseurNo = pick(colIndex.fournisseur, 1);
                const type          = pick(colIndex.type, 2);
                const dateStr       = pick(colIndex.date, 3);
                const qty           = pick(colIndex.qty, 4);
                const statut        = pick(colIndex.statut, 5);

                if (!type && !docNumber) return; // ligne vide

                const key = `${docNumber}|${type}|${dateStr}|${statut}`;
                if (seen.has(key)) return; // doublon → on ignore
                seen.add(key);

                events.push({ docNumber, fournisseurNo, type, dateStr, qty, statut, supplier });
            });
        });
        return events;
    }

    // -----------------------------
    // MAPPING DES ÉTAPES (libellés FR + ordre logique)
    // -----------------------------
    function classifyEvent(ev) {
        const t = (ev.type || '').toLowerCase();
        if (t.includes('cde achat'))      return { stage: 1, label: 'Commande reçue par le fournisseur', icon: '📝' };
        if (t.includes('asn'))            return { stage: 2, label: 'Expédition annoncée (ASN)',          icon: '📦' };
        if (t.includes('transit'))        return { stage: 3, label: 'Marchandise en transit',             icon: '🚚' };
        if (t.includes('réception') || t.includes('reception'))
                                          return { stage: 4, label: 'Réceptionné en magasin',             icon: '✅' };
        return { stage: 0, label: ev.type || 'Événement', icon: '•' };
    }

    // Clé unique d'un événement pour détecter les nouveautés
    const eventKey = (ev) => `${ev.type}|${ev.docNumber}|${ev.dateStr}|${ev.statut}`;

    // Date FR "28-03-2026" → timestamp pour trier (fallback : ordre d'apparition)
    function parseFrDate(s) {
        const m = (s || '').match(/(\d{2})-(\d{2})-(\d{4})/);
        return m ? new Date(`${m[3]}-${m[2]}-${m[1]}`).getTime() : 0;
    }

    // -----------------------------
    // WORKFLOW DE VÉRIFICATION
    // -----------------------------
    async function checkOrder(order) {
        updateOrder(order.orderNumber, { status: "vérification...", lastCheckedTimestamp: Date.now() });
        try {
            const atgOrderId = order.atgOrderId || await fetchAtgOrderId(order.orderNumber);
            const { events, clientName } = await fetchOrderEvents(atgOrderId);

            const knownKeys = new Set((order.events || []).map(eventKey));
            const newEvents = events.filter(ev => !knownKeys.has(eventKey(ev)));

            // SAP = premier N° document commençant par 6 sur une ligne "Cde achat"
            let sapNumber = order.sapNumber;
            if (!sapNumber) {
                const cde = events.find(ev => /cde achat/i.test(ev.type) && /^6\d{5,}/.test(ev.docNumber));
                if (cde) sapNumber = cde.docNumber;
            }

            const received = events.some(ev => /réception|reception/i.test(ev.type));
            const highest = events.reduce((mx, ev) => Math.max(mx, classifyEvent(ev).stage), 0);

            updateOrder(order.orderNumber, {
                atgOrderId,
                events,
                sapNumber: sapNumber || null,
                supplier: events[0]?.supplier || order.supplier || '',
                clientName: clientName || order.clientName || '',
                status: received ? "Réceptionné ✔" :
                        highest >= 3 ? "En transit" :
                        highest >= 2 ? "Expédié (ASN)" :
                        highest >= 1 ? "Commande créée" : "en attente",
                closed: received,
                lastCheckedTimestamp: Date.now()
            });

            // Notification pour chaque étape nouvelle et significative
            newEvents.forEach(ev => {
                const c = classifyEvent(ev);
                if (c.stage > 0 && order.events && order.events.length > 0) {
                    showNotification(order.orderNumber, c, ev, sapNumber);
                }
            });
            // Première vérification : notifier seulement si SAP vient d'être trouvé
            if ((!order.events || order.events.length === 0) && sapNumber && !order.sapNumber) {
                showNotification(order.orderNumber, { stage: 1, label: 'Commande reçue par le fournisseur', icon: '📝' },
                                 events.find(ev => ev.docNumber === sapNumber) || {}, sapNumber);
            }
        } catch (error) {
            console.error(`[Casto Tools · Suivi] Erreur commande ${order.orderNumber}:`, error);
            updateOrder(order.orderNumber, {
                status: error && error.isAuthError ? "Reconnecter Com+" : "erreur API",
                lastCheckedTimestamp: Date.now()
            });
        }
    }

    async function periodicCheck() {
        const now = Date.now();
        await loadOrders();
        trackedOrders.forEach(order => {
            if (!order.closed && (now - (order.lastCheckedTimestamp || 0) > RECHECK_THRESHOLD_MS)) {
                checkOrder(order);
            }
        });
    }

    // -----------------------------
    // DATA MGMT
    // -----------------------------
    function formatTimestamp(ts) { return ts ? new Date(ts).toLocaleString('fr-FR') : 'N/A'; }
    async function loadOrders() {
        const stored = await castoStorage.get(STORAGE_KEY, []);
        trackedOrders = Array.isArray(stored) ? stored : [];
    }
    function saveOrders() { castoStorage.set(STORAGE_KEY, trackedOrders); }
    function addOrderToTrack(orderNumberStr) {
        const orderNumber = orderNumberStr.trim();
        if (!orderNumber || !/^\d+$/.test(orderNumber)) { alert("Veuillez entrer un numéro de commande valide (chiffres uniquement)."); return; }
        if (trackedOrders.some(o => o.orderNumber === orderNumber)) { alert("Cette commande est déjà suivie."); return; }
        const newOrder = {
            orderNumber, atgOrderId: null, sapNumber: null, supplier: '',
            events: [], status: "en attente", closed: false,
            addedTimestamp: Date.now(), lastCheckedTimestamp: 0
        };
        trackedOrders.push(newOrder);
        saveOrders(); renderOrders();
        checkOrder(newOrder);
    }
    function deleteOrder(orderNumber) {
        trackedOrders = trackedOrders.filter(o => o.orderNumber !== orderNumber);
        saveOrders(); renderOrders();
    }
    function updateOrder(orderNumber, updates) {
        const idx = trackedOrders.findIndex(o => o.orderNumber === orderNumber);
        if (idx > -1) { trackedOrders[idx] = { ...trackedOrders[idx], ...updates }; saveOrders(); renderOrders(); }
    }

    // -----------------------------
    // UI
    // -----------------------------
    function createMainPopup() {
        if (!document.getElementById('lc-overlay')) {
            popupOverlay = document.createElement('div');
            popupOverlay.id = 'lc-overlay';
            popupOverlay.className = 'casto-ui';
            document.body.appendChild(popupOverlay);
            popupOverlay.addEventListener('click', toggleMainPopup);
        } else popupOverlay = document.getElementById('lc-overlay');

        if (!document.getElementById('lc-popup')) {
            mainPopup = document.createElement('div');
            mainPopup.id = 'lc-popup';
            mainPopup.className = 'casto-ui';
            mainPopup.style.display = 'none';
            mainPopup.innerHTML = `
                <h3><span class="lc-brand-dash"></span>Suivi de commande — Cycle de vie</h3>
                <div class="input-area">
                    <input type="text" id="lc-order-input" placeholder="Entrer numéro de commande...">
                    <button id="lc-add-btn" class="casto-btn casto-btn-accent">Suivre</button>
                </div>
                <div id="lc-orders"></div>
                <button id="lc-close-btn" class="casto-btn casto-btn-ghost">Fermer</button>
            `;
            document.body.appendChild(mainPopup);
            ordersContainer = document.getElementById('lc-orders');
            orderInput = document.getElementById('lc-order-input');
            document.getElementById('lc-add-btn').addEventListener('click', () => { addOrderToTrack(orderInput.value); orderInput.value = ''; });
            orderInput.addEventListener('keydown', e => { if (e.key === 'Enter') { addOrderToTrack(orderInput.value); orderInput.value = ''; } });
            document.getElementById('lc-close-btn').addEventListener('click', toggleMainPopup);
        } else mainPopup = document.getElementById('lc-popup');
    }

    function badgeFor(order) {
        const s = (order.status || '').toLowerCase();
        if (s.includes('vérification')) return ['check', order.status];
        if (s.includes('reconnecter'))  return ['auth', 'Reconnecter Com+'];
        if (s.includes('erreur'))       return ['err', 'Erreur API'];
        if (order.closed)               return ['done', 'Réceptionné ✔'];
        if (s.includes('transit'))      return ['transit', 'En transit'];
        if (s.includes('asn') || s.includes('expédié')) return ['asn', 'Expédié (ASN)'];
        if (s.includes('créée'))        return ['created', 'Commande créée'];
        return ['wait', 'En attente'];
    }

    function renderOrders() {
        if (!ordersContainer) return;
        ordersContainer.innerHTML = '';
        if (!trackedOrders.length) {
            ordersContainer.innerHTML = '<div class="lc-empty">Aucune commande suivie. Ajoutez un numéro ci-dessus.</div>';
            return;
        }

        trackedOrders.forEach(order => {
            const [cls, txt] = badgeFor(order);
            const card = document.createElement('div');
            card.className = 'lc-card';

            // Timeline triée : par étape puis par date
            const evts = (order.events || []).slice().sort((a, b) => {
                const sa = classifyEvent(a).stage, sb = classifyEvent(b).stage;
                if (sa !== sb) return sa - sb;
                return parseFrDate(a.dateStr) - parseFrDate(b.dateStr);
            });

            const timelineHtml = evts.length
                ? '<ul class="lc-timeline">' + evts.map(ev => {
                    const c = classifyEvent(ev);
                    const doc = ev.docNumber ? `<span class="lc-doc">n° ${ev.docNumber}</span>` : '';
                    const date = ev.dateStr ? `<span class="lc-date">${ev.dateStr}</span>` : '';
                    const st = ev.statut ? ` — ${ev.statut}` : '';
                    return `<li class="s${c.stage}">${c.icon} ${c.label}${st}${date}${doc}</li>`;
                  }).join('') + '</ul>'
                : '<div class="lc-no-event">Aucun événement pour l’instant.</div>';

            card.innerHTML = `
                <div class="lc-card-head">
                    <span class="lc-title">Commande ${order.orderNumber}</span>
                    <span class="lc-supplier">${order.clientName ? `👤 ${order.clientName}` : ''}${order.clientName && order.supplier ? ' · ' : ''}${order.supplier || ''}</span>
                    <span class="lc-badge ${cls}">${txt}</span>
                </div>
                ${order.sapNumber ? `<div class="lc-sap">N° SAP : <strong title="Cliquer pour copier">${order.sapNumber}</strong></div>` : ''}
                ${timelineHtml}
                <div class="lc-card-foot">
                    <span>Ajouté : ${formatTimestamp(order.addedTimestamp)} · Dernier check : ${formatTimestamp(order.lastCheckedTimestamp)}</span>
                    <span><span class="lc-refresh" title="Vérifier maintenant">↻ Actualiser</span><span class="lc-del" title="Supprimer du suivi">✕</span></span>
                </div>
            `;

            const sapEl = card.querySelector('.lc-sap strong');
            if (sapEl) sapEl.addEventListener('click', () => {
                navigator.clipboard.writeText(order.sapNumber).then(() => alert('N° SAP copié !')).catch(() => {});
            });
            card.querySelector('.lc-del').addEventListener('click', () => deleteOrder(order.orderNumber));
            card.querySelector('.lc-refresh').addEventListener('click', () => checkOrder(order));

            ordersContainer.appendChild(card);
        });
    }

    function toggleMainPopup() {
        if (!mainPopup || !popupOverlay) createMainPopup();
        const isVisible = mainPopup.style.display === 'block';
        mainPopup.style.display = isVisible ? 'none' : 'block';
        popupOverlay.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) { loadOrders().then(renderOrders); }
    }

    // -----------------------------
    // NOTIFICATIONS D'ÉVOLUTION
    // -----------------------------
    function showNotification(orderNumber, classif, ev, sapNumber) {
        const existing = document.getElementById('lc-dyn-notif');
        if (existing) existing.remove();
        const n = document.createElement('div');
        n.id = 'lc-dyn-notif';
        n.className = 'lc-notif casto-ui';
        n.innerHTML = `
            <h4>${classif.icon} ${classif.label}</h4>
            <p>Commande <strong>${orderNumber}</strong>${sapNumber ? ` · SAP <strong>${sapNumber}</strong>` : ''}</p>
            ${ev.dateStr ? `<p>Date : <strong>${ev.dateStr}</strong>${ev.docNumber ? ` · Document n° <strong>${ev.docNumber}</strong>` : ''}</p>` : ''}
            <button class="casto-btn casto-btn-primary">OK</button>
        `;
        document.body.appendChild(n);
        n.querySelector('button').addEventListener('click', () => n.remove());
    }

    // -----------------------------
    // MENU INJECTION
    // -----------------------------
    function injectMenuItem() {
        if (document.getElementById('lc-menu-item')) return;
        const referenceLi = document.querySelector(BULLETIN_DE_VENTE_LI_SELECTOR);
        if (referenceLi) {
            const newLi = document.createElement('li');
            newLi.id = 'lc-menu-item';
            const a = document.createElement('a');
            a.href = "#";
            a.textContent = "Suivi de commande";
            a.addEventListener('click', (e) => { e.preventDefault(); toggleMainPopup(); });
            newLi.appendChild(a);
            referenceLi.parentNode.insertBefore(newLi, referenceLi.nextSibling);
        }
    }

    let observerAttached = false;
    const menuObserver = new MutationObserver((mut, obs) => {
        if (document.querySelector(BULLETIN_DE_VENTE_LI_SELECTOR) && !document.getElementById('lc-menu-item')) {
            injectMenuItem(); obs.disconnect(); observerAttached = false;
        } else if (document.getElementById('lc-menu-item')) { obs.disconnect(); observerAttached = false; }
    });

    function attemptAttachMenuObserver() {
        const menuContainer = document.getElementById('menu');
        if (menuContainer) {
            menuObserver.observe(menuContainer, { childList: true, subtree: true });
            observerAttached = true;
            setTimeout(() => {
                if (observerAttached) { injectMenuItem(); menuObserver.disconnect(); observerAttached = false; }
            }, 5000);
        } else setTimeout(attemptAttachMenuObserver, 1000);
    }

    // -----------------------------
    // INIT
    // -----------------------------
    async function init() {
        await loadOrders();
        createMainPopup();

        const now = Date.now();
        trackedOrders.forEach(order => {
            if (!order.closed && (now - (order.lastCheckedTimestamp || 0) > RECHECK_THRESHOLD_MS)) {
                setTimeout(() => checkOrder(order), Math.random() * 5000 + 1000);
            }
        });

        setInterval(periodicCheck, CHECK_INTERVAL_MS);
        attemptAttachMenuObserver();
        console.log("[Casto Tools · Suivi] Cycle de vie des commandes v1.3.0 initialisé.");
        if (!(await hasAgentHeaders())) console.warn('[Casto Tools · Suivi] En attente de capture prod-agent. Interagissez avec l’Agent si nécessaire.');
    }

    CastoTools.register('order-lifecycle', init);

})();
