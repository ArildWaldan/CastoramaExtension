/**
 * Service worker MV3: capture headers d'auth, proxy fetch cross-origin, stockage partagé.
 */
import { CONFIG, STORAGE_KEYS } from '../shared/config.js';

const authHeadersByOrigin = new Map();

const normalizeHeaders = (requestHeaders = []) => {
  const required = ['kits-device-id', 'kits-workstation-id', 'kits-store-code', 'kits-tenant-id', 'kits-operating-company'];
  const map = {};
  for (const header of requestHeaders) {
    const name = header.name?.toLowerCase();
    if (required.includes(name)) {
      map[name] = header.value;
    }
  }
  return map;
};

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const headers = normalizeHeaders(details.requestHeaders);
    if (Object.keys(headers).length) {
      authHeadersByOrigin.set(new URL(details.url).origin, headers);
    }
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ['*://dc.dps.kd.kfplc.com/*', '*://dc.kfplc.com/*'] },
  ['requestHeaders', 'extraHeaders']
);

const withJson = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === 'auth:getHeaders') {
      sendResponse({ ok: true, headers: authHeadersByOrigin.get(message.origin) ?? {} });
      return;
    }

    if (message.type === 'http:fetch') {
      const { url, method = 'GET', headers = {}, body } = message.payload;
      const response = await fetch(url, { method, headers, body });
      sendResponse({ ok: response.ok, status: response.status, data: await withJson(response) });
      return;
    }

    if (message.type === 'storage:set') {
      await chrome.storage.local.set(message.payload);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'storage:get') {
      const data = await chrome.storage.local.get(message.keys);
      sendResponse({ ok: true, data });
      return;
    }

    if (message.type === 'gev:flash') {
      const response = await fetch(`${CONFIG.EEG_SERVER}/flash`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message.payload)
      });
      sendResponse({ ok: response.ok, status: response.status, data: await withJson(response) });
      return;
    }

    if (message.type === 'moduleStatus:get') {
      sendResponse({
        ok: true,
        modules: {
          caddieMagique: true,
          provisionnes: true,
          coliweb: true,
          gev: true,
          surMesure: true
        },
        cacheKey: STORAGE_KEYS.GEV_CACHE
      });
      return;
    }

    sendResponse({ ok: false, error: 'Message inconnu' });
  })().catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
