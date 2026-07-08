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
    meta.innerHTML = `v${mod.version} · ${mod.hosts.map((h) => `<code>${h}</code>`).join(' ')}`;

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

document.getElementById('ct-version').textContent =
  `Casto Tools v${chrome.runtime.getManifest().version}`;

renderModules();
