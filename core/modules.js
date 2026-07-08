// Casto Tools — registre des modules.
// Chaque module correspond à un ancien script Tampermonkey. Pour ajouter un
// module : une entrée ici, un dossier sous modules/, et une entrée
// content_scripts dans manifest.json.
'use strict';

const CASTO_ENABLED_KEY = 'casto:modules:enabled';

const CASTO_MODULES = [
  {
    id: 'order-lifecycle',
    name: 'Suivi de commande — Cycle de vie',
    description: "Suivi du cycle de vie des commandes fournisseur (Cde achat → ASN → Transit → Réception) via l'API Agent, avec timeline et notifications d'évolution.",
    version: '1.3.0',
    hosts: ['dc.kfplc.com'],
    defaultEnabled: true
  }
];

function castoModuleById(id) {
  return CASTO_MODULES.find((m) => m.id === id) || null;
}

/** État d'activation effectif de tous les modules ({ id: bool }). */
async function castoGetEnabledMap() {
  const stored = await castoStorage.get(CASTO_ENABLED_KEY, {});
  const map = {};
  for (const mod of CASTO_MODULES) {
    map[mod.id] = Object.prototype.hasOwnProperty.call(stored, mod.id)
      ? !!stored[mod.id]
      : !!mod.defaultEnabled;
  }
  return map;
}

async function castoIsModuleEnabled(id) {
  const map = await castoGetEnabledMap();
  return !!map[id];
}

async function castoSetModuleEnabled(id, enabled) {
  const stored = await castoStorage.get(CASTO_ENABLED_KEY, {});
  stored[id] = !!enabled;
  await castoStorage.set(CASTO_ENABLED_KEY, stored);
}
