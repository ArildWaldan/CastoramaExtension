/**
 * Module Provisionnés: extraction produits provisionnés et panneau de synthèse.
 */
import { STORAGE_KEYS } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('Provisionnes');

const callBackground = (type, payload) => new Promise((resolve) => chrome.runtime.sendMessage({ type, payload }, resolve));

const collectProvisionedRows = () => {
  return [...document.querySelectorAll('table tr')]
    .map((row) => ({
      ean: row.querySelector('[data-ean]')?.textContent?.trim(),
      designation: row.querySelector('[data-label]')?.textContent?.trim(),
      qty: Number(row.querySelector('[data-qty]')?.textContent?.trim() ?? 0)
    }))
    .filter((line) => /^\d{8,14}$/.test(line.ean || '') && line.qty > 0);
};

const renderPanel = (rows) => {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;background:#1e1e1e;color:white;padding:12px;border-radius:8px;z-index:99999;max-width:360px;';
  panel.innerHTML = `<strong>Provisionnés</strong><div>${rows.length} ligne(s)</div>`;
  document.body.appendChild(panel);
};

export const bootstrapProvisionnes = () => {
  const rows = collectProvisionedRows();
  if (!rows.length) return;
  renderPanel(rows);
  callBackground('storage:set', { [STORAGE_KEYS.PROVISIONNES_LAST]: { at: Date.now(), rows } });
  logger.log('Données provisionnées capturées', rows.length);
};
