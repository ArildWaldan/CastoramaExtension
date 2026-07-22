// Casto Tools — registre des modules.
// Chaque module correspond à un ancien script Tampermonkey. Pour ajouter un
// module : une entrée ici, un dossier sous modules/, et une entrée
// content_scripts dans manifest.json.
'use strict';

const CASTO_ENABLED_KEY = 'casto:modules:enabled';

const CASTO_MODULES = [
  {
    id: 'order-lifecycle',
    name: 'Suivi de commande',
    description: "Suivi du cycle de vie des commandes fournisseur (Cde achat → ASN → Transit → Réception), ligne par ligne, via l'API Agent, avec timeline, notifications d'évolution, notes manuelles et libellés. Bouton intégré à la page d'accueil Com+ (bloc Commandes).",
    version: '1.8.0',
    hosts: ['prod-agent.castorama.fr'],
    defaultEnabled: true
  },
  {
    id: 'provisionnes',
    name: 'Provisionnés',
    description: "Import d'un CSV des provisionnés (mapping par EAN) : taux de provision, PV Plancher et provisionnés restants injectés sur les pages produit Com+, avec filtre « Provisionnés » dans les résultats de recherche.",
    version: '1.4.0',
    hosts: ['dc.kfplc.com'],
    defaultEnabled: true
  }
];

// Feuille de route : fonctionnalités à venir, affichées dans la popup sous
// forme de toggles grisés (non activables). Passer une entrée dans
// CASTO_MODULES (avec son content script) quand elle est développée.
const CASTO_ROADMAP = [
  {
    id: 'caddies-magiques',
    name: 'Caddies magiques',
    description: 'Création automatique des bulletins de vente pour caddies magiques.'
  },
  {
    id: 'gev',
    name: 'G.E.V',
    description: "Flashing des EEG pour attirer l'attention sur les anomalies d'emplacements vides."
  },
  {
    id: 'operations-en-cours',
    name: 'Opérations en cours',
    description: "Bannières de mise en valeur d'OP en cours."
  },
  {
    id: 'calculateur-cw',
    name: 'Calculateur C.W',
    description: 'Calcul automatique des frais de livraison Coliweb.'
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
