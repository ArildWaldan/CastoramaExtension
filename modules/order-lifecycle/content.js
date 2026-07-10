// Casto Tools — module « Suivi de commande » (v1.7.1)
// Cde achat → ASN → Transit → Réception, via l'API Agent, timeline FR,
// notifications d'évolution.
//
// Depuis la v1.4.0 le module tourne directement sur Com+
// (prod-agent.castorama.fr, agent-front) — là où les commandes sont gérées —
// au lieu de dc.kfplc.com : un bouton « Suivi de commande » est injecté dans
// le bloc « Commandes / N° de dossier » de la page d'accueil agent (main.jsp),
// et l'UI du panneau suit la refonte « Timeline guidée » (cf. styles.css).
//
// Différences avec le userscript d'origine (voir README) :
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
    // Bloc « Commandes / N° de dossier » de la page d'accueil agent (main.jsp) :
    // point d'ancrage du bouton « Suivi de commande » (cf. spec d'intégration).
    const ORDER_PANEL_SELECTOR = '.col2.start-panel.js-view-order';

    let trackedOrders = [];
    let mainPopup = null;
    let popupOverlay = null;
    let ordersContainer = null;
    let orderInput = null;
    // Cartes dépliées (les cartes sont repliées par défaut : en-tête +
    // tracker seuls). En mémoire seulement : survit aux re-renders de la
    // session, pas à un rechargement de page.
    const expandedOrders = new Set();

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
    // ÉTAPE 2 — parser la page commande, LIGNE PAR LIGNE
    // -----------------------------
    // Une commande peut avoir plusieurs lignes (articles) qui avancent chacune
    // à leur rythme (l'une réceptionnée, l'autre bloquée chez le fournisseur).
    // Chaque ligne est un <tr label="..."> dont le flyout « Suivi de
    // commande » contient les événements propres à la ligne. On renvoie donc
    // des items discrets : { key, line, name, ean, qty, route, supplier,
    // events }, plus le nom du client.
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
                items: parseOrderItems(response.responseText),
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

    // Un tableau d'événements de suivi se reconnaît à ses en-têtes.
    function isSuiviTable(table) {
        const t = table.textContent || '';
        return /N°\s*document/i.test(t) && /Type de document/i.test(t);
    }

    // Parse UN tableau « Suivi de commande » (colonnes pilotées par les
    // en-têtes : la 2e colonne est « Fournisseur no » ou « Entrepôt no »
    // selon l'origine de la ligne). Alimente `events` en dédoublonnant via
    // `seen` — les mêmes flyouts sont dupliqués plusieurs fois dans la page.
    function parseEventTable(table, events, seen) {
        const headerCells = Array.from(table.querySelectorAll('th'));
        const colIndex = { doc: -1, fournisseur: -1, type: -1, date: -1, qty: -1, statut: -1 };
        headerCells.forEach((th, i) => {
            const t = (th.textContent || '').toLowerCase();
            if (t.includes('document') && t.includes('n°')) colIndex.doc = i;
            else if (t.includes('fournisseur') || t.includes('entrepôt') || t.includes('entrepot')) colIndex.fournisseur = i;
            else if (t.includes('type')) colIndex.type = i;
            else if (t.includes('date')) colIndex.date = i;
            else if (t.includes('qté') || t.includes('qte') || t.includes('quantité')) colIndex.qty = i;
            else if (t.includes('statut')) colIndex.statut = i;
        });

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

            events.push({ docNumber, fournisseurNo, type, dateStr, qty, statut });
        });
    }

    // Découpe la page commande en lignes discrètes. Chaque ligne d'article est
    // un <tr label="Collection via Store_<EAN>"> (dans le tableau de suivi ET
    // dans les accordéons par groupe de livraison : on regroupe par label).
    function parseOrderItems(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const rowsByLabel = new Map();
        doc.querySelectorAll('tr[label]').forEach((tr) => {
            const label = tr.getAttribute('label');
            if (!rowsByLabel.has(label)) rowsByLabel.set(label, []);
            rowsByLabel.get(label).push(tr);
        });

        const items = [];
        rowsByLabel.forEach((rows, label) => {
            const pickText = (sel) => {
                for (const r of rows) {
                    const el = r.querySelector(sel);
                    if (el && (el.textContent || '').trim()) return el.textContent.trim();
                }
                return '';
            };
            const name = pickText('td.product h4') || pickText('td h4');
            const ean  = pickText('.js-ean-val') || ((label.match(/_(\d{8,})/) || [])[1] || '');
            const line = (pickText('td.linenumber') || '').replace(/\D+/g, '');
            const qty  = pickText('td.quantity');

            // Origine de la ligne : Fournisseur / Entrepôt / Magasin
            let route = '';
            outer:
            for (const r of rows) {
                for (const td of r.children) {
                    const t = (td.textContent || '').trim();
                    if (/^(fournisseur|entrepôt|entrepot|magasin)$/i.test(t)) { route = t; break outer; }
                }
            }

            // Événements : les tableaux de suivi des flyouts de la ligne
            // (les flyouts de remise/prix n'ont pas ces en-têtes → ignorés).
            const events = [];
            const seen = new Set();
            let supplier = '';
            rows.forEach((r) => {
                r.querySelectorAll('.flyout').forEach((fly) => {
                    const tables = Array.from(fly.querySelectorAll('table')).filter(isSuiviTable);
                    if (!tables.length) return;
                    if (!supplier) {
                        // Nom du fournisseur : <span> nu avant le tableau (ex. FL CREATION)
                        const s = fly.querySelector('.flyout-content > span:not([class])');
                        if (s && (s.textContent || '').trim()) supplier = s.textContent.trim();
                    }
                    tables.forEach((t) => parseEventTable(t, events, seen));
                });
            });
            if (!supplier) {
                const fno = (events.find(ev => ev.fournisseurNo) || {}).fournisseurNo || '';
                supplier = route && fno ? `${route} ${fno}` : route;
            }
            events.forEach(ev => { ev.supplier = supplier; });

            items.push({ key: ean || label, line, name, ean, qty, route, supplier, events });
        });

        items.sort((a, b) => (parseInt(a.line, 10) || 0) - (parseInt(b.line, 10) || 0));

        // Fallback : page sans lignes identifiables → ancien parsing global,
        // la commande entière est traitée comme une ligne unique.
        if (!items.length) {
            const events = [];
            const seen = new Set();
            let tables = Array.from(doc.querySelectorAll('table')).filter(isSuiviTable);
            tables = tables.filter(t => !tables.some(other => other !== t && t.contains(other)));
            tables.forEach(t => parseEventTable(t, events, seen));
            if (events.length) {
                items.push({ key: '__order__', line: '', name: '', ean: '', qty: '', route: '', supplier: '', events });
            }
        }
        return items;
    }

    // -----------------------------
    // MAPPING DES ÉTAPES (libellés FR + ordre logique)
    // -----------------------------
    function classifyEvent(ev) {
        const t = (ev.type || '').toLowerCase();
        if (t.includes('cde achat'))      return { stage: 1, label: 'Commande reçue par le fournisseur', icon: '📝' };
        if (t.includes('asn'))            return { stage: 2, label: 'Expédition annoncée (ASN)',          icon: '📦' };
        if (t.includes('préparation') || t.includes('preparation'))
                                          return { stage: 2, label: 'Commande en préparation',            icon: '🏭' };
        if (t.includes('transit'))        return { stage: 3, label: 'Marchandise en transit',             icon: '🚚' };
        if (t.includes('réception') || t.includes('reception'))
                                          return { stage: 4, label: 'Réceptionné en magasin',             icon: '✅' };
        return { stage: 0, label: ev.type || 'Événement', icon: '•' };
    }

    // Rollup d'UNE ligne : son étape la plus avancée et son statut propre.
    function rollupItem(item) {
        const events = item.events || [];
        const received = events.some(ev => /réception|reception/i.test(ev.type));
        const highest = events.reduce((mx, ev) => Math.max(mx, classifyEvent(ev).stage), 0);
        const hasAsn = events.some(ev => /asn/i.test(ev.type));
        const status = received ? 'Réceptionné ✔' :
                       highest >= 3 ? 'En transit' :
                       highest >= 2 ? (hasAsn ? 'Expédié (ASN)' : 'En préparation') :
                       highest >= 1 ? 'Commande créée' : 'en attente';
        return { received, highest, status };
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
            const { items, clientName } = await fetchOrderEvents(atgOrderId);
            const allEvents = items.flatMap(it => it.events);

            // SAP = premier N° document commençant par 6 sur une ligne "Cde achat"
            let sapNumber = order.sapNumber;
            if (!sapNumber) {
                const cde = allEvents.find(ev => /cde achat/i.test(ev.type) && /^6\d{5,}/.test(ev.docNumber));
                if (cde) sapNumber = cde.docNumber;
            }

            // Rollup par ligne, puis rollup commande : la commande n'est
            // « Réceptionnée » que si TOUTES ses lignes le sont. Sinon le
            // statut global suit la ligne la MOINS avancée (le goulot), avec
            // un état « Partiel » dès qu'une partie seulement est arrivée —
            // l'ancien rollup prenait l'étape la plus avancée toutes lignes
            // confondues, ce qui masquait une ligne bloquée.
            items.forEach(it => {
                const r = rollupItem(it);
                it.closed = r.received;
                it.stage = r.highest;
                it.status = r.status;
            });
            const receivedCount = items.filter(it => it.closed).length;
            let status, closed = false;
            if (items.length > 0 && receivedCount === items.length) {
                status = 'Réceptionné ✔'; closed = true;
            } else if (receivedCount > 0) {
                status = `Partiel — ${receivedCount}/${items.length} lignes reçues`;
            } else if (items.length > 1) {
                // Plusieurs lignes à des stades différents : pas de statut
                // global trompeur, les badges par ligne font foi.
                status = `${items.length} lignes — voir détail`;
            } else if (items.length === 1) {
                status = items[0].status;
            } else {
                status = 'en attente';
            }

            const suppliers = [...new Set(items.map(it => it.supplier).filter(Boolean))];

            updateOrder(order.orderNumber, {
                atgOrderId,
                items,
                sapNumber: sapNumber || null,
                supplier: suppliers.join(' · ') || order.supplier || '',
                clientName: clientName || order.clientName || '',
                status,
                closed,
                lastCheckedTimestamp: Date.now()
            });

            // Notification pour chaque étape nouvelle et significative,
            // ligne par ligne (une ligne déjà connue qui évolue → notif).
            const prevItems = new Map((order.items || []).map(it => [it.key, it]));
            items.forEach(it => {
                const prev = prevItems.get(it.key);
                if (!prev || !(prev.events || []).length) return; // ligne vue pour la 1re fois
                const known = new Set(prev.events.map(eventKey));
                it.events.filter(ev => !known.has(eventKey(ev))).forEach(ev => {
                    const c = classifyEvent(ev);
                    if (c.stage > 0) showNotification(order.orderNumber, c, ev, sapNumber, it.name);
                });
            });
            // Première vérification : notifier seulement si SAP vient d'être trouvé
            if (!(order.items || []).length && !(order.events || []).length && sapNumber && !order.sapNumber) {
                showNotification(order.orderNumber, { stage: 1, label: 'Commande reçue par le fournisseur', icon: '📝' },
                                 allEvents.find(ev => ev.docNumber === sapNumber) || {}, sapNumber, '');
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
        expandedOrders.add(orderNumber); // nouvelle commande : dépliée d'emblée
        saveOrders(); renderOrders();
        checkOrder(newOrder);
    }
    function deleteOrder(orderNumber) {
        trackedOrders = trackedOrders.filter(o => o.orderNumber !== orderNumber);
        expandedOrders.delete(orderNumber);
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
                <h3>
                    <span class="lc-brand-dash"></span>
                    Suivi de commande
                    <span class="lc-count" id="lc-count"></span>
                </h3>
                <div class="input-area">
                    <input type="text" id="lc-order-input" placeholder="Entrer numéro de commande...">
                    <button id="lc-add-btn" class="casto-btn casto-btn-primary">Suivre</button>
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

    // Marche pour une commande comme pour une ligne ({ status, closed }).
    function badgeFor(order) {
        const s = (order.status || '').toLowerCase();
        if (s.includes('vérification')) return ['check', order.status];
        if (s.includes('reconnecter'))  return ['auth', 'Reconnecter Com+'];
        if (s.includes('erreur'))       return ['err', 'Erreur API'];
        if (order.closed)               return ['done', 'Réceptionné ✔'];
        if (s.includes('partiel'))      return ['partial', order.status];
        if (s.includes('voir détail'))  return ['multi', order.status];
        if (s.includes('transit'))      return ['transit', 'En transit'];
        if (s.includes('asn') || s.includes('expédié')) return ['asn', 'Expédié (ASN)'];
        if (s.includes('préparation') || s.includes('preparation')) return ['asn', 'En préparation'];
        if (s.includes('créée'))        return ['created', 'Commande créée'];
        return ['wait', 'En attente'];
    }

    // -----------------------------
    // TRACKER HORIZONTAL (refonte « Timeline guidée »)
    // -----------------------------
    // Les 4 stades logiques, dans l'ordre. `varc` = jeton couleur .casto-ui.
    const STAGES = [
        { n: 1, label: 'Cde achat',   varc: '--casto-blue'   },
        { n: 2, label: 'Expédié ASN', varc: '--casto-purple' },
        { n: 3, label: 'En transit',  varc: '--casto-orange' },
        { n: 4, label: 'Réception',   varc: '--casto-green'  },
    ];

    // Stade le plus avancé atteint par une ligne (fallback : recalcul via events
    // pour les commandes stockées avant que it.stage n'existe).
    function itemHighestStage(it) {
        if (typeof it.stage === 'number') return it.stage;
        return (it.events || []).reduce((mx, ev) => Math.max(mx, classifyEvent(ev).stage), 0);
    }

    // Construit le tracker horizontal d'UNE commande, toutes lignes confondues.
    // Pour chaque stade : « done » si TOUTES les lignes l'ont franchi, « part »
    // si une partie seulement (goulot → on voit la ligne en retard), « wait »
    // sinon. Le connecteur qui précède un nœud reprend l'état/couleur de ce nœud.
    function orderTrackerHtml(items) {
        const list  = items.length ? items : [{ events: [], stage: 0 }];
        const total = list.length;
        const highs = list.map(itemHighestStage);
        const reached = (n) => highs.filter((h) => h >= n).length;

        let html = '<div class="lc-tracker">';
        STAGES.forEach((st, i) => {
            const c     = reached(st.n);
            const state = c === total ? 'done' : c > 0 ? 'part' : 'wait';
            const color = `var(${st.varc})`;

            // Connecteur AVANT ce nœud (sauf le 1er)
            if (i > 0) {
                html += `<span class="lc-conn ${state === 'wait' ? '' : state}" style="--c:${color}"></span>`;
            }
            // Contenu du nœud
            const glyph = state === 'done' ? '✓'
                        : state === 'part' ? (total > 1 ? `${c}/${total}` : '●')
                        : String(st.n);
            html += `
                <div class="lc-step ${state}" style="--c:${color}">
                    <span class="lc-node">${glyph}</span>
                    <span class="lc-node-label">${st.label}</span>
                </div>`;
        });
        return html + '</div>';
    }

    function renderOrders() {
        if (!ordersContainer) return;
        ordersContainer.innerHTML = '';

        // Compteur dans l'en-tête
        const countEl = document.getElementById('lc-count');
        if (countEl) countEl.textContent = trackedOrders.length
            ? `${trackedOrders.length} suivie${trackedOrders.length > 1 ? 's' : ''}` : '';

        if (!trackedOrders.length) {
            ordersContainer.innerHTML = '<div class="lc-empty">Aucune commande suivie. Ajoutez un numéro ci-dessus.</div>';
            return;
        }

        trackedOrders.forEach((order) => {
            const [cls, txt] = badgeFor(order);
            const card = document.createElement('div');
            card.className = 'lc-card' + (expandedOrders.has(order.orderNumber) ? ' open' : '');

            // Timeline verticale d'une ligne (triée stade puis date)
            const timelineFor = (events) => {
                const evts = (events || []).slice().sort((a, b) => {
                    const sa = classifyEvent(a).stage, sb = classifyEvent(b).stage;
                    if (sa !== sb) return sa - sb;
                    return parseFrDate(a.dateStr) - parseFrDate(b.dateStr);
                });
                return evts.length
                    ? '<ul class="lc-timeline">' + evts.map((ev) => {
                        const cl   = classifyEvent(ev);
                        const doc  = ev.docNumber ? `<span class="lc-doc">n° ${ev.docNumber}</span>` : '';
                        const date = ev.dateStr   ? `<span class="lc-date">${ev.dateStr}</span>` : '';
                        const st   = ev.statut ? ` — ${ev.statut}` : '';
                        return `<li class="s${cl.stage}">${cl.label}${st}${date}${doc}</li>`;
                      }).join('') + '</ul>'
                    : '<div class="lc-no-event">Aucun événement pour l’instant.</div>';
            };

            // Lignes discrètes (≥ v1.5) ; anciennes commandes → ligne unique.
            const items = (order.items && order.items.length) ? order.items
                : (order.events && order.events.length)
                    ? [{ name: '', events: order.events, status: order.status, closed: order.closed }]
                    : [];

            const linesHtml = items.length
                ? items.map((it) => {
                    let head = '';
                    if (it.name || items.length > 1) {
                        const [icls, itxt] = badgeFor(it);
                        const meta = [it.ean ? `EAN ${it.ean}` : '', it.qty ? `Qté ${it.qty}` : '', it.supplier || '']
                            .filter(Boolean).join(' · ');
                        head = `
                            <div class="lc-item-head">
                                <span class="lc-item-name">${it.line ? `${it.line}. ` : ''}${it.name || 'Ligne'}</span>
                                <span class="lc-badge ${icls}">${itxt}</span>
                                ${meta ? `<span class="lc-item-meta">${meta}</span>` : ''}
                            </div>`;
                    }
                    return `<div class="lc-item">${head}${timelineFor(it.events)}</div>`;
                  }).join('')
                : '<div class="lc-no-event">Aucun événement pour l’instant.</div>';

            // Puces SAP + note
            const chips = [];
            if (order.sapNumber) chips.push(`<span class="lc-chip lc-chip-sap">N° SAP <strong title="Cliquer pour copier">${order.sapNumber}</strong> ⧉</span>`);
            if (order.note)      chips.push('<span class="lc-chip lc-chip-note">🗒️ <span class="lc-note-text"></span></span>');
            const chipsHtml = chips.length ? `<div class="lc-chips">${chips.join('')}</div>` : '';

            const clientLine = (order.clientName || order.supplier)
                ? `<div class="lc-sub">${order.clientName ? `👤 <strong>${order.clientName}</strong>` : ''}${order.clientName && order.supplier ? ' · ' : ''}${order.supplier || ''}</div>`
                : '';

            card.innerHTML = `
                <div class="lc-card-head">
                    <div class="lc-id">
                        <div class="lc-id-top">
                            <span class="lc-num">${order.orderNumber}</span>
                            <span class="lc-time">ajouté ${formatTimestamp(order.addedTimestamp)} · vérifié ${formatTimestamp(order.lastCheckedTimestamp)}</span>
                        </div>
                        ${clientLine}
                    </div>
                    <span class="lc-badge ${cls}">${txt}</span>
                    <span class="lc-caret">▶</span>
                </div>
                ${orderTrackerHtml(items)}
                <div class="lc-details">
                    ${chipsHtml}
                    <div class="lc-lines">${linesHtml}</div>
                    <div class="lc-card-foot">
                        <span class="lc-note-btn" title="Ajouter/modifier une note">✎ Note</span>
                        <span class="lc-refresh" title="Vérifier maintenant">↻ Actualiser</span>
                        <span class="lc-del" title="Supprimer du suivi">✕ Retirer</span>
                    </div>
                </div>
            `;

            // Replié par défaut : l'en-tête et le tracker déplient/replient
            const toggleDetails = () => {
                const open = card.classList.toggle('open');
                if (open) expandedOrders.add(order.orderNumber);
                else expandedOrders.delete(order.orderNumber);
            };
            card.querySelector('.lc-card-head').addEventListener('click', toggleDetails);
            card.querySelector('.lc-tracker').addEventListener('click', toggleDetails);

            // La note est du texte libre : jamais injectée via innerHTML
            const noteEl = card.querySelector('.lc-note-text');
            if (noteEl) noteEl.textContent = order.note;

            const sapEl = card.querySelector('.lc-chip-sap strong');
            if (sapEl) sapEl.addEventListener('click', () => {
                navigator.clipboard.writeText(order.sapNumber).then(() => alert('N° SAP copié !')).catch(() => {});
            });
            card.querySelector('.lc-note-btn').addEventListener('click', () => openNoteEditor(card, order));
            card.querySelector('.lc-del').addEventListener('click', () => deleteOrder(order.orderNumber));
            card.querySelector('.lc-refresh').addEventListener('click', () => checkOrder(order));

            ordersContainer.appendChild(card);
        });
    }

    // Éditeur de note inline (post-it par commande : « recontacter avant le
    // 15/07 », etc.). L'enregistrement passe par updateOrder → re-render.
    function openNoteEditor(card, order) {
        if (card.querySelector('.lc-note-editor')) {
            card.querySelector('.lc-note-editor input').focus();
            return;
        }
        const ed = document.createElement('div');
        ed.className = 'lc-note-editor';
        ed.innerHTML = `
            <input type="text" maxlength="200" placeholder="Note (ex. : contacter le client avant le 15/07)…">
            <button class="casto-btn casto-btn-primary">OK</button>
            <button class="casto-btn casto-btn-ghost">Annuler</button>
        `;
        const input = ed.querySelector('input');
        input.value = order.note || '';
        const [saveBtn, cancelBtn] = ed.querySelectorAll('button');
        saveBtn.addEventListener('click', () => updateOrder(order.orderNumber, { note: input.value.trim() }));
        input.addEventListener('keydown', e => { if (e.key === 'Enter') updateOrder(order.orderNumber, { note: input.value.trim() }); });
        cancelBtn.addEventListener('click', () => ed.remove());
        card.querySelector('.lc-card-head').insertAdjacentElement('afterend', ed);
        input.focus();
    }

    function toggleMainPopup() {
        if (!mainPopup || !popupOverlay) createMainPopup();
        const isVisible = mainPopup.style.display === 'flex';
        // 'flex' et pas 'block' : le style inline écraserait le display:flex
        // de la feuille de style, et la colonne flex (donc le scroll de la
        // liste, qui doit pouvoir rétrécir) ne s'appliquerait jamais.
        mainPopup.style.display = isVisible ? 'none' : 'flex';
        popupOverlay.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) { loadOrders().then(renderOrders); }
    }

    // -----------------------------
    // NOTIFICATIONS D'ÉVOLUTION
    // -----------------------------
    function showNotification(orderNumber, classif, ev, sapNumber, itemName) {
        const existing = document.getElementById('lc-dyn-notif');
        if (existing) existing.remove();
        const n = document.createElement('div');
        n.id = 'lc-dyn-notif';
        n.className = 'lc-notif casto-ui';
        n.innerHTML = `
            <h4>${classif.icon} ${classif.label}</h4>
            <p>Commande <strong>${orderNumber}</strong>${sapNumber ? ` · SAP <strong>${sapNumber}</strong>` : ''}</p>
            ${itemName ? `<p class="lc-notif-item">${itemName}</p>` : ''}
            ${ev.dateStr ? `<p>Date : <strong>${ev.dateStr}</strong>${ev.docNumber ? ` · Document n° <strong>${ev.docNumber}</strong>` : ''}</p>` : ''}
            <button class="casto-btn casto-btn-primary">OK</button>
        `;
        document.body.appendChild(n);
        n.querySelector('button').addEventListener('click', () => n.remove());
    }

    // -----------------------------
    // INJECTION DU BOUTON (page d'accueil agent)
    // -----------------------------
    // Ajouté en dernier enfant du bloc « Commandes / N° de dossier », après le
    // <ul class="arrow-list-inline"> (« Recherche avancée »), pour rester
    // visuellement rattaché au bloc. Réutilise les classes natives de l'appli
    // (btn btn-primary) plutôt que du CSS custom.
    function injectTrackButton() {
        if (document.getElementById('track-order-btn')) return true;
        const panel = document.querySelector(ORDER_PANEL_SELECTOR);
        if (!panel) return false;
        panel.insertAdjacentHTML('beforeend', `
            <div class="tracking-feature">
                <a href="#" class="btn btn-primary js-track-order" id="track-order-btn">
                    Suivi de commande
                </a>
            </div>
        `);
        document.getElementById('track-order-btn')
            .addEventListener('click', (e) => { e.preventDefault(); toggleMainPopup(); });
        return true;
    }

    // main.jsp est rendue côté serveur : le bloc est en général déjà là au
    // document_end. On garde néanmoins un observer borné dans le temps au cas
    // où la zone d'accueil serait (re)construite en JS. Sur les autres pages
    // agent, le bloc n'existe pas : on abandonne au bout du délai.
    function attemptInjectTrackButton() {
        if (injectTrackButton()) return;
        const observer = new MutationObserver(() => {
            if (injectTrackButton()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 10000);
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
        attemptInjectTrackButton();
        console.log("[Casto Tools · Suivi] Suivi de commande v1.7.1 initialisé.");
        if (!(await hasAgentHeaders())) console.warn('[Casto Tools · Suivi] En attente de capture prod-agent. Interagissez avec l’Agent si nécessaire.');
    }

    CastoTools.register('order-lifecycle', init);

})();
