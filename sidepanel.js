import { MODULES } from './lib/modules.js';

const modulesContainer = document.getElementById('modules');
const moduleTemplate = document.getElementById('module-template');
const statusElement = document.getElementById('status');
const globalSummaryElement = document.getElementById('global-summary');
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
  if (!item) {
    return 'No details';
  }

  if (item.category && item.amount) {
    return item.detail ? `${item.category}: ${item.amount} (${item.detail})` : `${item.category}: ${item.amount}`;
  }

  if (item.policy && item.value) {
    return item.account ? `${item.policy}: ${item.value} (${item.account})` : `${item.policy}: ${item.value}`;
  }

  return Object.values(item)
    .filter(Boolean)
    .join(' | ');
}

function getExtractorPageMap(module) {
  const pageMap = new Map();
  for (const page of module.pages) {
    for (const extractor of page.extractors) {
      pageMap.set(extractor.id, page.id);
    }
  }
  return pageMap;
}

function sumCurrencyResults(results = {}) {
  return Object.values(results).reduce((sum, result) => {
    if (result?.type === 'currency' && typeof result.valueNumber === 'number' && !Number.isNaN(result.valueNumber)) {
      return sum + result.valueNumber;
    }
    return sum;
  }, 0);
}

function createSummaryItem(labelText, valueText) {
  const item = document.createElement('section');
  item.className = 'result-item summary-item';

  const label = document.createElement('div');
  label.className = 'result-label';
  label.textContent = labelText;
  item.appendChild(label);

  const value = document.createElement('div');
  value.className = 'result-value';
  value.textContent = valueText || 'No value';
  item.appendChild(value);

  return item;
}

function collectPageResults(module, moduleResult, pageId) {
  if (!moduleResult?.values) {
    return {};
  }

  const extractorPageMap = getExtractorPageMap(module);
  const pageResults = {};
  for (const [extractorId, result] of Object.entries(moduleResult.values)) {
    if (extractorPageMap.get(extractorId) === pageId) {
      pageResults[extractorId] = result;
    }
  }

  return pageResults;
}

function collectNetWorthResults(module, moduleResult) {
  if (!moduleResult?.values) {
    return {};
  }

  const extractorPageMap = getExtractorPageMap(module);
  const results = {};

  for (const [extractorId, result] of Object.entries(moduleResult.values)) {
    const pageId = extractorPageMap.get(extractorId);
    if (pageId !== 'cashflow' && result?.type === 'currency') {
      results[extractorId] = result;
    }
  }

  return results;
}

function getCashflowTotals(cashflowResults = {}) {
  return {
    income: typeof cashflowResults.cashflowIncome?.valueNumber === 'number'
      ? cashflowResults.cashflowIncome.valueNumber
      : 0,
    fixed: typeof cashflowResults.cashflowFixed?.valueNumber === 'number'
      ? cashflowResults.cashflowFixed.valueNumber
      : 0,
    discretionary: typeof cashflowResults.cashflowDiscretionary?.valueNumber === 'number'
      ? cashflowResults.cashflowDiscretionary.valueNumber
      : 0
  };
}

function renderGlobalSummary(state) {
  globalSummaryElement.replaceChildren();

  let netWorthTotal = 0;
  let hasNetWorth = false;
  let totalIncome = 0;
  let totalFixed = 0;
  let totalDiscretionary = 0;
  let hasCashflowData = false;

  for (const module of MODULES) {
    const moduleResult = state.results?.[module.id];
    const netWorthResults = collectNetWorthResults(module, moduleResult);
    const cashflowResults = collectPageResults(module, moduleResult, 'cashflow');

    if (Object.keys(netWorthResults).length) {
      netWorthTotal += sumCurrencyResults(netWorthResults);
      hasNetWorth = true;
    }

    const cashflowTotals = getCashflowTotals(cashflowResults);
    if (cashflowTotals.income || cashflowTotals.fixed || cashflowTotals.discretionary) {
      totalIncome += cashflowTotals.income;
      totalFixed += cashflowTotals.fixed;
      totalDiscretionary += cashflowTotals.discretionary;
      hasCashflowData = true;
    }
  }

  if (hasNetWorth) {
    globalSummaryElement.appendChild(
      createSummaryItem(
        'Net worth summary',
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(netWorthTotal)
      )
    );
  }

  if (hasCashflowData) {
    globalSummaryElement.appendChild(
      createSummaryItem(
        'Net cash flow summary',
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
          totalIncome - totalFixed - totalDiscretionary
        )
      )
    );
  }

  globalSummaryElement.classList.toggle('is-empty', !globalSummaryElement.children.length);
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
  renderGlobalSummary(state);
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
