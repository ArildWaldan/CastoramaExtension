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
  order-lifecycle/             Module « Suivi de commande »
    content.js
    styles.css
  provisionnes/                Module « Provisionnés »
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

### Suivi de commande (`order-lifecycle`, v1.8.0)

Suivi du cycle de vie des commandes fournisseur (**Cde achat → ASN / Cde en préparation → Transit → Réception**) via l'API Agent, timeline en français, notifications d'évolution.

Depuis la v1.5.0 le suivi est **ligne par ligne** : une commande à plusieurs articles (par ex. l'un expédié par le fournisseur, l'autre bloqué en entrepôt) affiche une timeline et un badge par ligne — chaque ligne est un `<tr label="Collection via Store_<EAN>">` de la page commande, avec son propre flyout « Suivi de commande ». Le statut global de la commande suit la ligne la **moins** avancée (le goulot) et passe en « Partiel — x/y lignes reçues » dès qu'une partie est arrivée ; la commande n'est « Réceptionnée » que quand toutes ses lignes le sont. Les notifications d'évolution sont émises par ligne, avec le nom de l'article. Tant que rien n'est reçu, une commande multi-lignes affiche « x lignes — voir détail » plutôt qu'un statut global trompeur.

Chaque commande suivie peut porter une **note manuelle** (« recontacter le client avant le 15/07 », …) : bouton « ✎ Note » sur la carte, affichée en post-it, stockée avec la commande dans `chrome.storage.local`.

Depuis la v1.8.0, chaque commande peut aussi porter un **libellé** court (« Litige M. Smith », …) : étiquette jaune affichée à côté du numéro dans l'en-tête de la carte, donc visible **carte repliée** — on identifie la commande d'un coup d'œil. Bouton « 🏷 Libellé » dans le pied de carte, ou clic sur l'étiquette elle-même pour la modifier ; stocké avec la commande comme la note. Un clic sur le **numéro de commande** le copie dans le presse-papiers (confirmation « copié ✓ » éphémère), comme le N° SAP.

Depuis la v1.4.0 le module tourne **directement sur Com+** (`prod-agent.castorama.fr`, agent-front) — là où les commandes sont gérées — et non plus sur `dc.kfplc.com` :
- un bouton **« Suivi de commande »** est injecté dans le bloc « Commandes / N° de dossier » de la page d'accueil agent (`main.jsp`), en dernier enfant du bloc, avec les classes natives `btn btn-primary` de l'appli ;
- l'UI du panneau suit la refonte « Timeline guidée » (v1.7) sur les jetons `.casto-ui` de `core/branding.css` : tracker horizontal Cde achat → ASN → Transit → Réception par commande (nœud plein = toutes les lignes ont franchi le stade, nœud `x/y` = une partie seulement), puces SAP/note, timeline verticale par ligne, compteur de commandes suivies dans l'en-tête. Les cartes sont **repliées par défaut** (en-tête + tracker) ; un clic sur l'en-tête ou le tracker déplie les détails (puces SAP/note, lignes, actions) — une commande fraîchement ajoutée arrive dépliée. La liste défile quand elle dépasse la hauteur du panneau.

Notes :
- Classification des étapes, détection de session expirée et workflow de re-check toutes les 15 min inchangés ; si la page commande ne contient aucune ligne identifiable, on retombe sur l'ancien parsing global (commande = ligne unique).
- Les données suivies restent sous la clé `lifecycleOrders_kfplc` dans `chrome.storage.local`. Les commandes stockées avant la 1.5 (événements à plat, sans lignes) restent affichables et sont converties au format par ligne à leur prochaine vérification.
- Comme le module vit désormais sur prod-agent, les en-têtes d'authentification Agent sont capturés dès la navigation normale sur Com+.

### Provisionnés (`provisionnes`, v1.4.0)

Port 1:1 du userscript éponyme, sur Com+ (`dc.kfplc.com`) : import d'un fichier **CSV des provisionnés** (entrée « MAJ Provisionnés » injectée dans le menu, à côté de Pricer), mapping tolérant des colonnes (EAN, Qté stock J-1, PV Plancher, Taux prov, Qté à sortir — détection auto du délimiteur et de l'encodage UTF-8/Windows-1252), stockage par EAN.

Sur les pages produit :
- **résultats de recherche** : badge `Prov. x%` + PV Plancher sur chaque article présent dans le CSV, et filtre « Provisionnés » ajouté au menu déroulant des filtres (préférence persistée) ;
- **fiche produit** : PV Plancher + badge sous le prix, et pastille « x provisionnés rest. » sur la ligne Total du stock (calcul `stock actuel − (stock J-1 − qté à sortir)`).

Notes de portage :
- `GM_get/setValue` → `castoStorage` (`chrome.storage.local`) — l'API du userscript était déjà asynchrone, port direct ; mêmes clés (`provCsvDataV3`, `provCsvLastImportV1`, `provCsvFilterProvOnlyV1`), mais les données Tampermonkey ne sont **pas migrées** automatiquement (réimporter le CSV).
- `GM_addStyle` → `modules/provisionnes/styles.css` ; l'UI (modale d'import, toast) reste auto-thémée clair/sombre comme dans le userscript, indépendante de la charte `casto-ui`.
- Aucun appel réseau : pas de nouvelle host_permission (l'injection sur `dc.kfplc.com` passe par les `matches` du content script).

## Permissions demandées

| Permission | Raison |
|---|---|
| `storage` | Persistance des commandes suivies, de l'état des modules et des en-têtes capturés |
| `webRequest` | Capture passive des en-têtes d'authentification vers les API internes |
| `declarativeNetRequestWithHostAccess` | Pose d'`Origin`/`Referer` sur les requêtes émises par l'extension (hôtes autorisés uniquement) |
| `host_permissions` | `prod-agent.castorama.fr`, `dc.dps.kd.kfplc.com` — injection et appels API |
