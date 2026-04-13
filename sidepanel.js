import { MODULES } from './lib/modules.js';
import { getDefaultExtractorLabel } from './lib/displayLabels.js';
import {
  computeGlobalMetricDetails,
  computeHistoricalMetrics,
  getEffectiveExtractorResult,
  getInterpolatedExtractorValue
} from './lib/metrics.js';

const modulesContainer = document.getElementById('modules');
const statusElement = document.getElementById('status');
const globalSummaryElement = document.getElementById('global-summary');
const staleNoteElement = document.getElementById('stale-note');
const runAllButton = document.getElementById('run-all');
const runMenuToggleButton = document.getElementById('run-menu-toggle');
const runMenuListElement = document.getElementById('run-menu-list');
const openOptionsButton = document.getElementById('open-options');
const blurValuesToggle = document.getElementById('blur-values-toggle');
const blurValuesIcon = document.getElementById('blur-values-icon');

const BLUR_VALUES_STORAGE_KEY = 'blurValuesEnabled';

const SECTION_DEFINITIONS = [
  {
    id: 'investments-insurance',
    title: 'Investments',
    entryIds: [
      'wealthfrontBrokerage',
      'schwabTotalValue',
      'brokerageIndividual',
      'adjustableComplifeTotal',
      'bofaAutoLoan'
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

const MONTHLY_ONLY_ENTRY_IDS = new Set([
  'cashflowIncome',
  'cashflowFixed',
  'cashflowDiscretionary'
]);

const LOCKED_ICON = `
  <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M17 10h-1V7a4 4 0 1 0-8 0v3H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Zm-7-3a2 2 0 1 1 4 0v3h-4V7Zm7 12H7v-7h10v7Z" fill="currentColor"/>
  </svg>
`;

const UNLOCKED_ICON = `
  <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M17 10h-5V7a2 2 0 1 1 4 0h2a4 4 0 1 0-8 0v3H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Zm0 9H7v-7h10v7Z" fill="currentColor"/>
  </svg>
`;

function setStatus(message, className = '') {
  statusElement.textContent = message || '';
  statusElement.className = `status ${className}`.trim();
}

function setBlurValuesEnabled(enabled) {
  document.body.classList.toggle('values-blurred', enabled);
  blurValuesToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  blurValuesToggle.setAttribute('aria-label', enabled ? 'Show values' : 'Blur values');
  blurValuesToggle.title = enabled ? 'Show values' : 'Blur values';
  blurValuesIcon.innerHTML = enabled ? LOCKED_ICON : UNLOCKED_ICON;
  localStorage.setItem(BLUR_VALUES_STORAGE_KEY, enabled ? 'true' : 'false');
}

function initializeBlurValuesToggle() {
  const savedValue = localStorage.getItem(BLUR_VALUES_STORAGE_KEY);
  setBlurValuesEnabled(savedValue === 'true');

  blurValuesToggle.addEventListener('click', () => {
    const nextEnabled = blurValuesToggle.getAttribute('aria-pressed') !== 'true';
    setBlurValuesEnabled(nextEnabled);
  });
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

function getDisplayMultiplier(extractor) {
  return typeof extractor.netWorthMultiplier === 'number' ? extractor.netWorthMultiplier : 1;
}

function formatDelta(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'No history';
  }

  const prefix = value >= 0 ? '+' : '-';
  return `${prefix}${formatCurrency(Math.abs(value))}`;
}

function formatCompactCurrency(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'No history';
  }

  const absolute = Math.abs(value);
  const prefix = value >= 0 ? '+' : '-';

  if (absolute < 1000) {
    return `${prefix}${formatCurrency(Math.round(absolute))}`;
  }

  const units = [
    { threshold: 1e9, suffix: 'b' },
    { threshold: 1e6, suffix: 'm' },
    { threshold: 1e3, suffix: 'k' }
  ];

  for (const unit of units) {
    if (absolute >= unit.threshold) {
      const scaled = absolute / unit.threshold;
      const digits = scaled >= 100 ? 0 : 1;
      const rounded = Number(scaled.toFixed(digits));
      return `${prefix}$${rounded}${unit.suffix}`;
    }
  }

  return `${prefix}${formatCurrency(absolute)}`;
}

function createChangeRow(dailyChange, monthlyChange, options = {}) {
  const showDaily = options.showDaily !== false;
  const showMonthly = options.showMonthly !== false;
  const changeRow = document.createElement('div');
  changeRow.className = 'summary-change-row';

  if (showDaily) {
    const dailyPill = document.createElement('span');
    dailyPill.className = 'summary-change-pill';
    dailyPill.textContent = `1D ${formatCompactCurrency(dailyChange)}`;
    changeRow.appendChild(dailyPill);
  }

  if (showMonthly) {
    const monthlyPill = document.createElement('span');
    monthlyPill.className = 'summary-change-pill';
    monthlyPill.textContent = `1M ${formatCompactCurrency(monthlyChange)}`;
    changeRow.appendChild(monthlyPill);
  }

  return changeRow;
}

function createSummaryCard(labelText, currentValue, dailyChange, monthlyChange, isStale = false, options = {}) {
  const item = document.createElement('section');
  item.className = 'result-item summary-item';

  const label = document.createElement('div');
  label.className = 'result-label';
  label.textContent = labelText;
  item.appendChild(label);

  const value = document.createElement('div');
  value.className = 'result-value';
  value.textContent = `${formatCurrency(currentValue)}${isStale ? '*' : ''}`;
  item.appendChild(value);

  item.appendChild(createChangeRow(dailyChange, monthlyChange, options));

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
  closeRunMenu();
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

function closeRunMenu() {
  runMenuListElement.hidden = true;
  runMenuToggleButton.setAttribute('aria-expanded', 'false');
}

function openRunMenu() {
  runMenuListElement.hidden = false;
  runMenuToggleButton.setAttribute('aria-expanded', 'true');
}

function toggleRunMenu() {
  if (runMenuListElement.hidden) {
    openRunMenu();
    return;
  }

  closeRunMenu();
}

function renderRunMenu(state) {
  runMenuListElement.replaceChildren();

  const runAllItem = document.createElement('button');
  runAllItem.type = 'button';
  runAllItem.className = 'run-menu-item';
  runAllItem.textContent = 'All';
  runAllItem.setAttribute('role', 'menuitem');
  runAllItem.addEventListener('click', () => {
    closeRunMenu();
    runAllButton.click();
  });
  runMenuListElement.appendChild(runAllItem);

  for (const module of MODULES) {
    if (!state.modules?.[module.id]?.enabled) {
      continue;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'run-menu-item';
    button.textContent = module.displayName;
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', () => {
      runSingleModule(module.id, button).catch((error) => {
        button.disabled = false;
        setStatus(String(error), 'error');
      });
    });

    runMenuListElement.appendChild(button);
  }
}

function renderGlobalSummary(state) {
  globalSummaryElement.replaceChildren();
  const metricDetails = computeGlobalMetricDetails(state);
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);
  const dailyMetrics = computeHistoricalMetrics(state, oneDayAgo);
  const monthlyMetrics = computeHistoricalMetrics(state, oneMonthAgo);

  globalSummaryElement.appendChild(
    createSummaryCard(
      'Net worth',
      metricDetails.netWorth.value,
      dailyMetrics.netWorth === null ? null : metricDetails.netWorth.value - dailyMetrics.netWorth,
      monthlyMetrics.netWorth === null ? null : metricDetails.netWorth.value - monthlyMetrics.netWorth,
      metricDetails.netWorth.isStale
    )
  );

  globalSummaryElement.appendChild(
    createSummaryCard(
      'Monthly Cash Flow',
      metricDetails.netCashflow.value,
      dailyMetrics.netCashflow === null ? null : metricDetails.netCashflow.value - dailyMetrics.netCashflow,
      monthlyMetrics.netCashflow === null ? null : metricDetails.netCashflow.value - monthlyMetrics.netCashflow,
      metricDetails.netCashflow.isStale,
      { showDaily: false }
    )
  );

  globalSummaryElement.classList.toggle('is-empty', !globalSummaryElement.children.length);
  return metricDetails.netWorth.isStale || metricDetails.netCashflow.isStale;
}

function getPageUrlByExtractorId(module, extractorId) {
  for (const page of module.pages) {
    if (page.extractors.some((extractor) => extractor.id === extractorId)) {
      return page.url;
    }
  }

  return '';
}

function collectDisplayEntries(state) {
  const entries = new Map();
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);

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

        if (!SECTION_DEFINITIONS.some((section) => section.entryIds.includes(extractor.id))) {
          continue;
        }

        const { result, isStale } = getEffectiveExtractorResult(state, module.id, extractor.id);
        const displayMultiplier = getDisplayMultiplier(extractor);
        entries.set(extractor.id, {
          id: extractor.id,
          label: moduleState.extractorConfig?.[extractor.id]?.label || getDefaultExtractorLabel(extractor),
          result,
          isStale,
          displayMultiplier,
          dailyHistoricalValue: getInterpolatedExtractorValue(state, extractor.id, oneDayAgo),
          monthlyHistoricalValue: getInterpolatedExtractorValue(state, extractor.id, oneMonthAgo),
          sourceUrl: getPageUrlByExtractorId(module, extractor.id),
          sourceModuleName: module.displayName
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

  const signedValueNumber = entry.result?.type === 'currency' && typeof entry.result.valueNumber === 'number'
    ? entry.result.valueNumber * (entry.displayMultiplier || 1)
    : null;
  const valueText = signedValueNumber === null
    ? summarizeValue(entry.result)
    : formatCurrency(signedValueNumber);
  const canOpenSource = Boolean(entry.sourceUrl) && entry.result?.type !== 'error';
  const value = document.createElement(canOpenSource ? 'button' : 'div');
  value.className = canOpenSource ? 'result-value result-value-link' : 'result-value';
  value.textContent = `${valueText}${entry.isStale && valueText !== 'No value' ? '*' : ''}`;

  if (canOpenSource) {
    value.type = 'button';
    value.title = `Open ${entry.sourceModuleName}`;
    value.addEventListener('click', async () => {
      await chrome.tabs.create({ url: entry.sourceUrl });
    });
  }

  if (entry.result?.type === 'error') {
    value.classList.add('error');
  }

  item.appendChild(value);

  if (entry.result?.type === 'currency' && typeof signedValueNumber === 'number' && !Number.isNaN(signedValueNumber)) {
    const signedDailyHistoricalValue = typeof entry.dailyHistoricalValue === 'number'
      ? entry.dailyHistoricalValue * (entry.displayMultiplier || 1)
      : null;
    const signedMonthlyHistoricalValue = typeof entry.monthlyHistoricalValue === 'number'
      ? entry.monthlyHistoricalValue * (entry.displayMultiplier || 1)
      : null;
    const dailyChange = typeof entry.dailyHistoricalValue === 'number'
      ? signedValueNumber - signedDailyHistoricalValue
      : null;
    const monthlyChange = typeof entry.monthlyHistoricalValue === 'number'
      ? signedValueNumber - signedMonthlyHistoricalValue
      : null;
    item.appendChild(
      createChangeRow(dailyChange, monthlyChange, {
        showDaily: !MONTHLY_ONLY_ENTRY_IDS.has(entry.id)
      })
    );
  }

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

function renderGroupedSections(entries) {
  let hasStaleValues = false;

  for (const sectionDefinition of SECTION_DEFINITIONS) {
    const { card, results } = createSectionCard(sectionDefinition.title);
    for (const entryId of sectionDefinition.entryIds) {
      const entry = entries.get(entryId);
      if (entry) {
        hasStaleValues = hasStaleValues || entry.isStale;
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

  return hasStaleValues;
}

function renderStaleNote(show) {
  if (!show) {
    staleNoteElement.hidden = true;
    staleNoteElement.textContent = '';
    return;
  }

  staleNoteElement.hidden = false;
  staleNoteElement.textContent = 'Values marked * use the latest saved scrape result and may be out of date.';
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (!response?.ok) {
    setStatus(response?.error || 'Could not load state.', 'error');
    return;
  }

  const state = response.state;
  modulesContainer.replaceChildren();
  const entries = collectDisplayEntries(state);
  renderRunMenu(state);
  const hasStaleSummary = renderGlobalSummary(state);
  const hasStaleValues = renderGroupedSections(entries);
  renderStaleNote(hasStaleSummary || hasStaleValues);
}

runAllButton.addEventListener('click', async () => {
  runAllButton.disabled = true;
  closeRunMenu();
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

runMenuToggleButton.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleRunMenu();
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.run-menu')) {
    closeRunMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeRunMenu();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.state) {
    refresh().catch((error) => setStatus(String(error), 'error'));
  }
});

initializeBlurValuesToggle();
refresh().catch((error) => setStatus(String(error), 'error'));
