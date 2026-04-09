import { MODULES } from './lib/modules.js';

const modulesContainer = document.getElementById('modules');
const moduleTemplate = document.getElementById('module-template');
const extractorTemplate = document.getElementById('extractor-template');
const optionsForm = document.getElementById('options-form');
const saveStatus = document.getElementById('save-status');

function setSaveStatus(message, className = '') {
  saveStatus.textContent = message;
  saveStatus.className = className;
}

function renderModule(module, state) {
  const fragment = moduleTemplate.content.cloneNode(true);
  const root = fragment.querySelector('.module-card');

  root.dataset.moduleId = module.id;
  fragment.querySelector('.module-name').textContent = module.displayName;
  fragment.querySelector('.module-description').textContent = `${module.pages.length} page(s), ${module.pages.flatMap((page) => page.extractors).length} extractor(s)`;
  fragment.querySelector('.module-enabled').checked = Boolean(state.enabled);
  fragment.querySelector('.credential-username').value = state.credentials?.username || '';
  fragment.querySelector('.credential-password').value = state.credentials?.password || '';

  const extractorList = fragment.querySelector('.extractor-list');
  for (const page of module.pages) {
    for (const extractor of page.extractors) {
      const extractorFragment = extractorTemplate.content.cloneNode(true);
      const row = extractorFragment.querySelector('.extractor-row');
      row.dataset.extractorId = extractor.id;
      extractorFragment.querySelector('.extractor-name').textContent = `${page.label}: ${extractor.label}`;
      extractorFragment.querySelector('.extractor-enabled').checked = state.extractorConfig?.[extractor.id]?.enabled !== false;
      extractorFragment.querySelector('.extractor-label').value = state.extractorConfig?.[extractor.id]?.label || extractor.label;
      extractorList.appendChild(extractorFragment);
    }
  }

  return root;
}

async function loadState() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (!response?.ok) {
    throw new Error(response?.error || 'Could not load state.');
  }

  const state = response.state;
  modulesContainer.replaceChildren();
  for (const module of MODULES) {
    modulesContainer.appendChild(renderModule(module, state.modules[module.id]));
  }
}

function collectState() {
  const nextState = { modules: {}, results: {} };

  for (const module of MODULES) {
    const root = modulesContainer.querySelector(`[data-module-id="${module.id}"]`);
    const extractorConfig = {};

    root.querySelectorAll('.extractor-row').forEach((row) => {
      extractorConfig[row.dataset.extractorId] = {
        enabled: row.querySelector('.extractor-enabled').checked,
        label: row.querySelector('.extractor-label').value.trim() || row.querySelector('.extractor-name').textContent
      };
    });

    nextState.modules[module.id] = {
      enabled: root.querySelector('.module-enabled').checked,
      credentials: {
        username: root.querySelector('.credential-username').value.trim(),
        password: root.querySelector('.credential-password').value
      },
      extractorConfig
    };
  }

  return nextState;
}

optionsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setSaveStatus('Saving...');

  const response = await chrome.runtime.sendMessage({
    type: 'SAVE_STATE',
    state: collectState()
  });

  if (!response?.ok) {
    setSaveStatus(response?.error || 'Save failed.', 'error');
    return;
  }

  setSaveStatus('Saved.', 'ok');
  await loadState();
});

loadState().catch((error) => setSaveStatus(String(error), 'error'));
