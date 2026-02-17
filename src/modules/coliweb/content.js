/**
 * Module Coliweb: estimation, login auto, auto-remplissage formulaire livraison.
 */
import { CONFIG, STORAGE_KEYS } from '../../shared/config.js';
import { setReactInputValue } from '../../shared/dom.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('Coliweb');
const callBackground = (type, payload) => new Promise((resolve) => chrome.runtime.sendMessage({ type, payload }, resolve));

const scrapeBasket = () => {
  const lines = [...document.querySelectorAll('.js-ean-val')].map((eanNode) => {
    const wrapper = eanNode.closest('tr, .basket-line, li, div') ?? document;
    const qtyNode = wrapper.querySelector('.js-basket-qty-change');
    return { ean: eanNode.textContent?.trim(), quantity: Number(qtyNode?.value ?? qtyNode?.textContent ?? 1) };
  }).filter((line) => /^\d{8,14}$/.test(line.ean));

  const address = document.querySelector('.js-saved-delivery-address')?.textContent?.trim() ?? '';
  const fullName = document.querySelector('.js-customer-name')?.textContent?.trim() ?? 'Client Castorama';
  const phone = document.querySelector('.js-customer-phone')?.textContent?.trim() ?? '0600000000';
  return { lines, address, fullName, phone };
};

const fetchJsonViaBackground = async (url, options = {}) => {
  const result = await callBackground('http:fetch', { url, ...options });
  if (!result?.ok) throw new Error(`HTTP ${result?.status ?? '0'} sur ${url}`);
  return result.data;
};

const geocodeAddress = async (address) => {
  const url = `https://geocode.maps.co/search?q=${encodeURIComponent(address)}&api_key=${CONFIG.GEOCODE_API_KEY}`;
  const data = await fetchJsonViaBackground(url);
  const first = data?.[0];
  if (!first) throw new Error('Adresse introuvable');
  return { lat: Number(first.lat), lon: Number(first.lon), display: first.display_name };
};

const estimate = async () => {
  const basket = scrapeBasket();
  if (!basket.lines.length) throw new Error('Aucun article détecté');
  const geo = await geocodeAddress(basket.address);

  const payload = {
    pickup: { latitude: CONFIG.STORE_LAT, longitude: CONFIG.STORE_LON, postalCode: CONFIG.STORE_POSTAL },
    shipping: { latitude: geo.lat, longitude: geo.lon, postalCode: basket.address.match(/\b\d{5}\b/)?.[0] ?? '' },
    packages: [{ count: basket.lines.reduce((acc, line) => acc + line.quantity, 0), weight: 40, dimensions: { length: 120, width: 80, height: 80 } }]
  };

  const offer = await fetchJsonViaBackground(`https://api.production.colisweb.com/api/v5/clients/${CONFIG.COLIWEB_CLIENT_ID}/stores/${CONFIG.COLIWEB_STORE_ID}/deliveryOptions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const base = Number(offer?.[0]?.price ?? offer?.price ?? 0);
  const finalPrice = Number((base * 1.0376).toFixed(2));
  const [firstName, ...rest] = basket.fullName.split(' ');
  const record = {
    address: basket.address,
    phone: basket.phone,
    firstName: firstName || 'Client',
    lastName: rest.join(' ') || 'Castorama',
    estimatedPrice: finalPrice,
    raw: offer,
    createdAt: Date.now()
  };

  await callBackground('storage:set', { [STORAGE_KEYS.COLIWEB_LAST_ESTIMATE]: record });
  return record;
};

const mountBasketButtons = () => {
  const container = document.querySelector('.basket-validation, .js-basket-validation, main') ?? document.body;
  const estimateButton = document.createElement('button');
  estimateButton.textContent = 'Estimer prix Colisweb';
  const scheduleButton = document.createElement('button');
  scheduleButton.textContent = 'Programmer la livraison';
  [estimateButton, scheduleButton].forEach((button) => {
    button.style.cssText = 'margin:8px;padding:10px 14px;background:#0078d4;color:#fff;border:none;border-radius:6px;cursor:pointer;';
  });

  estimateButton.onclick = async () => {
    try {
      const result = await estimate();
      alert(`Prix estimé: ${result.estimatedPrice} €`);
    } catch (error) {
      alert(`Erreur Colisweb: ${error.message}`);
    }
  };

  scheduleButton.onclick = () => {
    window.open('https://bo.production.colisweb.com/login', '_blank');
  };

  container.append(estimateButton, scheduleButton);
};

const autofillLogin = () => {
  const email = document.querySelector('input[type="text"], input[name="email"]');
  const password = document.querySelector('input[type="password"]');
  if (!email || !password) return;
  setReactInputValue(email, CONFIG.COLIWEB_USERNAME);
  setReactInputValue(password, CONFIG.COLIWEB_PASSWORD);
  logger.log('Identifiants Coliweb pré-remplis');
};

const fillComboboxAddress = async (value) => {
  const input = document.querySelector('input[role="combobox"], input[name="address"]');
  if (!input) return;
  setReactInputValue(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const option = document.querySelector('[id^="headlessui-combobox-option-"]');
  option?.click();
};

const autofillDeliveryForm = async () => {
  const result = await callBackground('storage:get', { keys: [STORAGE_KEYS.COLIWEB_LAST_ESTIMATE] });
  const data = result?.data?.[STORAGE_KEYS.COLIWEB_LAST_ESTIMATE];
  if (!data) return;

  await fillComboboxAddress(data.address);
  const firstName = document.querySelector('input[name="firstName"], input[placeholder*="Prénom"]');
  const lastName = document.querySelector('input[name="lastName"], input[placeholder*="Nom"]');
  const phone = document.querySelector('input[name="phone"], input[placeholder*="Téléphone"]');
  if (firstName) setReactInputValue(firstName, data.firstName);
  if (lastName) setReactInputValue(lastName, data.lastName);
  if (phone) setReactInputValue(phone, data.phone);
  logger.log('Formulaire livraison pré-rempli');
};

export const bootstrapColiweb = () => {
  const host = window.location.host;
  const path = window.location.pathname;

  if (host === 'prod-agent.castorama.fr') mountBasketButtons();
  if (host === 'bo.production.colisweb.com' && path.includes('/login')) autofillLogin();
  if (host === 'bo.production.colisweb.com' && path.includes('create-delivery')) autofillDeliveryForm();
};
