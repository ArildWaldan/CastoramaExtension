// Casto Tools — service worker.
//
// Deux responsabilités héritées des scripts Tampermonkey :
//
// 1. CAPTURE D'AUTHENTIFICATION — l'ancien script hookait XMLHttpRequest dans
//    la page pour mémoriser les en-têtes envoyés vers prod-agent / kd. Ici,
//    chrome.webRequest observe passivement toutes les requêtes du navigateur
//    vers ces hôtes et persiste un instantané des en-têtes (mêmes clés de
//    stockage que les userscripts : sap_agent_auth / sap_kd_auth).
//
// 2. PROXY DE REQUÊTES — remplace GM_xmlhttpRequest : les content scripts ne
//    peuvent pas faire de fetch cross-origin, le service worker si (via
//    host_permissions), cookies du navigateur inclus (credentials: include).
//    Origin/Referer sont des en-têtes interdits pour fetch : ils sont posés
//    par des règles declarativeNetRequest sur les requêtes de l'extension.
'use strict';

const TARGETS = {
  agent: {
    requestHost: 'prod-agent.castorama.fr',
    hostRe: /(^|\.)prod-agent\.castorama\.fr$/i,
    authKey: 'sap_agent_auth',
    origin: 'https://prod-agent.castorama.fr',
    referer: 'https://prod-agent.castorama.fr/agent-front/jsp/agent/main.jsp',
    defaultTimeout: 30000
  },
  kd: {
    requestHost: 'dc.dps.kd.kfplc.com',
    hostRe: /(^|\.)dc\.dps\.kd\.kfplc\.com$/i,
    authKey: 'sap_kd_auth',
    origin: 'https://dc.kfplc.com',
    referer: 'https://dc.kfplc.com/',
    defaultTimeout: 15000
  }
};

// En-têtes qu'on ne rejoue jamais (gérés par le navigateur ou par dNR).
const FORBIDDEN_HEADERS = new Set([
  'host', 'content-length', 'connection', 'accept-encoding',
  'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
  'sec-ch-ua', 'sec-ch-ua-platform', 'sec-ch-ua-mobile',
  'cookie', 'origin', 'referer', 'user-agent', 'upgrade-insecure-requests',
  'purpose', 'priority'
]);

// -----------------------------
// Stockage
// -----------------------------
async function storageGet(key, fallback = null) {
  const found = await chrome.storage.local.get(key);
  return Object.prototype.hasOwnProperty.call(found, key) ? found[key] : fallback;
}
function storageSet(key, value) {
  return chrome.storage.local.set({ [key]: value });
}

// -----------------------------
// 1. Capture d'authentification (webRequest, passif)
// -----------------------------
const lastSnapshotJson = { agent: '', kd: '' };

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    // Ignorer nos propres requêtes (celles du proxy ci-dessous).
    if (details.initiator && details.initiator.startsWith('chrome-extension://')) return;

    let hostname;
    try { hostname = new URL(details.url).hostname; } catch { return; }
    const targetId = Object.keys(TARGETS).find((id) => TARGETS[id].hostRe.test(hostname));
    if (!targetId) return;

    const captured = {};
    for (const h of details.requestHeaders || []) {
      const name = h.name.toLowerCase();
      if (name === 'cookie' || FORBIDDEN_HEADERS.has(name)) continue;
      captured[name] = h.value || '';
    }
    if (!Object.keys(captured).length) return;

    const json = JSON.stringify(captured);
    if (json === lastSnapshotJson[targetId]) return; // rien de neuf, on évite d'écrire
    lastSnapshotJson[targetId] = json;

    const authKey = TARGETS[targetId].authKey;
    storageGet(authKey, { headers: {} }).then((auth) => {
      auth.headers = Object.assign({}, auth.headers, captured);
      auth.updatedAt = Date.now();
      return storageSet(authKey, auth);
    });
  },
  {
    urls: ['https://prod-agent.castorama.fr/*', 'https://dc.dps.kd.kfplc.com/*'],
    types: ['xmlhttprequest', 'main_frame', 'sub_frame']
  },
  ['requestHeaders', 'extraHeaders']
);

// -----------------------------
// Règles dNR : Origin/Referer sur les requêtes émises par l'extension
// -----------------------------
async function installHeaderRules() {
  const rules = Object.values(TARGETS).map((t, i) => ({
    id: i + 1,
    priority: 1,
    condition: {
      urlFilter: `||${t.requestHost}/`,
      initiatorDomains: [chrome.runtime.id],
      resourceTypes: ['xmlhttprequest']
    },
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Origin', operation: 'set', value: t.origin },
        { header: 'Referer', operation: 'set', value: t.referer }
      ]
    }
  }));
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: rules.map((r) => r.id),
      addRules: rules
    });
  } catch (e) {
    console.error('[Casto Tools] Impossible de poser les règles d\'en-têtes :', e);
  }
}
chrome.runtime.onInstalled.addListener(installHeaderRules);
chrome.runtime.onStartup.addListener(installHeaderRules);
installHeaderRules();

// -----------------------------
// 2. Proxy de requêtes (remplace GM_xmlhttpRequest)
// -----------------------------
function buildAgentHeaders(capturedHeaders, extra) {
  const out = {};
  for (const [k, v] of Object.entries(capturedHeaders || {})) {
    if (!FORBIDDEN_HEADERS.has(k.toLowerCase())) out[k] = v;
  }
  out['Accept'] = 'application/json, text/javascript, */*; q=0.01';
  out['X-Requested-With'] = 'XMLHttpRequest';
  return Object.assign(out, extra || {});
}

function buildKdHeaders(capturedHeaders, extra) {
  const captured = capturedHeaders || {};
  const out = {
    'Accept': 'application/json',
    'kits-operating-company': 'CF01',
    'kits-tenant-id': 'CAFR',
    'kits-application-name': 'DigitalColleague',
    'kits-app-version': '2.0.0',
    'kits-device-id': `desktop_${Date.now()}`,
    'kits-workstation-id': captured['kits-workstation-id'] || '',
    'kits-store-code': captured['kits-store-code'] || ''
  };
  return Object.assign(out, extra || {});
}

async function handleProxyRequest({ target, method, url, data, headers, timeout }) {
  const t = TARGETS[target];
  if (!t) throw new Error(`Cible inconnue : ${target}`);

  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`URL invalide : ${url}`); }
  if (parsed.protocol !== 'https:' || !t.hostRe.test(parsed.hostname)) {
    throw new Error(`URL hors périmètre pour la cible ${target} : ${url}`);
  }

  const auth = await storageGet(t.authKey, { headers: {} });
  const finalHeaders = target === 'agent'
    ? buildAgentHeaders(auth.headers, headers)
    : buildKdHeaders(auth.headers, headers);

  // Les en-têtes vides font échouer Headers.set → on les écarte.
  const cleanHeaders = {};
  for (const [k, v] of Object.entries(finalHeaders)) {
    if (v !== undefined && v !== null && String(v) !== '') cleanHeaders[k] = String(v);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout || t.defaultTimeout);
  try {
    const resp = await fetch(url, {
      method: method || 'GET',
      headers: cleanHeaders,
      body: data !== null && data !== undefined ? data : undefined,
      credentials: 'include',
      redirect: 'follow',
      signal: controller.signal
    });
    const text = await resp.text();
    return { status: resp.status, responseText: text, finalUrl: resp.url };
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'casto:request') return undefined;
  handleProxyRequest(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ error: String((e && e.message) || e) }));
  return true; // réponse asynchrone
});
