import { MODULES } from './lib/modules.js';

const modulesContainer = document.getElementById('modules');
const moduleTemplate = document.getElementById('module-template');
const statusElement = document.getElementById('status');
const runAllButton = document.getElementById('run-all');
const openOptionsButton = document.getElementById('open-options');

function setStatus(message, className = '') {
  statusElement.textContent = message || '';
  statusElement.className = `status ${className}`.trim();
}

function summarizeValue(result) {
  if (!result) {
    return 'No value';
  }

  if (result.type === 'currency') {
    return result.valueText || 'No value';
  }

  if (result.type === 'text') {
    return result.text || 'No value';
  }

  if (result.type === 'list') {
    return `${result.items?.length || 0} item(s)`;
  }

  if (result.type === 'error') {
    return result.error || 'Error';
  }

  return JSON.stringify(result);
}

function formatListItem(item) {
  return Object.entries(item)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}: ${value}`)
    .join(' | ');
}

function renderModuleCard(module, state) {
  const fragment = moduleTemplate.content.cloneNode(true);
  const root = fragment.querySelector('.module-card');
  const name = fragment.querySelector('.module-name');
  const meta = fragment.querySelector('.module-meta');
  const stateEl = fragment.querySelector('.module-state');
  const runButton = fragment.querySelector('.run-module');
  const resultsContainer = fragment.querySelector('.module-results');

  const moduleState = state.modules[module.id];
  const moduleResult = state.results?.[module.id];

  name.textContent = module.displayName;
  meta.textContent = moduleState?.enabled ? 'Enabled' : 'Disabled';
  stateEl.textContent = moduleResult?.lastRunAt
    ? `Last run: ${new Date(moduleResult.lastRunAt).toLocaleString()}`
    : 'Not run yet';
  stateEl.classList.toggle('ok', Boolean(moduleResult?.ok));
  stateEl.classList.toggle('error', moduleResult?.ok === false);

  runButton.addEventListener('click', async () => {
    runButton.disabled = true;
    setStatus(`Running ${module.displayName}...`);
    const response = await chrome.runtime.sendMessage({ type: 'RUN_MODULE', moduleId: module.id });
    runButton.disabled = false;

    if (!response?.ok) {
      setStatus(response?.error || 'Run failed.', 'error');
      return;
    }

    setStatus(`Finished ${module.displayName}.`, response.result?.ok ? 'ok' : 'error');
    await refresh();
  });

  const extractorState = moduleState?.extractorConfig || {};
  const extractorOrder = module.pages.flatMap((page) => page.extractors);
  for (const extractor of extractorOrder) {
    if (extractorState[extractor.id]?.enabled === false) {
      continue;
    }

    const result = moduleResult?.values?.[extractor.id];
    const item = document.createElement('section');
    item.className = 'result-item';

    const label = document.createElement('div');
    label.className = 'result-label';
    label.textContent = extractorState[extractor.id]?.label || extractor.label;
    item.appendChild(label);

    const value = document.createElement('div');
    value.className = 'result-value';
    value.textContent = summarizeValue(result);
    if (result?.type === 'error') {
      value.classList.add('error');
    }
    item.appendChild(value);

    if (result?.type === 'list' && Array.isArray(result.items)) {
      const list = document.createElement('ul');
      list.className = 'result-list';
      for (const listItem of result.items) {
        const li = document.createElement('li');
        li.textContent = formatListItem(listItem);
        list.appendChild(li);
      }
      item.appendChild(list);
    }

    if (result?.meta && Object.keys(result.meta).length) {
      const metaText = document.createElement('div');
      metaText.className = 'module-state muted';
      metaText.textContent = Object.entries(result.meta)
        .filter(([, entry]) => Boolean(entry))
        .map(([key, entry]) => `${key}: ${entry}`)
        .join(' | ');
      item.appendChild(metaText);
    }

    resultsContainer.appendChild(item);
  }

  if (!resultsContainer.children.length) {
    const empty = document.createElement('div');
    empty.className = 'module-state muted';
    empty.textContent = 'No enabled extractors or no results yet.';
    resultsContainer.appendChild(empty);
  }

  return root;
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (!response?.ok) {
    setStatus(response?.error || 'Could not load state.', 'error');
    return;
  }

  const state = response.state;
  modulesContainer.replaceChildren();
  for (const module of MODULES) {
    modulesContainer.appendChild(renderModuleCard(module, state));
  }
}

runAllButton.addEventListener('click', async () => {
  runAllButton.disabled = true;
  setStatus('Running all enabled modules...');
  const response = await chrome.runtime.sendMessage({ type: 'RUN_ALL' });
  runAllButton.disabled = false;

  if (!response?.ok) {
    setStatus(response?.error || 'Run failed.', 'error');
    return;
  }

  setStatus('Finished all modules.', 'ok');
  await refresh();
});

openOptionsButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.state) {
    refresh().catch((error) => setStatus(String(error), 'error'));
  }
});

refresh().catch((error) => setStatus(String(error), 'error'));
