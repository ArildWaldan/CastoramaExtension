// Casto Tools — popup : activation/désactivation des modules.
'use strict';

async function renderModules() {
  const list = document.getElementById('ct-module-list');
  const enabledMap = await castoGetEnabledMap();
  list.textContent = '';

  for (const mod of CASTO_MODULES) {
    const row = document.createElement('div');
    row.className = 'ct-module';

    const info = document.createElement('div');
    info.className = 'ct-module-info';

    const name = document.createElement('div');
    name.className = 'ct-module-name';
    name.textContent = mod.name;

    const desc = document.createElement('div');
    desc.className = 'ct-module-desc';
    desc.textContent = mod.description;

    const meta = document.createElement('div');
    meta.className = 'ct-module-meta';
    meta.innerHTML = mod.hosts.map((h) => `<code>${h}</code>`).join(' ');

    info.append(name, desc, meta);

    const label = document.createElement('label');
    label.className = 'ct-switch';
    label.title = enabledMap[mod.id] ? 'Désactiver' : 'Activer';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!enabledMap[mod.id];
    input.addEventListener('change', async () => {
      await castoSetModuleEnabled(mod.id, input.checked);
      label.title = input.checked ? 'Désactiver' : 'Activer';
    });

    const slider = document.createElement('span');
    slider.className = 'ct-slider';

    label.append(input, slider);
    row.append(info, label);
    list.appendChild(row);
  }
}

// Feuille de route : toggles grisés, non activables — simple aperçu de ce
// qui arrive (cf. CASTO_ROADMAP dans core/modules.js).
function renderRoadmap() {
  const list = document.getElementById('ct-roadmap-list');
  list.textContent = '';

  for (const item of CASTO_ROADMAP) {
    const row = document.createElement('div');
    row.className = 'ct-module ct-ghost';

    const info = document.createElement('div');
    info.className = 'ct-module-info';

    const name = document.createElement('div');
    name.className = 'ct-module-name';
    name.textContent = item.name;

    const soon = document.createElement('span');
    soon.className = 'ct-soon';
    soon.textContent = 'Bientôt';
    name.appendChild(soon);

    const desc = document.createElement('div');
    desc.className = 'ct-module-desc';
    desc.textContent = item.description;

    info.append(name, desc);

    const label = document.createElement('label');
    label.className = 'ct-switch';
    label.title = 'En développement';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = false;
    input.disabled = true;

    const slider = document.createElement('span');
    slider.className = 'ct-slider';

    label.append(input, slider);
    row.append(info, label);
    list.appendChild(row);
  }
}

renderModules();
renderRoadmap();
