import { MODULES } from './lib/modules.js';
import { computeGlobalMetrics } from './lib/metrics.js';

const modulesContainer = document.getElementById('modules');
const statusElement = document.getElementById('status');
const moduleActionsElement = document.getElementById('module-actions');
const globalSummaryElement = document.getElementById('global-summary');
const runAllButton = document.getElementById('run-all');
const openOptionsButton = document.getElementById('open-options');

const SECTION_DEFINITIONS = [
  {
    id: 'investments-insurance',
    title: 'Brokerage + Life Insurance',
    entryIds: [
      'wealthfrontBrokerage',
      'schwabTotalValue',
      'brokerageIndividual',
      'adjustableComplifeTotal'
    ]
  },
  {
    id: 'bank-spending',
    title: 'Bank + Spending',
    entryIds: [
      'wellsFargoChecking',
      'cashflowIncome',
      'cashflowFixed',
      'cashflowDiscretionary',
      'cashflowBreakdown'
    ]
  }
];

const DISPLAY_LABELS = {
  wealthfrontBrokerage: 'Wealthfront brokerage account',
  schwabTotalValue: 'Schwab brokerage account',
  brokerageIndividual: 'Northwestern brokerage account',
  adjustableComplifeTotal: 'Life insurance',
  wellsFargoChecking: 'Wells Fargo Checking',
  cashflowIncome: 'Monthly Income',
  cashflowFixed: 'Monthly Fixed',
  cashflowDiscretionary: 'Monthly Discretionary',
  cashflowBreakdown: 'Discretionary Spending Breakdown'
};

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

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);
}

function formatDelta(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'No history';
  }

  const prefix = value >= 0 ? '+' : '-';
  return `${prefix}${formatCurrency(Math.abs(value))}`;
}

function getInterpolatedMetricValue(snapshots, metricKey, targetTimestamp) {
  const sorted = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);
  const withMetric = sorted.filter((snapshot) => typeof snapshot.metrics?.[metricKey] === 'number');

  if (!withMetric.length) {
    return null;
  }

  const exact = withMetric.find((snapshot) => snapshot.timestamp === targetTimestamp);
  if (exact) {
    return exact.metrics[metricKey];
  }

  const before = [...withMetric].reverse().find((snapshot) => snapshot.timestamp < targetTimestamp);
  const after = withMetric.find((snapshot) => snapshot.timestamp > targetTimestamp);

  if (!before || !after) {
    return null;
  }

  const totalWindow = after.timestamp - before.timestamp;
  if (totalWindow <= 0) {
    return before.metrics[metricKey];
  }

  const progress = (targetTimestamp - before.timestamp) / totalWindow;
  return before.metrics[metricKey] + ((after.metrics[metricKey] - before.metrics[metricKey]) * progress);
}

function createSummaryCard(labelText, currentValue, dailyChange, monthlyChange) {
  const item = document.createElement('section');
  item.className = 'result-item summary-item';

  const label = document.createElement('div');
  label.className = 'result-label';
  label.textContent = labelText;
  item.appendChild(label);

  const value = document.createElement('div');
  value.className = 'result-value';
  value.textContent = formatCurrency(currentValue);
  item.appendChild(value);

  const changeRow = document.createElement('div');
  changeRow.className = 'summary-change-row';
  changeRow.innerHTML = `
    <span class="summary-change-pill">1D ${formatDelta(dailyChange)}</span>
    <span class="summary-change-pill">1M ${formatDelta(monthlyChange)}</span>
  `;
  item.appendChild(changeRow);

  return item;
}

function createBreakdownChip(itemData) {
  const chip = document.createElement('li');
  chip.className = 'breakdown-chip';

  const category = document.createElement('span');
  category.className = 'breakdown-chip-category';
  category.textContent = itemData?.category || 'Category';
  chip.appendChild(category);

  const amount = document.createElement('span');
  amount.className = 'breakdown-chip-amount';
  amount.textContent = itemData?.amount || '';
  chip.appendChild(amount);

  if (itemData?.detail) {
    const detail = document.createElement('span');
    detail.className = 'breakdown-chip-detail';
    detail.textContent = itemData.detail;
    chip.appendChild(detail);
  }

  return chip;
}

function createSectionCard(title) {
  const card = document.createElement('article');
  card.className = 'module-card';

  const heading = document.createElement('h2');
  heading.className = 'module-name';
  heading.textContent = title;
  card.appendChild(heading);

  const results = document.createElement('div');
  results.className = 'module-results';
  card.appendChild(results);

  return { card, results };
}

async function runSingleModule(moduleId, button) {
  const module = MODULES.find((candidate) => candidate.id === moduleId);
  button.disabled = true;
  setStatus(`Running ${module?.displayName || moduleId}...`);

  const response = await chrome.runtime.sendMessage({
    type: 'RUN_MODULE',
    moduleId,
    preserveTabOnFailure: true
  });

  button.disabled = false;

  if (!response?.ok) {
    setStatus(response?.error || `Failed to run ${module?.displayName || moduleId}.`, 'error');
    return;
  }

  if (!response.result?.ok) {
    const debugHint = response.result?.debugTabKeptOpen ? ' Debug tab left open.' : '';
    setStatus(
      response.result?.error || `${module?.displayName || moduleId} failed.${debugHint}`,
      'error'
    );
    await refresh();
    return;
  }

  setStatus(`Finished ${module?.displayName || moduleId}.`, 'ok');
  await refresh();
}

function renderModuleActions(state) {
  moduleActionsElement.replaceChildren();

  for (const module of MODULES) {
    if (!state.modules?.[module.id]?.enabled) {
      continue;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'module-action-button';
    button.textContent = `Run ${module.displayName}`;
    button.addEventListener('click', () => {
      runSingleModule(module.id, button).catch((error) => {
        button.disabled = false;
        setStatus(String(error), 'error');
      });
    });

    moduleActionsElement.appendChild(button);
  }

  moduleActionsElement.classList.toggle('is-empty', !moduleActionsElement.children.length);
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
  const metrics = computeGlobalMetrics(state);
  const snapshots = state.history?.snapshots || [];
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);

  const netWorthDaily = getInterpolatedMetricValue(snapshots, 'netWorth', oneDayAgo);
  const netWorthMonthly = getInterpolatedMetricValue(snapshots, 'netWorth', oneMonthAgo);
  const cashflowDaily = getInterpolatedMetricValue(snapshots, 'netCashflow', oneDayAgo);
  const cashflowMonthly = getInterpolatedMetricValue(snapshots, 'netCashflow', oneMonthAgo);

  globalSummaryElement.appendChild(
    createSummaryCard(
      'Net worth',
      metrics.netWorth,
      netWorthDaily === null ? null : metrics.netWorth - netWorthDaily,
      netWorthMonthly === null ? null : metrics.netWorth - netWorthMonthly
    )
  );

  globalSummaryElement.appendChild(
    createSummaryCard(
      'Monthly Cash Flow',
      metrics.netCashflow,
      cashflowDaily === null ? null : metrics.netCashflow - cashflowDaily,
      cashflowMonthly === null ? null : metrics.netCashflow - cashflowMonthly
    )
  );

  globalSummaryElement.classList.toggle('is-empty', !globalSummaryElement.children.length);
}

function collectDisplayEntries(state) {
  const entries = new Map();

  for (const module of MODULES) {
    const moduleState = state.modules[module.id];
    if (!moduleState?.enabled) {
      continue;
    }

    const extractorState = moduleState.extractorConfig || {};
    for (const page of module.pages) {
      for (const extractor of page.extractors) {
        if (extractorState[extractor.id]?.enabled === false) {
          continue;
        }

        if (!Object.prototype.hasOwnProperty.call(DISPLAY_LABELS, extractor.id)) {
          continue;
        }

        const result = state.results?.[module.id]?.values?.[extractor.id];
        entries.set(extractor.id, {
          id: extractor.id,
          label: DISPLAY_LABELS[extractor.id],
          result
        });
      }
    }
  }

  return entries;
}

function renderDisplayItem(entry) {
  const item = document.createElement('section');
  item.className = 'result-item';

  const label = document.createElement('div');
  label.className = 'result-label';
  label.textContent = entry.label;
  item.appendChild(label);

  const value = document.createElement('div');
  value.className = 'result-value';
  value.textContent = summarizeValue(entry.result);
  if (entry.result?.type === 'error') {
    value.classList.add('error');
  }
  item.appendChild(value);

  if (entry.id === 'cashflowBreakdown' && entry.result?.type === 'list' && Array.isArray(entry.result.items)) {
    const list = document.createElement('ul');
    list.className = 'breakdown-chip-list';
    for (const breakdownItem of entry.result.items) {
      list.appendChild(createBreakdownChip(breakdownItem));
    }
    item.appendChild(list);
    return item;
  }

  if (entry.result?.type === 'list' && Array.isArray(entry.result.items)) {
    const list = document.createElement('ul');
    list.className = 'result-list';
    for (const listItem of entry.result.items) {
      const li = document.createElement('li');
      li.textContent = formatListItem(listItem);
      list.appendChild(li);
    }
    item.appendChild(list);
  }

  return item;
}

function renderGroupedSections(state) {
  const entries = collectDisplayEntries(state);

  for (const sectionDefinition of SECTION_DEFINITIONS) {
    const { card, results } = createSectionCard(sectionDefinition.title);
    for (const entryId of sectionDefinition.entryIds) {
      const entry = entries.get(entryId);
      if (entry) {
        results.appendChild(renderDisplayItem(entry));
      }
    }

    if (!results.children.length) {
      const empty = document.createElement('div');
      empty.className = 'module-state muted';
      empty.textContent = 'No results yet.';
      results.appendChild(empty);
    }

    modulesContainer.appendChild(card);
  }
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (!response?.ok) {
    setStatus(response?.error || 'Could not load state.', 'error');
    return;
  }

  const state = response.state;
  modulesContainer.replaceChildren();
  renderModuleActions(state);
  renderGlobalSummary(state);
  renderGroupedSections(state);
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
