/**
 * Module Caddie Magique: import CSV et ajout panier avec remises.
 */
import { CONFIG } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('CaddieMagique');

const parseCsv = (text) => {
  const rows = text.split(/\r?\n/).filter(Boolean);
  return rows.map((row) => {
    const cols = row.split(';');
    const ean = cols[0]?.replace(/\D/g, '');
    const discount = Number((cols[8] ?? '0').replace(',', '.'));
    const quantity = Number(cols[9] ?? 1);
    return { ean, discount, quantity };
  }).filter((line) => /^\d{8,14}$/.test(line.ean) && line.quantity > 0);
};

const createModal = () => {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:fixed;inset:10% 20%;background:#111;color:#fff;z-index:99999;border-radius:12px;padding:16px;display:flex;flex-direction:column;';
  const title = document.createElement('h3');
  title.textContent = 'Caddie magique - progression';
  const logs = document.createElement('div');
  logs.style.cssText = 'overflow:auto;max-height:60vh;border:1px solid #444;padding:10px;font-family:monospace;';
  wrapper.append(title, logs);
  document.body.appendChild(wrapper);
  return {
    log: (line) => {
      const p = document.createElement('div');
      p.textContent = line;
      logs.appendChild(p);
      logs.scrollTop = logs.scrollHeight;
    },
    close: () => wrapper.remove()
  };
};

const callBackground = (type, payload) => new Promise((resolve) => {
  chrome.runtime.sendMessage({ type, payload }, resolve);
});

const getKitsHeaders = async () => {
  const result = await callBackground('auth:getHeaders', { origin: 'https://dc.dps.kd.kfplc.com' });
  return result?.headers ?? {};
};

const processCsv = async (items) => {
  const modal = createModal();
  let basketId = null;
  let discount409 = 0;
  const headers = await getKitsHeaders();

  for (const item of items) {
    const basketUrl = basketId
      ? `https://dc.dps.kd.kfplc.com/basket/${basketId}/items`
      : 'https://dc.dps.kd.kfplc.com/basket/items';

    const addResult = await callBackground('http:fetch', {
      url: basketUrl,
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ ean: item.ean, quantity: item.quantity })
    });

    if (addResult.status === 409) {
      basketId = addResult.data?.basketId ?? basketId;
      modal.log(`↳ 409 détecté, reprise du panier ${basketId ?? 'inconnu'}`);
      continue;
    }

    basketId = addResult.data?.basketId ?? basketId;
    modal.log(`✅ ${item.ean} x${item.quantity} ajouté`);

    const discountResult = await callBackground('http:fetch', {
      url: `https://dc.dps.kd.kfplc.com/basket/${basketId}/items/${item.ean}/discount`,
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ managerId: CONFIG.MANAGER_ID, discountRate: item.discount })
    });

    if (discountResult.status === 409) {
      discount409 += 1;
      modal.log(`❌ remise 409 pour ${item.ean}`);
    } else if (discountResult.ok) {
      modal.log(`↳ remise ${item.discount}% appliquée`);
    } else {
      modal.log(`❌ erreur remise ${item.ean}`);
    }
  }

  if (items.length > 0 && discount409 === items.length) {
    modal.log('❌ Toutes les remises ont échoué (409). Videz le panier puis recommencez.');
    return;
  }

  if (basketId) {
    modal.log('✅ Terminé. Redirection vers le panier dans 1,5s...');
    setTimeout(() => {
      window.location.href = `https://dc.kfplc.com/basket/${basketId}`;
    }, 1500);
  }
};

const mountNavButton = () => {
  const target = document.querySelector('nav') ?? document.body;
  const button = document.createElement('button');
  button.textContent = 'Caddie magique';
  button.style.cssText = 'display:block;margin:8px;padding:8px 12px;background:#0078d4;color:#fff;border:none;border-radius:6px;cursor:pointer;';

  button.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const items = parseCsv(text);
      await processCsv(items);
    };
    input.click();
  });

  target.prepend(button);
  logger.log('Bouton injecté');
};

export const bootstrapCaddieMagique = () => {
  mountNavButton();
};
