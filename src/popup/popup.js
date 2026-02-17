/**
 * Popup extension: statut des modules sur l'onglet courant.
 */
const hostNode = document.querySelector('#host');
const listNode = document.querySelector('#modules');

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const host = new URL(tab.url).host;
hostNode.textContent = `Page courante: ${host}`;

const status = await chrome.runtime.sendMessage({ type: 'moduleStatus:get' });
const modules = status?.modules || {};
Object.entries(modules).forEach(([name, active]) => {
  const li = document.createElement('li');
  li.textContent = `${name}: ${active ? 'actif' : 'inactif'}`;
  listNode.appendChild(li);
});
