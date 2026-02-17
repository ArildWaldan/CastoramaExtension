# CODEX TASK — Casto Tools: Unified Chrome Extension

## Context

You are building a Chrome Extension (Manifest V3) called **Casto Tools** that unifies five separate Tampermonkey userscripts into a single, polished, professional Chrome extension. The original scripts are in `/reference-scripts/` — consult them to understand the BUSINESS LOGIC and API contracts, but do NOT replicate their code patterns. They were written incrementally by a non-developer over 2+ years, with inconsistent quality. Your job is to deliver a production-grade extension that provides **identical or superior functionality** with a unified architecture.

The extension targets internal Castorama (French retail chain) web tools used by store staff. All UI text MUST be in French.

---

## Target Sites & Permissions

The extension operates on these domains (declare in manifest):

| Domain | Modules Active |
|---|---|
| `dc.kfplc.com` | Caddie Magique, G.E.V., Provisionnés |
| `dc.dps.kd.kfplc.com` | API backend for dc.kfplc.com (fetch only) |
| `prod-agent.castorama.fr` | Coliweb (basket page) |
| `bo.production.colisweb.com` | Coliweb (login + delivery form autofill) |
| `api.production.colisweb.com` | Coliweb API (fetch only) |
| `agile.intranet.castosav.castorama.fr:8080` | Coliweb (SAV product data + popup) |
| `squareclock-internal-sqc-production.k8s.ap.digikfplc.com` | Sur-Mesure Scraper |
| `script.google.com` / `script.googleusercontent.com` | Sur-Mesure (Google Sheet webhook) |
| `api.kingfisher.com` | Sur-Mesure (CAFR customer lookup) |
| `geocode.maps.co` | Coliweb (geocoding) |
| `eegserver1502.frca.kfplc.com:3333` | G.E.V. (EEG electronic shelf label flashing) |

---

## The Five Modules

### Module 1: Caddie Magique
**Reference:** `reference-scripts/caddie-magique.user.js`
**Active on:** `dc.kfplc.com/*`

**What it does:**
- Adds a "Caddie magique" entry to the host app's sidebar navigation (next to "Reprendre un panier")
- Clicking it opens a native file picker for CSV upload
- Parses the CSV: column A = EAN (8-14 digit barcode), column I = discount %, column J = quantity
- Sniffs internal API auth headers (`kits-device-id`, `kits-workstation-id`, `kits-store-code`, `kits-tenant-id`, `kits-operating-company`) from the host app's own XHR/fetch traffic
- Iterates through parsed items: POSTs each to `/basket/items` on `dc.dps.kd.kfplc.com`, then applies a discount via `/basket/{id}/items/{ean}/discount`
- Handles 409 Conflict for basket session recovery
- Shows a modal log with real-time progress (✅ added, ❌ error, ↳ discount applied)
- On completion: auto-redirects to the basket page, UNLESS 100% of discount calls returned 409 (then shows a "clear your basket and retry" error instead)

**Success criteria:**
- [ ] CSV with 50+ rows processes without errors on valid data
- [ ] Auth header sniffing captures all 5 `kits-*` headers from host traffic before first API call
- [ ] 409 basket recovery works: if the first item 409s with a basketId, subsequent items use that basketId
- [ ] Progress modal is readable, scrollable, shows per-item status in real time
- [ ] Sidebar button visually matches host app navigation styling
- [ ] Redirect to `/basket/{id}` occurs ~1.5s after successful completion
- [ ] If ALL discounts 409, no redirect occurs; user sees explicit French error message

---

### Module 2: Coliweb Livraison Calculator
**Reference:** `reference-scripts/coliweb-calculator.user.js`
**Active on:** `prod-agent.castorama.fr/*`, `bo.production.colisweb.com/*`, `agile.intranet.castosav.castorama.fr:8080/*`

**What it does (3 sub-workflows by URL):**

**Sub-workflow A — Basket page (`prod-agent.castorama.fr`):**
- Injects two buttons ("Estimer prix Colisweb" and "Programmer la livraison") into the basket validation area
- On click: scrapes EANs + quantities from DOM (`.js-ean-val`, `.js-basket-qty-change`), client address (`.js-saved-delivery-address`), client name/phone
- For each EAN: fetches product dimensions (length, width, height, weight in cm/kg) from CastoSAV intranet API (`agile.intranet.castosav.castorama.fr:8080`)
  - Supports hardcoded overrides for specific EANs (e.g., Neva Platine `3663602431893`)
  - Product lookup: POST to `validRechercheProduit.do` → extract product code → POST to `initDetailProduit.do` → parse dimensions from HTML response
- Geocodes the delivery address via `geocode.maps.co` (with retry: full address → without house number → city+postal only)
- Calculates aggregate package metrics: total packages, heaviest weight, total weight, longest package dimensions
- Calls Colisweb delivery options API (`api.production.colisweb.com/api/v5/clients/249/stores/8481/deliveryOptions`) with pickup from store coordinates (lat: 49.0750948, lon: 6.1000448, postal: 57130) and shipping to geocoded customer address
- Applies a 3.76% margin to the returned price
- Displays result in a centered notification popup with package metric details
- Handles errors: expired session → re-auth, too heavy, distance exceeded, no offers → appropriate French messages with link to Colisweb quotation form
- Stores delivery details (address, metrics, client info) in extension storage for sub-workflow C
- Shows "Programmer la livraison" button linking to the Colisweb delivery creation page

**Sub-workflow B — Coliweb login page (`bo.production.colisweb.com/login`):**
- Auto-fills username and password fields (React inputs requiring native value setter hack)
- Credentials: username = `castometz012`, password = `cw12` (base64 encoded in original: `Y2FzdG9tZXR6MDEy` / `Y3cxMg==`)
- Auto-detects successful API response and closes the popup window

**Sub-workflow C — Coliweb delivery form (`bo.production.colisweb.com/.../create-delivery`):**
- Reads stored delivery details from extension storage
- Auto-fills: address (combobox with dropdown selection), recipient first name, last name, phone, package quantity, weight fields (heaviest + total if multi-package), length
- Highlights appropriate radio buttons for height ranges (<150cm, 150-180cm, >180cm) and width ranges (≤50cm, >50cm) based on package dimensions
- Uses robust element waiting (up to 60s per field) for React-rendered forms

**Success criteria:**
- [ ] Full flow works end-to-end: estimate on basket page → price popup → click "Programmer" → login auto-fills → delivery form auto-fills
- [ ] Package dimensions correctly fetched from SAV API or hardcoded fallback
- [ ] Geocoding succeeds with fallback strategy (3 attempts with progressively simplified address)
- [ ] Price calculation matches: `apiPrice × 1.0376`, rounded to 2 decimals, displayed in € format
- [ ] Notification popup shows: price, package count, total weight, heaviest package, max dimensions
- [ ] Error states all show appropriate French messages (heavy, distance, no offer, expired session)
- [ ] React input filling works reliably (native value setter + input/change/blur events)
- [ ] Data persists between pages via extension storage (not GM_setValue)
- [ ] Popup windows for SAV/Coliweb open and close correctly

---

### Module 3: G.E.V. (Gestion des Emplacements Vides)
**Reference:** `reference-scripts/gev.user.js`
**Active on:** `dc.kfplc.com/*`

**What it does:**
- Adds a "G.E.V." button to the host app's main menu tab bar (near Settings)
- Clicking opens a full-screen dark-themed dashboard overlay with two independent data sections:

**Section A — Anomalies (empty locations with stock > 0):**
- Scans bays 01-76 in aisle 999 via `/location-management/locations` API
- Collects all EANs found in those "empty placeholder" bays
- For each EAN: fetches product details via POST `/product/product-query/{ean}` — name, stock, locations, expected deliveries
- Filters to products where `availableQuantity > 0` (anomaly = product has stock but is in the "empty" bay)
- Groups results by store sector (predefined mapping: aisles 1-22 = Décoration, 23-27 = Aména-Sol, etc.)
- Displays: donut chart (Chart.js) with sector breakdown, collapsible sector tables with product name (linked), stock count, location descriptions
- Per-sector "Flash" button: searches EEG server for ESL barcodes matching the sector's EANs, then triggers LED flash for configurable duration

**Section B — Ruptures (empty locations with stock = 0):**
- Scans ALL store aisles (001-110) × all bays per aisle
- For each bay: fetches layout module info → segment EANs → product details
- Filters to products where `availableQuantity === 0`
- Groups by sector, shows next expected delivery date
- Donut chart: "with delivery" vs "without delivery"

**Infrastructure:**
- Auth capture: intercepts XHR on `dc.kfplc.com` and `dc.dps.kd.kfplc.com`, captures Authorization header + all request headers from successful (2xx) authenticated requests
- Caching: results stored in extension storage with 48-hour TTL. On dashboard open: render from cache immediately, then background rebuild if stale
- Concurrency control: `pLimit`-style concurrency limiter (6 concurrent for bay scans, 6 for product details, 10 for layouts)
- Progress: inline progress bars in dashboard header showing scan progress for each section independently
- Locking: prevents concurrent rebuilds of the same section (lock with clientId + timestamp, 90min expiry for anomalies, 3h for ruptures)
- API endpoint probing: tries multiple URL variants for location endpoints, remembers which variant works
- EEG integration: session bootstrap via GET to flash server, search via POST, flash via GET with barcode list + duration parameter

**Success criteria:**
- [ ] Dashboard opens instantly with cached data when available (<48h old)
- [ ] Background rebuild runs without blocking UI, progress bars update in real-time
- [ ] Anomalies section correctly identifies products in bay 999 that have stock > 0
- [ ] Ruptures section correctly scans full store and identifies zero-stock items
- [ ] Donut charts render with Chart.js, legends on both sides of chart
- [ ] Sector groupings match the predefined aisle→sector mapping exactly
- [ ] EEG flash integration: search for ESL barcodes → trigger flash with configurable duration
- [ ] Minimize/restore progress indicator works
- [ ] Force refresh (button click) re-runs scan; ALT+click forces full recalculate bypassing cache
- [ ] All API calls use captured auth headers, with wait-for-auth mechanism (up to 30s)
- [ ] Concurrent request limiting prevents API overload
- [ ] Lock mechanism prevents duplicate scans across tabs

---

### Module 4: Provisionnés
**Reference:** `reference-scripts/provisionnes.user.js`
**Active on:** `dc.kfplc.com/*`

**What it does:**
- Adds a "MAJ Provisionnés" menu item in the host app sidebar (after "Pricer" link)
- Clicking opens a themed modal (dark/light mode auto-detected) with:
  - Last import date & article count
  - Drag-and-drop CSV upload zone (also click-to-browse)
  - File info display with clear button
  - Import button with loading state

**CSV processing:**
- Auto-detects delimiter (comma, semicolon, tab) by frequency analysis on first line
- Auto-detects encoding (UTF-8 vs Windows-1252) by checking for replacement characters
- Smart header mapping: normalizes headers (strips accents, special chars), matches against known patterns:
  - `ean` / `code barre` → EAN identifier
  - `qte stock j-1` → stockJ1 (stock at J-1)
  - `pv plancher` / `prix plancher` → pvPlancher (floor price)
  - `tx prov` / `taux provision` → txProv (provision rate %)
  - `qte sortir` → qteSortir (quantity to remove)
- Stores parsed data as EAN-keyed map in extension storage
- Shows success toast with article count

**Page injections (reactive, SPA-aware):**
- **Search results page** (`/product-query/search/`): on each product card, if EAN is in data, appends a red "Prov. XX%" badge + "PV Plancher: X.XX €" text below the price
- **Product detail page** (`/product-query/{EAN}`): adds inline "PV Plancher" + "Prov. %" badges near price; in the stock table's "Total" row, calculates and shows "X provisionné(s) rest." chip with color coding (neutral = 0, warn ≤ 2, bad > 2). Formula: `provisionnés = max(0, currentStock - (stockJ1 - qteSortir))`
- **Filter integration**: injects a "Provisionnés" toggle button into the host app's dropdown filter list (next to "en stock", "en gamme"). When active, hides all search result items whose EAN is not in the provisionnés dataset

**Success criteria:**
- [ ] CSV import works with `;`, `,`, and `\t` delimiters and both UTF-8 and Windows-1252 encodings
- [ ] Header matching correctly identifies all 5 required columns from real Castorama CSV exports
- [ ] Missing columns produce a clear French error message listing which ones are missing
- [ ] Badges appear on search results within ~100ms of page render
- [ ] Product detail page shows PV Plancher, Prov %, and remaining provisionnés count
- [ ] Provisionnés calculation is correct: `max(0, currentStock - (stockJ1 - qteSortir))`
- [ ] Filter toggle hides/shows items correctly, persists preference across navigation
- [ ] Theme detection works (dark and light mode)
- [ ] SPA navigation detection: injections re-apply on route changes without page reload
- [ ] Last import date shows relative time ("Aujourd'hui à 14:30", "Hier", "Il y a 3 jours")

---

### Module 5: Sur-Mesure Scraper
**Reference:** `reference-scripts/sur-mesure-scraper.user.js`
**Active on:** `squareclock-internal-sqc-production.k8s.ap.digikfplc.com/*`

**What it does:**
- Intercepts network traffic (both fetch and XHR) on the SquareClock carpentry quotation tool
- Captures auth token from CAFR API requests (`api.kingfisher.com/colleague/v2/customers/CAFR`)
- Detects Quotation API responses (`/api/carpentry/Order/Quotation?id=`)

**On quotation capture:**
1. Extracts: quotation ID, creation date, customer ID, seller ID, total price, discount price, product names, first product icon URL
2. Strips `SQ_` prefix from customer ID
3. Uses captured auth token to fetch customer details from CAFR API (name, phone, email, external ID)
4. Sends structured payload to Google Apps Script webhook (`GOOGLE_SCRIPT_URL`) as JSON POST:
   ```
   { QuotationId, Date (DD/MM/YYYY), NomClient, Telephone, Mail, NumClient, PrixTTC, PrixRemise, Produits (comma-separated), Image (icon URL), Vendeur }
   ```
5. Google Sheet responds with `success` or `duplicate`

**UI feedback:**
- Loading popup ("Envoi du devis en cours...") during processing
- Success popup (green) or duplicate popup (yellow) on completion
- "Envoyer le devis par mail" button (blue, bottom-left) appears after successful sheet submission IF customer email is valid
- Email button: generates HTML email from template (Castorama-branded with logo, yellow banner, sections for quote details, delivery timeline, pre-visit option, follow-up), copies HTML to clipboard as rich text, opens `mailto:` link with CC to `metz2.menuiserie@castorama.fr` and subject line

**Configurable constants:**
- `GOOGLE_SCRIPT_URL`: Google Apps Script web app URL (currently `https://script.google.com/macros/s/AKfycbx6wfRJB2Qay_4g6Ms6NdxVEet9C-LoXya52j35s8g/dev`)
- `STORE_NAME`: "Castorama Jouy-aux-Arches"
- `STORE_PHONE`: needs configuration
- `STORE_EMAIL_SIGNATURE` / `STORE_EMAIL_CC`: `metz2.menuiserie@castorama.fr`
- Full HTML email template (preserve exactly from reference script)

**Success criteria:**
- [ ] Quotation API interception works for both fetch and XHR
- [ ] Auth token captured from CAFR requests and used for customer lookup
- [ ] Google Sheet receives correct structured payload with all fields populated
- [ ] Duplicate quotations detected by Sheet, shown with yellow "Déjà enregistré" popup
- [ ] Email button appears only when customer has valid email
- [ ] HTML email copied to clipboard as rich text (with plain-text fallback)
- [ ] `mailto:` link opens with correct CC, subject, and empty body
- [ ] Email template renders correctly with dynamic values: customer name, formatted price, current year, store info
- [ ] Polling mechanism: CAFR fetch triggers when pending quotation data exists and no other CAFR request is in flight

---

## Global Architecture Requirements

### Extension Structure
- Manifest V3 Chrome Extension
- Single popup page for extension-level settings/status (if needed)
- Content scripts injected per-domain as specified above
- Background service worker for: cross-tab storage, message routing between content scripts, and any long-lived operations
- All network requests from content scripts that need CORS bypass must go through the background service worker (replaces GM_xmlhttpRequest)

### Auth & Network
- Replace ALL Tampermonkey `GM_xmlhttpRequest` calls with `chrome.runtime.sendMessage` → background service worker → `fetch()` pattern
- Background service worker handles all cross-origin requests and returns responses to content scripts
- Cookie access via `chrome.cookies` API where needed (replaces GM_cookie)
- Auth header sniffing: use `chrome.webRequest.onBeforeSendHeaders` listener in background to capture headers from host app traffic (replaces XHR/fetch monkey-patching)

### Storage
- Replace ALL `GM_setValue`/`GM_getValue`/`GM.setValue`/`GM.getValue` with `chrome.storage.local`
- Replace ALL `localStorage` usage with `chrome.storage.local`
- Storage keys should be namespaced per module (e.g., `caddie:*`, `coliweb:*`, `gev:*`, `prov:*`, `surmesure:*`)

### UI Integration
- Content scripts inject UI elements into host pages using the same integration points as the originals (sidebar menu items, button locations, overlay positions)
- All injected UI must adapt to the host app's theme (dark/light) using the same detection approach (background color brightness analysis)
- Modals and overlays should have consistent styling across all modules
- No external CSS frameworks — use scoped inline styles or shadow DOM to prevent style leakage in both directions

### Code Quality
- Clean separation between modules — each module should be independently understandable
- Shared utilities extracted into common modules (API request wrapper, auth capture, notification system, theme detection, DOM observation helpers)
- Consistent error handling: all API calls wrapped in try/catch with user-facing French error messages
- Console logging with module-prefixed tags (e.g., `[Caddie]`, `[Coliweb]`, `[G.E.V.]`, `[Prov]`, `[SurMesure]`)

---

## Definition of Done

The extension is DONE when ALL of the following are true:

1. **Installable**: `chrome://extensions` → Load unpacked → extension loads without errors
2. **Manifest valid**: Manifest V3, all required permissions declared, content scripts match correct URL patterns
3. **All 5 modules functional**: each module's success criteria (listed above) are met
4. **No console errors**: on any target site, the extension produces no uncaught errors in the console during normal operation
5. **Storage works**: all data that was previously in GM storage or localStorage now persists correctly in `chrome.storage.local` across page navigations and browser restarts
6. **Cross-origin requests work**: all API calls that previously used `GM_xmlhttpRequest` now work through the background service worker without CORS errors
7. **No regressions**: every feature that worked in the Tampermonkey scripts works identically (or better) in the extension
8. **French UI**: all user-facing text is in French (matching the originals)
9. **Isolation**: the extension's CSS does not break host app styling; host app CSS does not break extension UI
10. **Multi-tab**: opening the same site in multiple tabs does not cause conflicts (especially for G.E.V. locking and auth capture)

---

## Development Phases

Execute these phases IN ORDER. Each phase should result in working, testable code before moving to the next.

### Phase 0 — Scaffolding
**Goal:** Working empty extension that loads on all target sites.

**Deliverables:**
- `manifest.json` with all permissions, content script declarations, background service worker
- Background service worker with message routing skeleton
- Content script entry points for each domain group (one per module)
- Shared utilities: message passing helpers, storage wrapper, logging

**Done when:** Extension loads without errors. Content scripts log their module name on each target site. Background service worker responds to ping messages.

---

### Phase 1 — Shared Infrastructure
**Goal:** All cross-cutting concerns working and tested.

**Deliverables:**
- **Auth capture system**: `chrome.webRequest.onBeforeSendHeaders` in background captures `kits-*` headers from `dc.kfplc.com` / `dc.dps.kd.kfplc.com` traffic, and `Authorization` headers from `api.kingfisher.com` traffic. Stored per-host in background memory. Content scripts can request current auth state via message.
- **API proxy**: content scripts send `{ type: 'API_REQUEST', url, method, headers, body }` → background does `fetch()` with appropriate auth headers + cookies → returns `{ status, data, headers }`. Supports retry with exponential backoff.
- **Storage wrapper**: async `get(key)`, `set(key, value)`, `delete(key)` functions using `chrome.storage.local`, usable from both content scripts and background.
- **Notification system**: injectable notification component (success/error/warning/info) matching the style of the original scripts. Centered modal variant + bottom-corner toast variant.
- **Theme detection**: utility function that returns `'dark'` or `'light'` based on page background color analysis.
- **DOM observer helpers**: `waitForElement(selector, timeout)`, `onElementAdded(selector, callback)`, SPA route change detection.
- **Concurrency limiter**: `pLimit(n)` utility for throttling parallel requests.

**Done when:** A test content script on `dc.kfplc.com` can: capture auth headers after user navigates, make an authenticated API request through background, store/retrieve data, show a notification, and detect theme.

---

### Phase 2 — Caddie Magique
**Goal:** Full CSV → basket creation flow working.

**Deliverables:**
- Sidebar button injection (matches host nav styling)
- CSV file picker + parser (columns A/I/J)
- Basket creation loop with discount application
- Progress modal with real-time log
- Auto-redirect on success / error message on full 409

**Done when:** Upload a CSV with 10+ items → all items added to basket with correct quantities and discounts → redirected to basket page.

---

### Phase 3 — Provisionnés
**Goal:** CSV import + page injection + filter working.

**Deliverables:**
- Menu button injection
- Import modal (themed, drag-drop, encoding/delimiter detection)
- CSV parser with smart header mapping
- Search page badge injection
- Detail page injection (PV Plancher, Prov %, remaining provisionnés)
- Provisionnés filter toggle in dropdown

**Done when:** Import a provisionnés CSV → badges appear on search results → detail pages show extra info → filter toggle hides non-provisionnés items.

---

### Phase 4 — Coliweb
**Goal:** Full delivery estimation + form autofill flow.

**Deliverables:**
- Sub-workflow A: button injection, DOM scraping, SAV API integration, geocoding, Colisweb API call, price popup
- Sub-workflow B: login auto-fill
- Sub-workflow C: delivery form auto-fill from stored data
- Cross-page data passing via `chrome.storage.local`

**Done when:** Click "Estimer" on basket → price appears → click "Programmer" → Coliweb login auto-fills → delivery form auto-fills with correct data.

---

### Phase 5 — G.E.V.
**Goal:** Full dashboard with both sections working.

**Deliverables:**
- Menu button injection
- Dashboard overlay (full dark theme, Chart.js donuts, collapsible tables)
- Anomalies scan + product detail fetch + sector grouping
- Ruptures scan (full store) + delivery date lookup
- Caching with 48h TTL
- Background rebuild with progress bars
- EEG flash integration
- Lock mechanism for concurrent scan prevention

**Done when:** Click G.E.V. → dashboard opens with cached data → background rebuild starts if stale → both sections show correct data → flash button triggers EEG labels.

---

### Phase 6 — Sur-Mesure Scraper
**Goal:** Quotation interception + Sheet submission + email feature.

**Deliverables:**
- Fetch/XHR interception on SquareClock domain
- Auth token capture from CAFR requests
- Quotation data extraction + customer lookup
- Google Sheet webhook submission
- Success/duplicate popup feedback
- Email button with HTML template + clipboard copy + mailto

**Done when:** Generate a quotation in SquareClock → data automatically sent to Google Sheet → success popup appears → email button works with correct template.

---

### Phase 7 — Polish & Hardening
**Goal:** Everything works together without conflicts.

**Deliverables:**
- Test all 5 modules are active simultaneously without interference
- Verify no console errors on any target site
- Verify storage namespacing prevents cross-module data corruption
- Verify auth capture works when multiple tabs are open
- Add extension popup with module status overview (which modules are active on current page)
- Final code cleanup: remove dead code, ensure consistent style

**Done when:** All Definition of Done criteria are met.

---

## Important Technical Notes

- **React input filling** (Coliweb): React apps don't respond to normal `.value = x` assignments. You must use the native HTMLInputElement value setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set`) and dispatch `input`, `change`, and `blur` events with `{ bubbles: true }`. This is critical for sub-workflows B and C.

- **Combobox filling** (Coliweb address field): The address field uses a Headless UI combobox. You must: set the value, dispatch `input` event to trigger dropdown, wait ~300ms, then click the first `[id^="headlessui-combobox-option-"]` element.

- **Chart.js**: The G.E.V. dashboard uses Chart.js 4.4.2 for donut charts. Load it as a web-accessible resource or bundle it. Register the `centerText` plugin for displaying totals in the donut hole.

- **SAV API responses**: The CastoSAV server returns XML-like responses where product data is extracted via regex (weight/dimension patterns like `(\d+)\s*kg` and `(\d+)\s*x\s*(\d+)\s*x\s*(\d+)\s*cm`). Handle this parsing robustly.

- **Sector mapping** (G.E.V.): The aisle-to-sector mapping is business logic that must be preserved exactly:
  - Aisles 1-22 → "Secteur Décoration"
  - Aisles 23-27 → "Secteur Aména - Sol"
  - Aisles 29,31,35,38 → "Secteur Aména - Salle de bain"
  - Aisles 40,43 → "Secteur Aména - Cuisine"
  - Aisles 28,30,32,33,34,36 → "Secteur Aména - Rangement"
  - Aisles 37,39,41,42 → "Secteur bâti - Menuiserie"
  - Aisles 44-53,55-58,76 → "Secteur Technique"
  - Aisles 59-63 → "Secteur bâti - Découpe"
  - Aisle 54, Aisles 64-75 → "Secteur Jardin"

- **Coliweb credentials**: username `castometz012`, password `cw12`. Store these in a module config constant, not hardcoded across multiple files.

- **Google Sheet URL**: `https://script.google.com/macros/s/AKfycbx6wfRJB2Qay_4g6Ms6NdxVEet9C-LoXya52j35s8g/dev` — this is a configuration constant that the user may need to change.

- **Manager ID for discounts** (Caddie Magique): `ARNAUD.DERHAN@CASTORAMA.FR` — also a configuration constant.

- **Store coordinates** (Coliweb pickup): lat `49.0750948`, lon `6.1000448`, postal code `57130`, store ID `8481`, client ID `249`.

- **HTML email template** (Sur-Mesure): preserve the EXACT HTML from the reference script. It's a carefully designed Castorama-branded email with specific image URLs, section structure, and placeholder tokens (`[montant]`, `[T]`, `[M]`, `[[Année actuelle]]`, etc.).

---

## Configuration Constants (extract into a single shared config)

```
STORE_CODE: "1502"
TENANT_ID: "CAFR"  
OPERATING_COMPANY: "CF01"
STORE_NAME: "Castorama Jouy-aux-Arches"
STORE_PHONE: "03 XX XX XX XX"
STORE_EMAIL: "metz2.menuiserie@castorama.fr"
MANAGER_ID: "ARNAUD.DERHAN@CASTORAMA.FR"
GOOGLE_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbx6wfRJB2Qay_4g6Ms6NdxVEet9C-LoXya52j35s8g/dev"
COLIWEB_USERNAME: "castometz012"
COLIWEB_PASSWORD: "cw12"
COLIWEB_CLIENT_ID: "249"
COLIWEB_STORE_ID: "8481"
STORE_LAT: 49.0750948
STORE_LON: 6.1000448
STORE_POSTAL: "57130"
GEOCODE_API_KEY: "65ae97aa4417a328160769gcb8adb4f"
EEG_SERVER: "http://eegserver1502.frca.kfplc.com:3333"
EEG_DEFAULT_FLASH_DURATION: 1800
GEV_CACHE_TTL_MS: 172800000 (48h)
```

---

## What NOT to Do

- Do NOT use any external CSS framework (Tailwind, Bootstrap, etc.) — all styling must be self-contained
- Do NOT use any build tools or bundlers that would require npm/webpack setup — the extension should work as plain JS loadable via "Load unpacked"
- Do NOT add features that aren't in the original scripts — this is a faithful refactor, not a redesign
- Do NOT modify host page behavior beyond what the original scripts do
- Do NOT store sensitive credentials in plain text in `chrome.storage` — keep them as constants in source code (same as originals)
- Do NOT ask for clarification — make reasonable decisions based on the reference scripts and this spec
