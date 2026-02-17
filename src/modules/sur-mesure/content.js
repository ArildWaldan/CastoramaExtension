/**
 * Module Sur-Mesure: interception devis SquareClock + envoi Google Sheet + bouton email.
 */
import { CONFIG, STORAGE_KEYS } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('SurMesure');
const callBackground = (type, payload) => new Promise((resolve) => chrome.runtime.sendMessage({ type, payload }, resolve));

const EMAIL_TEMPLATE = `<!doctype html><html><body><p>Bonjour,</p><p>Suite à votre devis d'un montant de <strong>[montant]</strong>, nous restons à votre disposition.</p><p>Cordialement,<br/>${CONFIG.STORE_NAME}</p><p>[[Année actuelle]]</p></body></html>`;

const showPopup = (message, ok = true) => {
  const popup = document.createElement('div');
  popup.style.cssText = `position:fixed;top:16px;right:16px;padding:12px;border-radius:8px;z-index:99999;background:${ok ? '#1b5e20' : '#b71c1c'};color:#fff;`;
  popup.textContent = message;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 4000);
};

const submitQuotation = async (quotation) => {
  const result = await callBackground('http:fetch', {
    url: CONFIG.GOOGLE_SCRIPT_URL,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(quotation)
  });
  return result;
};

const injectEmailButton = (quotation) => {
  const button = document.createElement('button');
  button.textContent = 'Copier email de suivi';
  button.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:99999;padding:10px 14px;background:#0078d4;color:#fff;border:none;border-radius:6px;';
  button.onclick = async () => {
    const html = EMAIL_TEMPLATE
      .replace('[montant]', `${quotation.amount ?? ''} €`)
      .replace('[[Année actuelle]]', String(new Date().getFullYear()));
    await navigator.clipboard.writeText(html);
    window.open(`mailto:${quotation.email ?? ''}?subject=Suivi%20de%20votre%20devis&body=${encodeURIComponent('Le modèle HTML a été copié dans le presse-papiers.')}`);
    showPopup('Email copié dans le presse-papiers');
  };
  document.body.appendChild(button);
};

const extractQuotationFromResponse = async (response) => {
  const clone = response.clone();
  const json = await clone.json().catch(() => null);
  if (!json) return null;
  if (!json?.quotationId && !json?.quoteId) return null;
  return {
    quotationId: json.quotationId ?? json.quoteId,
    amount: json.totalAmount ?? json.amount,
    email: json.customer?.email,
    firstName: json.customer?.firstName,
    lastName: json.customer?.lastName,
    createdAt: Date.now()
  };
};

export const bootstrapSurMesure = () => {
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const quotation = await extractQuotationFromResponse(response);
    if (quotation) {
      logger.log('Devis intercepté', quotation.quotationId);
      const submit = await submitQuotation(quotation);
      if (submit?.ok) {
        showPopup('Devis envoyé vers Google Sheet ✅');
      } else {
        showPopup('Erreur envoi Google Sheet ❌', false);
      }
      callBackground('storage:set', { [STORAGE_KEYS.SUR_MESURE_LAST]: quotation });
      injectEmailButton(quotation);
    }
    return response;
  };
};
