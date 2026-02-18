// ==UserScript==
// @name         Provisionnés
// @namespace    http://tampermonkey.net/
// @version      1.4.0 // UI overhaul: theme-aware modal, simplified UX, last import date, success toast
// @description  Upload CSV, map by EAN, inject Prov% + PV Plancher + Provisionnés restants (list & detail pages). Adds a filter to show only provisionnés in search results.
// @match        https://dc.kfplc.com/*
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
  'use strict';

  const LOG_PREFIX = '[ProvCSV]';
  const STORAGE_KEY = 'provCsvDataV3';
  const LAST_IMPORT_KEY = 'provCsvLastImportV1';

  GM_addStyle(`
    /* --- Modal Overlay --- */
    #provcsv-overlay{position:fixed;inset:0;z-index:999998;display:none;backdrop-filter:blur(4px);transition:background .2s}

    /* --- Modal Panel (Theme-Aware) --- */
    #provcsv-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,90vw);border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;transition:background .2s,color .2s,border-color .2s}
    #provcsv-panel h3{margin:0 0 6px 0;font-size:18px;font-weight:600;line-height:1.3}
    #provcsv-panel .provcsv-subtitle{margin:0 0 20px 0;font-size:13px;opacity:.7}
    #provcsv-panel .provcsv-last-import{display:flex;align-items:center;gap:8px;padding:12px 14px;border-radius:10px;margin-bottom:16px;font-size:13px}
    #provcsv-panel .provcsv-last-import svg{flex-shrink:0}
    #provcsv-panel .provcsv-last-import strong{font-weight:600}
    .provcsv-drop{border:2px dashed;border-radius:12px;padding:28px 20px;text-align:center;transition:background .15s,border-color .15s}
    .provcsv-drop.dragover{border-style:solid}
    .provcsv-drop-icon{margin-bottom:12px}
    .provcsv-drop-text{font-size:14px;font-weight:500;margin-bottom:4px}
    .provcsv-drop-hint{font-size:12px;opacity:.6}
    .provcsv-actions{display:flex;gap:10px;justify-content:flex-end;align-items:center;margin-top:20px}
    .provcsv-btn{border:none;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:500;cursor:pointer;transition:background .15s,transform .1s}
    .provcsv-btn:hover{transform:translateY(-1px)}
    .provcsv-btn:active{transform:translateY(0)}
    .provcsv-file-info{display:none;align-items:center;gap:10px;padding:12px 14px;border-radius:10px;margin-top:12px;font-size:13px}
    .provcsv-file-info.visible{display:flex}
    .provcsv-file-info svg{flex-shrink:0}
    .provcsv-file-info .provcsv-file-name{font-weight:500;word-break:break-all}
    .provcsv-file-info .provcsv-file-clear{margin-left:auto;cursor:pointer;opacity:.6;transition:opacity .15s}
    .provcsv-file-info .provcsv-file-clear:hover{opacity:1}
    .provcsv-badge{display:inline-block;padding:2px 6px;border-radius:6px;background:#ee3b3b;color:#fff;font:700 12px/1.2 system-ui,Segoe UI,Roboto,Arial;margin-top:4px;margin-right:6px}

    /* --- Toast Notification --- */
    #provcsv-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(100px);z-index:999999;padding:14px 20px;border-radius:12px;font:500 14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;gap:10px;box-shadow:0 10px 40px rgba(0,0,0,.2);opacity:0;transition:transform .3s cubic-bezier(.4,0,.2,1),opacity .3s}
    #provcsv-toast.show{transform:translateX(-50%) translateY(0);opacity:1}
    #provcsv-toast svg{flex-shrink:0}

    /* --- Dark Theme (Default) --- */
    #provcsv-overlay{background:rgba(0,0,0,.5)}
    #provcsv-panel{background:#1a1f2e;color:#e5e7eb;border:1px solid rgba(255,255,255,.1)}
    #provcsv-panel .provcsv-last-import{background:rgba(99,102,241,.1);color:#a5b4fc}
    #provcsv-panel .provcsv-last-import svg{color:#818cf8}
    .provcsv-drop{border-color:rgba(255,255,255,.15);background:rgba(255,255,255,.02)}
    .provcsv-drop.dragover{border-color:#6366f1;background:rgba(99,102,241,.1)}
    .provcsv-drop-icon svg{color:#6b7280}
    .provcsv-btn{background:rgba(255,255,255,.08);color:#e5e7eb}
    .provcsv-btn:hover{background:rgba(255,255,255,.12)}
    .provcsv-btn.primary{background:#6366f1;color:#fff}
    .provcsv-btn.primary:hover{background:#4f46e5}
    .provcsv-file-info{background:rgba(99,102,241,.1);color:#c7d2fe}
    .provcsv-file-info svg{color:#818cf8}
    #provcsv-toast{background:#1e293b;color:#e5e7eb;border:1px solid rgba(255,255,255,.1)}
    #provcsv-toast.success{background:#065f46;border-color:#059669}
    #provcsv-toast.success svg{color:#34d399}

    /* --- Light Theme --- */
    body.provcsv-light-theme #provcsv-overlay{background:rgba(0,0,0,.3)}
    body.provcsv-light-theme #provcsv-panel{background:#ffffff;color:#1f2937;border:1px solid rgba(0,0,0,.1);box-shadow:0 25px 50px -12px rgba(0,0,0,.15)}
    body.provcsv-light-theme #provcsv-panel .provcsv-last-import{background:#eef2ff;color:#4338ca}
    body.provcsv-light-theme #provcsv-panel .provcsv-last-import svg{color:#6366f1}
    body.provcsv-light-theme .provcsv-drop{border-color:#d1d5db;background:#f9fafb}
    body.provcsv-light-theme .provcsv-drop.dragover{border-color:#6366f1;background:#eef2ff}
    body.provcsv-light-theme .provcsv-drop-icon svg{color:#9ca3af}
    body.provcsv-light-theme .provcsv-btn{background:#f3f4f6;color:#374151}
    body.provcsv-light-theme .provcsv-btn:hover{background:#e5e7eb}
    body.provcsv-light-theme .provcsv-btn.primary{background:#6366f1;color:#fff}
    body.provcsv-light-theme .provcsv-btn.primary:hover{background:#4f46e5}
    body.provcsv-light-theme .provcsv-file-info{background:#eef2ff;color:#3730a3}
    body.provcsv-light-theme .provcsv-file-info svg{color:#6366f1}
    body.provcsv-light-theme #provcsv-toast{background:#ffffff;color:#1f2937;border:1px solid rgba(0,0,0,.1)}
    body.provcsv-light-theme #provcsv-toast.success{background:#ecfdf5;color:#065f46;border-color:#a7f3d0}
    body.provcsv-light-theme #provcsv-toast.success svg{color:#10b981}

    /* --- Theme-Aware In-Page Styles --- */
    .provcsv-small, .provcsv-inline, .provcsv-chip { transition: color .2s, background-color .2s, border-color .2s; }

    /* Default (Dark Theme) */
    .provcsv-small{display:block;margin-top:2px;color:#e6edf3;font:600 12px/1.3 system-ui,Segoe UI,Roboto,Arial;opacity:.95}
    .provcsv-inline{display:inline-block;margin-left:8px;padding:2px 6px;border-radius:6px;background:#111826;border:1px solid rgba(124,147,255,.35);font:600 12px/1.2 system-ui,Segoe UI,Roboto,Arial;color:#e6edf3}
    .provcsv-chip{display:inline-flex;align-items:center;padding:2px 6px;border-radius:999px;font:600 12px/1.1 system-ui,Segoe UI,Roboto,Arial;margin-right:8px;vertical-align:baseline;white-space:nowrap;border:1px solid rgba(124,147,255,.35);background:rgba(124,147,255,.08);color:#e6edf3;}
    .provcsv-chip.warn{border-color:rgba(240,140,0,.45);background:rgba(240,140,0,.10)}
    .provcsv-chip.bad{border-color:rgba(224,49,49,.45);background:rgba(224,49,49,.10)}

    /* Light Theme Overrides */
    body.provcsv-light-theme .provcsv-small { color: #334155; opacity: 1; }
    body.provcsv-light-theme .provcsv-inline { background: #e2e8f0; border-color: #cbd5e1; color: #1e293b; }
    body.provcsv-light-theme .provcsv-chip { color: #1e293b; background: rgba(0,0,0,.05); border-color: rgba(0,0,0,.15); }
    body.provcsv-light-theme .provcsv-chip.warn { color: #854d0e; background: #fefce8; border-color: #facc15; }
    body.provcsv-light-theme .provcsv-chip.bad { color: #991b1b; background: #fee2e2; border-color: #fca5a5; }

    /* Hide helper (still force inline too) */
    .provcsv-hide{display:none!important}
  `);

  const nfEUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
  const clean = (s) => String(s ?? '').trim();
  const onlyDigits = (s) => clean(s).replace(/[^\d]/g, '');

  const strip = (s) =>
    clean(s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\u00A0/g, ' ')
      .toLowerCase();

  const normHeader = (s) =>
    strip(s)
      .replace(/[%€]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\bref\b/g,'')
      .replace(/\s+/g,' ')
      .trim();

  const toInt = (s) => {
    const n = parseInt(String(s).replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };

  const decommaFloat = (s) => {
    if (s == null) return null;
    const str = clean(String(s)).replace(/[€%]/g,'').replace(/\s/g,'').replace(',', '.');
    const val = parseFloat(str);
    return Number.isFinite(val) ? val : null;
  };

  const calcProvisionnes = (stockJ1, qteSortir, currentStock) => {
    if ([stockJ1, qteSortir, currentStock].some(v => typeof v !== 'number')) return null;
    const target = stockJ1 - qteSortir;
    return Math.max(0, currentStock - target);
  };

  async function readTextSmart(file) {
    const buf = await file.arrayBuffer();
    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
    const badCount = (utf8.match(/\uFFFD/g) || []).length;
    if (badCount > utf8.length / 80) {
      const win = new TextDecoder('windows-1252', { fatal: false }).decode(new Uint8Array(buf));
      return win;
    }
    return utf8;
  }

  function parseCSVAuto(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const counts = { ',': (firstLine.match(/,/g)||[]).length, ';': (firstLine.match(/;/g)||[]).length, '\t': (firstLine.match(/\t/g)||[]).length };
    const delim = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0] || ',';
    return parseCSV(text, delim);
  }

  function parseCSV(text, delim) {
    const rows = [];
    let i = 0, field = '', row = [], inQuotes = false;

    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else { inQuotes = false; } }
        else { field += c; }
      } else {
        if (c === '"') inQuotes = true;
        else if (c === delim) { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c !== '\r') { field += c; }
      }
      i++;
    }
    row.push(field); rows.push(row);
    return rows.filter(r => r.some(cell => clean(cell) !== ''));
  }

  function mapHeaders(headerRow) {
    const original = headerRow.map(h => clean(h));
    const normalized = original.map(h => normHeader(h));
    const tokensList = normalized.map(h => new Set(h.split(' ').filter(Boolean)));
    const hasAny = (set, arr) => arr.some(a => set.has(a));
    const map = {};

    tokensList.forEach((tok, idx) => {
      const h = normalized[idx];
      if (!map[idx]) {
        if (tok.has('ean') || tok.has('barcode') || (tok.has('code') && hasAny(tok, ['barre','barres','bar']))) { map[idx] = 'ean'; return; }
      }
      if (!map[idx]) {
        const isQuantityTerm = hasAny(tok, ['qte','qt','quantite','qty']);
        const hasStockTerm = tok.has('stock');
        const isJ1Term = hasAny(tok, ['j','j1','j-1']) || tok.has('1') || /j ?-? ?1\b/.test(h) || /j ?moins ?1/.test(h);
        if (isQuantityTerm && hasStockTerm && isJ1Term) { map[idx] = 'stockJ1'; return; }
        if (!isQuantityTerm && hasStockTerm && tok.has('val') && isJ1Term) { return; }
      }
      if (!map[idx]) { if ((hasAny(tok, ['pv','prix']) && hasAny(tok, ['plancher']))) { map[idx] = 'pvPlancher'; return; } }
      if (!map[idx]) { if ((hasAny(tok, ['tx','taux']) && hasAny(tok, ['prov','provision','provisions']))) { map[idx] = 'txProv'; return; } }
      if (!map[idx]) {
        const qtyish = hasAny(tok, ['qte','qt','quantite','qty']);
        const sortish = Array.from(tok).some(t => t.startsWith('sort'));
        if (qtyish && sortish) { map[idx] = 'qteSortir'; return; }
      }
    });

    const got = Object.values(map);
    const required = ['ean','stockJ1','pvPlancher','txProv','qteSortir'];
    const missing = required.filter(k => !got.includes(k));

    return { map, missing, originalHeaders: original, normalizedHeaders: normalized };
  }

  function buildData(rows) {
    if (!rows.length) return { data:{}, headerInfo:null };
    const hdr = rows[0];
    const { map, missing, normalizedHeaders, originalHeaders } = mapHeaders(hdr);
    if (missing.length) {
      const debug = `En-tetes detectes:\n- Original: ${originalHeaders.join(' | ')}\n- Normalises: ${normalizedHeaders.join(' | ')}`;
      throw new Error(`Colonnes manquantes: ${missing.join(', ')}\n\n${debug}`);
    }
    const data = {};
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]; const rec = {};
      for (let c = 0; c < row.length; c++) {
        const key = map[c]; if (!key) continue; const val = row[c];
        if (key === 'ean') rec.ean = onlyDigits(val);
        else if (key === 'stockJ1') rec.stockJ1 = toInt(val);
        else if (key === 'pvPlancher') rec.pvPlancher = decommaFloat(val);
        else if (key === 'txProv') { const v = decommaFloat(val); rec.txProv = v != null && v < 1 && /[,\.]/.test(String(val)) ? v*100 : v; }
        else if (key === 'qteSortir') rec.qteSortir = toInt(val);
      }
      if (rec.ean) data[rec.ean] = rec;
    }
    return { data, headerInfo: { map, originalHeaders, normalizedHeaders } };
  }

  // ---------- UI ----------
  const SVG_ICONS = {
    upload: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    file: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    calendar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  function formatRelativeDate(dateStr) {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 0) return `Aujourd'hui à ${timeStr}`;
    if (diffDays === 1) return `Hier à ${timeStr}`;
    if (diffDays < 7) return `Il y a ${diffDays} jours`;
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  async function getLastImportInfo() {
    try {
      const info = await GM_getValue(LAST_IMPORT_KEY, null);
      return info;
    } catch { return null; }
  }

  async function setLastImportInfo(count) {
    const info = { date: new Date().toISOString(), count };
    await GM_setValue(LAST_IMPORT_KEY, info);
    return info;
  }

  function showToast(message, type = 'success') {
    let toast = document.getElementById('provcsv-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'provcsv-toast';
      document.body.appendChild(toast);
    }
    toast.className = type;
    toast.innerHTML = `${SVG_ICONS.check}<span>${message}</span>`;
    requestAnimationFrame(() => {
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3500);
    });
  }

  function ensureModal() {
    if (document.getElementById('provcsv-overlay')) return;
    const ov = document.createElement('div');
    ov.id = 'provcsv-overlay';
    ov.innerHTML = `
      <div id="provcsv-panel" role="dialog" aria-modal="true">
        <h3>Importer les données</h3>
        <p class="provcsv-subtitle">Fichier CSV des provisionnés</p>
        <div class="provcsv-last-import" id="provcsv-last-import" style="display:none">
          ${SVG_ICONS.calendar}
          <span>Dernier import : <strong id="provcsv-last-date">—</strong> · <span id="provcsv-last-count">0</span> articles</span>
        </div>
        <div class="provcsv-drop" id="provcsv-drop">
          <input type="file" id="provcsv-file" accept=".csv,text/csv,.tsv,text/tab-separated-values" style="display:none" />
          <div class="provcsv-drop-icon">${SVG_ICONS.upload}</div>
          <div class="provcsv-drop-text">Glissez votre fichier ici</div>
          <div class="provcsv-drop-hint">ou cliquez pour parcourir</div>
        </div>
        <div class="provcsv-file-info" id="provcsv-file-info">
          ${SVG_ICONS.file}
          <span class="provcsv-file-name" id="provcsv-file-name"></span>
          <span class="provcsv-file-clear" id="provcsv-file-clear" title="Supprimer">${SVG_ICONS.x}</span>
        </div>
        <div class="provcsv-actions">
          <button class="provcsv-btn" id="provcsv-cancel">Annuler</button>
          <button class="provcsv-btn primary" id="provcsv-load">Importer</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const drop = ov.querySelector('#provcsv-drop');
    const fileEl = ov.querySelector('#provcsv-file');
    const cancel = ov.querySelector('#provcsv-cancel');
    const load = ov.querySelector('#provcsv-load');
    const fileInfo = ov.querySelector('#provcsv-file-info');
    const fileName = ov.querySelector('#provcsv-file-name');
    const fileClear = ov.querySelector('#provcsv-file-clear');
    const lastImportEl = ov.querySelector('#provcsv-last-import');
    const lastDateEl = ov.querySelector('#provcsv-last-date');
    const lastCountEl = ov.querySelector('#provcsv-last-count');
    let pendingFile = null;

    function setFile(f) {
      pendingFile = f;
      if (f) {
        fileName.textContent = f.name;
        fileInfo.classList.add('visible');
      } else {
        fileName.textContent = '';
        fileInfo.classList.remove('visible');
      }
    }

    async function updateLastImportDisplay() {
      const info = await getLastImportInfo();
      if (info && info.date) {
        const formatted = formatRelativeDate(info.date);
        if (formatted) {
          lastDateEl.textContent = formatted;
          lastCountEl.textContent = info.count?.toLocaleString('fr-FR') || '0';
          lastImportEl.style.display = 'flex';
          return;
        }
      }
      lastImportEl.style.display = 'none';
    }

    // Update display when modal opens
    ov.addEventListener('transitionend', updateLastImportDisplay);
    updateLastImportDisplay();

    ['dragenter', 'dragover'].forEach(evt => drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(evt => drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.remove('dragover'); }));

    drop.addEventListener('drop', e => {
      const f = e.dataTransfer.files?.[0];
      if (f) setFile(f);
    });

    drop.addEventListener('click', () => fileEl.click());
    fileEl.addEventListener('change', () => {
      const f = fileEl.files?.[0];
      if (f) setFile(f);
    });

    fileClear.addEventListener('click', (e) => {
      e.stopPropagation();
      setFile(null);
      fileEl.value = '';
    });

    cancel.addEventListener('click', closeOverlay);
    ov.addEventListener('click', (e) => { if (e.target === ov) closeOverlay(); });

    load.addEventListener('click', async () => {
      if (!pendingFile) {
        drop.style.borderColor = '#ef4444';
        setTimeout(() => drop.style.borderColor = '', 1500);
        return;
      }
      load.disabled = true;
      load.textContent = 'Import…';
      try {
        const text = await readTextSmart(pendingFile);
        const rows = parseCSVAuto(text);
        const { data, headerInfo } = buildData(rows);
        await GM_setValue(STORAGE_KEY, data);
        DATA = data;
        const count = Object.keys(DATA).length;
        await setLastImportInfo(count);
        console.log(LOG_PREFIX, 'Data loaded', { count, headerInfo, sample: DATA[Object.keys(DATA)[0]] });
        closeOverlay();
        showToast(`${count.toLocaleString('fr-FR')} articles importés avec succès`);
        applyEverywhere();
        setFile(null);
        fileEl.value = '';
      } catch (err) {
        console.error(LOG_PREFIX, err);
        showToast(`Erreur: ${err.message || err}`, 'error');
      } finally {
        load.disabled = false;
        load.textContent = 'Importer';
      }
    });
  }

  function injectMenuButton() {
    if (document.getElementById('provcsv-menu-btn')) return;
    const pricerLi = document.querySelector('a[data-auto="menu-link-pricer"]')?.parentElement;
    if (!pricerLi) return;
    const newLi = document.createElement('li');
    const newLink = document.createElement('a');
    newLink.href = "#";
    newLink.id = "provcsv-menu-btn";
    newLink.className = "menu__nav-link";
    newLink.textContent = "MAJ Provisionnés";
    newLink.setAttribute('tabindex', '0');
    newLink.setAttribute('data-auto', 'menu-link-provcsv');
    newLink.addEventListener('click', (e) => { e.preventDefault(); openOverlay(); });
    newLi.appendChild(newLink);
    newLi.appendChild(document.createComment(''));
    pricerLi.insertAdjacentElement('afterend', newLi);
    console.log(LOG_PREFIX, 'Menu item "MAJ Provisionnés" injected.');
  }

  function openOverlay() {
    detectAndSetTheme();
    const el = document.getElementById('provcsv-overlay');
    if (el) {
      el.style.display = 'block';
      // Trigger last import update
      getLastImportInfo().then(info => {
        const lastImportEl = el.querySelector('#provcsv-last-import');
        const lastDateEl = el.querySelector('#provcsv-last-date');
        const lastCountEl = el.querySelector('#provcsv-last-count');
        if (info && info.date && lastImportEl) {
          const formatted = formatRelativeDate(info.date);
          if (formatted) {
            lastDateEl.textContent = formatted;
            lastCountEl.textContent = info.count?.toLocaleString('fr-FR') || '0';
            lastImportEl.style.display = 'flex';
          }
        }
      });
    }
  }
  function closeOverlay() { const el = document.getElementById('provcsv-overlay'); if (el) el.style.display = 'none'; }

  // ---------- Data ----------
  let DATA = {};
  async function loadData() { DATA = await GM_getValue(STORAGE_KEY, {}); if (!DATA || typeof DATA !== 'object') DATA = {}; }

  // ---------- Injections ----------
  const eur = (n) => (n != null ? nfEUR.format(n) : '—');

  function getEffectiveBackgroundColor(el) {
    let element = el;
    while (element) {
      const color = window.getComputedStyle(element).backgroundColor;
      if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
      element = element.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }

  function detectAndSetTheme() {
    const body = document.body;
    const contentArea = document.querySelector('.container__body') || body;
    if (!contentArea) return;
    try {
      const bgColor = getEffectiveBackgroundColor(contentArea);
      const rgbMatch = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      body.classList.remove('provcsv-light-theme', 'provcsv-dark-theme');
      if (rgbMatch) {
        const r = parseInt(rgbMatch[1], 10), g = parseInt(rgbMatch[2], 10), b = parseInt(rgbMatch[3], 10);
        ((r+g+b)/3 > 128) ? body.classList.add('provcsv-light-theme') : body.classList.add('provcsv-dark-theme');
      } else { body.classList.add('provcsv-dark-theme'); }
    } catch (e) {
      console.error(LOG_PREFIX, "Theme detection failed, defaulting to dark.", e);
      body.classList.add('provcsv-dark-theme');
    }
  }

  function injectOnSearchList(root = document) {
    const cards = root.querySelectorAll('main.container__body ul.list-border li .prod-group');
    if (!cards?.length) return;
    cards.forEach(card => {
      const eanEl = card.querySelector('[data-auto="product-ean"]');
      const priceLi = card.querySelector('.prod-group__price, .price');
      if (!eanEl || !priceLi) return;
      const ean = onlyDigits(eanEl.textContent);
      if (!ean || !DATA[ean]) return;
      const rec = DATA[ean];
      if (priceLi.querySelector('.provcsv-badge')) return;
      const badge = document.createElement('div');
      badge.className = 'provcsv-badge';
      badge.textContent = `Prov. ${Math.round(rec.txProv ?? 0)}%`;
      const info = document.createElement('div');
      info.className = 'provcsv-small';
      info.textContent = `PV Plancher: ${eur(rec.pvPlancher)}`;
      priceLi.appendChild(badge); priceLi.appendChild(info);
    });
  }

  function injectOnProductDetail(doc = document) {
    const m = location.pathname.match(/\/product-query\/(\d{8,14})$/);
    if (!m) return;
    const ean = m[1];
    const rec = DATA[ean];
    if (!rec) return;

    const priceWrap = doc.querySelector('.prod-group__details .prod-group__price, .prod-price .prod-group__price, .prod-group__price');
    if (priceWrap && !priceWrap.parentElement.querySelector('.provcsv-extraRow')) {
      const extraRow = document.createElement('div');
      extraRow.className = 'provcsv-extraRow';
      extraRow.style.marginTop = '6px';
      const pv = document.createElement('span');
      pv.className = 'provcsv-inline';
      pv.textContent = `PV Plancher: ${eur(rec.pvPlancher)}`;
      const badge = document.createElement('span');
      badge.style.marginLeft = '8px';
      badge.className = 'provcsv-badge';
      badge.textContent = `Prov. ${Math.round(rec.txProv ?? 0)}%`;
      extraRow.appendChild(pv); extraRow.appendChild(badge);
      priceWrap.parentElement.insertBefore(extraRow, priceWrap.nextSibling);
    }

    const totalRow = Array.from(doc.querySelectorAll('table.table-styled tbody tr'))
      .find(tr => /Total/i.test(tr.textContent || ''));
    if (totalRow) {
      const qtyTd = totalRow.querySelector('td.text-right');
      let currentStock = null;
      const qtyNumberEl = qtyTd ? (qtyTd.querySelector('span,strong') || qtyTd.firstChild) : null;
      if (qtyNumberEl) currentStock = toInt(qtyNumberEl.textContent);

      if (qtyTd && currentStock != null && !qtyTd.querySelector('.provcsv-chip')) {
        const remain = calcProvisionnes(rec.stockJ1 ?? null, rec.qteSortir ?? null, currentStock);
        if (remain != null) {
          const pill = document.createElement('span');
          pill.className = 'provcsv-chip' + (remain === 0 ? '' : remain <= 2 ? ' warn' : ' bad');
          pill.title = `Stock J-1: ${rec.stockJ1 ?? '—'} | À sortir: ${rec.qteSortir ?? '—'}`;
          pill.textContent = `${remain} provisionné${remain>1?'s':''} rest.`;
          qtyTd.insertBefore(pill, qtyTd.firstChild);
        }
      }
    }
  }

  // ---------- Provisionnés Filter (robust + inline hide) ----------
  const FILTER_STORAGE_KEY = 'provCsvFilterProvOnlyV1';
  let PROV_FILTER_ONLY = false;

  async function loadFilterPref() {
    try { PROV_FILTER_ONLY = !!(await GM_getValue(FILTER_STORAGE_KEY, false)); }
    catch { PROV_FILTER_ONLY = false; }
  }
  async function setFilterPref(v) {
    PROV_FILTER_ONLY = !!v;
    try { await GM_setValue(FILTER_STORAGE_KEY, PROV_FILTER_ONLY); } catch {}
  }

  function isProvisionneByData(ean) {
    const rec = DATA && DATA[ean];
    if (!rec) return false;
    if (rec.txProv == null) return true;
    const n = Number(rec.txProv);
    return Number.isFinite(n) ? n > 0 : true;
  }

  function getEANFromLi(li) {
    // Prefer span text
    const span = li.querySelector('[data-auto="product-ean"]');
    const fromSpan = span ? onlyDigits(span.textContent) : '';
    if (fromSpan) return fromSpan;
    // Fallback: digits in href (/product-query/XXXXXXXXXXXX)
    const a = li.querySelector('a[href^="/product-query/"]');
    const m = a && a.getAttribute('href').match(/\/product-query\/(\d{8,14})/);
    return m ? m[1] : '';
  }

  function toggleHide(node, hide) {
    if (!node) return;
    if (hide) {
      node.classList.add('provcsv-hide');
      node.setAttribute('hidden', '');
      node.style.setProperty('display', 'none', 'important');
      node.style.setProperty('visibility', 'hidden', 'important');
    } else {
      node.classList.remove('provcsv-hide');
      node.removeAttribute('hidden');
      node.style.removeProperty('display');
      node.style.removeProperty('visibility');
    }
  }

  function applyProvisionnesFilter(root = document) {
    const list = root.querySelector('main.container__body ul.list-border');
    if (!list) return;

    // Unhide everything first if OFF
    if (!PROV_FILTER_ONLY) {
      list.querySelectorAll(':scope > li.provcsv-hide, :scope > li[hidden]').forEach(li => toggleHide(li, false));
      return;
    }
    if (!DATA || !Object.keys(DATA).length) return; // No data => don't nuke the list.

    const items = list.querySelectorAll(':scope > li');
    let hidden = 0, kept = 0;
    items.forEach(li => {
      const ean = getEANFromLi(li);
      const keep = ean && isProvisionneByData(ean);
      toggleHide(li, !keep);
      keep ? kept++ : hidden++;
    });
    // Optional debug
    console.log(LOG_PREFIX, `Filter applied. kept=${kept} hidden=${hidden} (pref=${PROV_FILTER_ONLY})`);
  }

  function ensureProvisionnesMenuItem(context = document) {
    const lists = Array.from(context.querySelectorAll('div[data-auto="vc-dropdown-list"].dropdown__list'));
    if (!lists.length) return;

    lists.forEach(list => {
      const labels = Array.from(list.querySelectorAll('button[role="menuitem"]')).map(b => (b.textContent || '').trim());
      const looksLikeResultFilter = labels.some(t => /en stock/i.test(t)) && labels.some(t => /en gamme/i.test(t));
      if (!looksLikeResultFilter) return;

      const existing = list.querySelector('#provcsv-filter-provisionnes');
      if (existing) {
        existing.setAttribute('aria-checked', String(PROV_FILTER_ONLY));
        return;
      }

      const btn = document.createElement('button');
      btn.id = 'provcsv-filter-provisionnes';
      btn.type = 'button';
      btn.className = 'dropdown__list-button';
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('tabindex', '-1');
      btn.setAttribute('data-auto', 'vc-dropdown-list-button');
      btn.setAttribute('aria-checked', String(PROV_FILTER_ONLY));
      btn.textContent = ' Provisionnés ';

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        await setFilterPref(!PROV_FILTER_ONLY);
        document.querySelectorAll('#provcsv-filter-provisionnes')
          .forEach(el => el.setAttribute('aria-checked', String(PROV_FILTER_ONLY)));
        applyProvisionnesFilter(document);
        // Re-apply after Vue reflows
        setTimeout(() => applyProvisionnesFilter(document), 80);
        setTimeout(() => applyProvisionnesFilter(document), 300);
      });

      list.appendChild(btn);
    });
  }

  // ---------- SPA observation ----------
  let lastPath = location.pathname;

  function applyEverywhere(root = document) {
    injectMenuButton();
    detectAndSetTheme();
    try {
      const url = location.href;
      if (/\/product-query\/search\//.test(url)) {
        injectOnSearchList(root);
        ensureProvisionnesMenuItem(root);
      }
      // If results list exists, (re)apply filter regardless
      if (root.querySelector('main.container__body ul.list-border')) {
        applyProvisionnesFilter(root);
        // Attach a one-time observer to the list to keep enforcing after virtualized updates
        const list = root.querySelector('main.container__body ul.list-border');
        if (list && !list._provcsvObserved) {
          list._provcsvObserved = true;
          const listObs = new MutationObserver(() => {
            // Slight debounce
            if (listObs._pending) return;
            listObs._pending = true;
            setTimeout(() => { listObs._pending = false; applyProvisionnesFilter(document); }, 60);
          });
          listObs.observe(list, { childList: true, subtree: false });
        }
      }
      if (/\/product-query\/\d{8,14}$/.test(url)) injectOnProductDetail(root);
    } catch (e) { console.error(LOG_PREFIX, 'applyEverywhere error', e); }
  }

  const observer = new MutationObserver(muts => {
    const pathNow = location.pathname;
    const significant = muts.some(m => m.addedNodes && m.addedNodes.length > 0);
    if (pathNow !== lastPath) {
      lastPath = pathNow;
      setTimeout(() => applyEverywhere(document), 60);
      return;
    }
    if (significant) {
      if (observer._pending) return;
      observer._pending = true;
      setTimeout(() => { observer._pending = false; applyEverywhere(document); }, 80);
    }
  });

  (async function boot() {
    ensureModal();
    await loadData();
    await loadFilterPref();
    setTimeout(() => applyEverywhere(document), 120);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    console.log(LOG_PREFIX, 'Ready. Loaded EANs:', Object.keys(DATA).length, 'ProvOnly:', PROV_FILTER_ONLY);
  })();

})();
