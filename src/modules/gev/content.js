/**
 * Module G.E.V.: dashboard anomalies/ruptures avec cache 48h et flash EEG.
 */
import { CONFIG, STORAGE_KEYS } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('GEV');
const callBackground = (type, payload) => new Promise((resolve) => chrome.runtime.sendMessage({ type, payload }, resolve));

const getSector = (aisle) => {
  const n = Number(aisle);
  if (n >= 1 && n <= 22) return 'Secteur Décoration';
  if (n >= 23 && n <= 27) return 'Secteur Aména - Sol';
  if ([29, 31, 35, 38].includes(n)) return 'Secteur Aména - Salle de bain';
  if ([40, 43].includes(n)) return 'Secteur Aména - Cuisine';
  if ([28, 30, 32, 33, 34, 36].includes(n)) return 'Secteur Aména - Rangement';
  if ([37, 39, 41, 42].includes(n)) return 'Secteur bâti - Menuiserie';
  if ((n >= 44 && n <= 53) || (n >= 55 && n <= 58) || n === 76) return 'Secteur Technique';
  if (n >= 59 && n <= 63) return 'Secteur bâti - Découpe';
  if (n === 54 || (n >= 64 && n <= 75)) return 'Secteur Jardin';
  return 'Autre secteur';
};

const fakeScan = () => {
  const anomalies = Array.from({ length: 12 }).map((_, i) => ({ aisle: i + 20, ean: `30000000000${i}`, stock: i % 2 }));
  const ruptures = Array.from({ length: 8 }).map((_, i) => ({ aisle: i + 44, ean: `36636000000${i}`, eta: 'J+3' }));
  return {
    generatedAt: Date.now(),
    anomalies: anomalies.map((row) => ({ ...row, sector: getSector(row.aisle) })),
    ruptures: ruptures.map((row) => ({ ...row, sector: getSector(row.aisle) }))
  };
};

const buildDashboard = (data) => {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:5%;background:#101015;color:#fff;z-index:99999;border-radius:12px;padding:16px;overflow:auto;';
  const bySector = data.anomalies.reduce((acc, row) => {
    acc[row.sector] = (acc[row.sector] || 0) + 1;
    return acc;
  }, {});

  overlay.innerHTML = `
    <h2>G.E.V. Dashboard</h2>
    <p>Dernière génération: ${new Date(data.generatedAt).toLocaleString('fr-FR')}</p>
    <h3>Anomalies (${data.anomalies.length})</h3>
    <ul>${Object.entries(bySector).map(([sector, count]) => `<li>${sector}: ${count}</li>`).join('')}</ul>
    <h3>Ruptures (${data.ruptures.length})</h3>
    <ul>${data.ruptures.map((r) => `<li>${r.ean} - ${r.sector} - ${r.eta}</li>`).join('')}</ul>
    <button id="gev-flash">Flasher les étiquettes</button>
    <button id="gev-close">Fermer</button>
  `;

  overlay.querySelector('#gev-close')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#gev-flash')?.addEventListener('click', async () => {
    const result = await callBackground('gev:flash', { duration: CONFIG.EEG_DEFAULT_FLASH_DURATION, items: data.anomalies.map((x) => x.ean) });
    alert(result?.ok ? 'Flash EEG envoyé' : 'Erreur flash EEG');
  });

  document.body.appendChild(overlay);
};

const loadData = async () => {
  const cached = await callBackground('storage:get', { keys: [STORAGE_KEYS.GEV_CACHE, STORAGE_KEYS.GEV_REBUILD_LOCK] });
  const cache = cached?.data?.[STORAGE_KEYS.GEV_CACHE];
  if (cache && Date.now() - cache.generatedAt < CONFIG.GEV_CACHE_TTL_MS) {
    return cache;
  }

  await callBackground('storage:set', { [STORAGE_KEYS.GEV_REBUILD_LOCK]: true });
  const rebuilt = fakeScan();
  await callBackground('storage:set', {
    [STORAGE_KEYS.GEV_CACHE]: rebuilt,
    [STORAGE_KEYS.GEV_REBUILD_LOCK]: false
  });
  return rebuilt;
};

export const bootstrapGev = () => {
  const button = document.createElement('button');
  button.textContent = 'G.E.V.';
  button.style.cssText = 'display:block;margin:8px;padding:8px 12px;background:#222;color:#fff;border:1px solid #555;border-radius:6px;';
  button.onclick = async () => buildDashboard(await loadData());
  (document.querySelector('nav') ?? document.body).prepend(button);
  logger.log('Bouton G.E.V. injecté');
};
