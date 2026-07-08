// Casto Tools — runtime des content scripts.
// Chaque module s'enregistre via CastoTools.register(id, init) ; le runtime
// ne lance init() que si le module est activé dans la popup de l'extension.
'use strict';

const CastoTools = {
  register(id, init) {
    const mod = castoModuleById(id);
    if (!mod) {
      console.warn(`[Casto Tools] Module inconnu du registre : ${id}`);
      return;
    }
    castoIsModuleEnabled(id).then((enabled) => {
      if (!enabled) return;
      const start = () => {
        try {
          Promise.resolve(init()).catch((e) =>
            console.error(`[Casto Tools] Échec d'initialisation du module ${id}:`, e));
        } catch (e) {
          console.error(`[Casto Tools] Échec d'initialisation du module ${id}:`, e);
        }
      };
      if (document.readyState === 'complete' || document.readyState === 'interactive') start();
      else window.addEventListener('DOMContentLoaded', start);
    });
  },

  /**
   * Requête cross-origin exécutée par le service worker (remplace
   * GM_xmlhttpRequest). `target` : 'agent' ou 'kd'.
   * Résout avec { status, responseText, finalUrl }.
   */
  request(target, { method, url, data = null, headers = {}, timeout } = {}) {
    return chrome.runtime
      .sendMessage({ type: 'casto:request', target, method, url, data, headers, timeout })
      .then((res) => {
        if (!res) throw new Error('Service worker injoignable');
        if (res.error) throw new Error(res.error);
        return res;
      });
  }
};
