// Casto Tools — couche de stockage partagée (remplace GM_getValue / GM_setValue).
// Chargée dans les content scripts et dans la popup.
'use strict';

const castoStorage = {
  /** Lit une clé, renvoie `fallback` si absente. */
  async get(key, fallback = null) {
    const found = await chrome.storage.local.get(key);
    return Object.prototype.hasOwnProperty.call(found, key) ? found[key] : fallback;
  },

  /** Écrit une clé (valeur JSON-sérialisable). */
  async set(key, value) {
    return chrome.storage.local.set({ [key]: value });
  },

  async remove(key) {
    return chrome.storage.local.remove(key);
  },

  /** Abonnement aux changements d'une clé. Renvoie une fonction de désabonnement. */
  onChange(key, callback) {
    const listener = (changes, area) => {
      if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, key)) {
        callback(changes[key].newValue, changes[key].oldValue);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
};
