# Casto Tools

Extension Chromium (Manifest V3) qui regroupe, sous forme de **modules activables**, les fonctionnalités auparavant dispersées dans des userscripts Tampermonkey injectés dans les outils internes Castorama (Com+, Agent, …).

## Installation (mode développeur)

1. Ouvrir `chrome://extensions` (ou `edge://extensions`).
2. Activer le **Mode développeur**.
3. **Charger l'extension non empaquetée** → sélectionner la racine de ce dépôt.

Chaque module s'active/désactive depuis la popup de l'extension (icône dans la barre d'outils), à la manière des scripts Tampermonkey. Après un changement d'état, recharger les onglets concernés.

## Architecture

```
manifest.json                  Manifest V3 : permissions, content scripts par module
assets/icons/                  Icônes (générées par tools/gen_icons.py)
core/
  branding.css                 Charte Castorama (variables CSS, classe .casto-ui)
  storage.js                   Couche chrome.storage.local (remplace GM_get/setValue)
  modules.js                   Registre des modules (id, nom, hosts, defaultEnabled)
  runtime.js                   CastoTools.register(id, init) + CastoTools.request(...)
background/
  service-worker.js            Capture d'auth (webRequest) + proxy réseau (remplace GM_xmlhttpRequest)
popup/                         Popup de gestion des modules (branding Castorama)
modules/
  order-lifecycle/             Module « Suivi de commande — Cycle de vie »
    content.js
    styles.css
tools/
  gen_icons.py                 Régénération des icônes (aucune dépendance)
```

### Tronc commun

- **`core/runtime.js`** — chaque module appelle `CastoTools.register('<id>', init)` ; `init()` n'est lancé que si le module est activé dans la popup.
- **`core/storage.js`** — `castoStorage.get/set/remove/onChange`, promesses au-dessus de `chrome.storage.local`.
- **`core/branding.css`** — jetons de design Castorama (`--casto-blue`, `--casto-yellow`, …) portés par la classe `.casto-ui`. Toute UI injectée et la popup les partagent : un seul endroit pour ajuster la charte.
- **`background/service-worker.js`** — deux rôles :
  1. **Capture d'authentification** : observe passivement (via `chrome.webRequest`) les en-têtes des requêtes du navigateur vers `prod-agent.castorama.fr` et `dc.dps.kd.kfplc.com`, et les persiste (clés `sap_agent_auth` / `sap_kd_auth`, identiques aux userscripts). Remplace le hook `XMLHttpRequest` injecté en page — et couvre désormais tous les onglets, pas seulement Com+.
  2. **Proxy de requêtes** : `CastoTools.request(target, opts)` (remplace `GM_xmlhttpRequest`). Le fetch part du service worker avec `credentials: 'include'` (cookies réels du navigateur) ; `Origin`/`Referer`, interdits pour `fetch`, sont posés par des règles `declarativeNetRequest` limitées aux requêtes de l'extension.

### Ajouter un module (port d'un userscript)

1. Créer `modules/<id>/content.js` (+ `styles.css` si besoin) ; envelopper le code dans `CastoTools.register('<id>', init)`.
2. Déclarer le module dans `core/modules.js` (id, nom, description, version, hosts, `defaultEnabled`).
3. Ajouter une entrée `content_scripts` dans `manifest.json` avec les `matches` du `@match` d'origine (et compléter `host_permissions` si le module parle à de nouveaux hôtes).
4. Correspondances Tampermonkey → extension :
   - `GM_getValue` / `GM_setValue` → `castoStorage.get` / `castoStorage.set` (async)
   - `GM_xmlhttpRequest` → `CastoTools.request(target, { method, url, data, headers, timeout })` (déclarer la cible dans `TARGETS` du service worker)
   - `GM_addStyle` → fichier CSS déclaré dans le manifest ; poser la classe `casto-ui` sur les racines d'UI injectées

## Modules

### Suivi de commande — Cycle de vie (`order-lifecycle`, v1.3.0)

Port 1:1 du userscript éponyme : suivi du cycle de vie des commandes fournisseur (**Cde achat → ASN → Transit → Réception**) via l'API Agent, timeline en français, notifications d'évolution, entrée « Suivi de commande » injectée dans le menu Com+ (`dc.kfplc.com`).

Notes de portage :
- Logique métier inchangée (parsing du tableau « Suivi de commande », classification des étapes, détection de session Com+ expirée, workflow de re-check toutes les 15 min).
- Les données suivies restent sous la clé `lifecycleOrders_kfplc`, mais dans `chrome.storage.local` : la liste des commandes suivies dans Tampermonkey **n'est pas migrée** automatiquement.
- L'UI reprend la charte Castorama (thème clair bleu/jaune) au lieu du thème sombre du userscript ; structure et comportements identiques.

## Permissions demandées

| Permission | Raison |
|---|---|
| `storage` | Persistance des commandes suivies, de l'état des modules et des en-têtes capturés |
| `webRequest` | Capture passive des en-têtes d'authentification vers les API internes |
| `declarativeNetRequestWithHostAccess` | Pose d'`Origin`/`Referer` sur les requêtes émises par l'extension (hôtes autorisés uniquement) |
| `host_permissions` | `dc.kfplc.com`, `prod-agent.castorama.fr`, `dc.dps.kd.kfplc.com` — injection et appels API |
