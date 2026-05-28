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
const RUNNING_STATUS_TIMEOUT_MS = 30 * 60 * 1000;

const SECTION_DEFINITIONS = [
  {
    id: 'investments-insurance',
    title: 'Investments',
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
      'bofaAutoLoan',
      'chaseCreditCardBalance',
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

const INVESTMENT_PERCENT_ENTRY_IDS = new Set([
  'wealthfrontBrokerage',
  'schwabTotalValue',
  'brokerageIndividual',
  'adjustableComplifeTotal'
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

const BREAKDOWN_CATEGORY_ALIASES = {
  Automotive: ['Automotive', 'Auto', 'Car'],
  'Bills & Utilities': ['Bills & Utilities', 'Bills', 'Utilities'],
  Education: ['Education'],
  Entertainment: ['Entertainment'],
  'Fees & Adjustments': ['Fees & Adjustments', 'Fees'],
  'Food & Drink': ['Food & Drink', 'Dining', 'Dining Out', 'Restaurants'],
  Gas: ['Gas', 'Fuel'],
  'Gifts & Donations': ['Gifts & Donations', 'Gifts', 'Donations'],
  Groceries: ['Groceries', 'Groceries & Household'],
  'Health & Wellness': ['Health & Wellness', 'Health', 'Medical', 'Wellness'],
  Home: ['Home', 'Home Goods'],
  Miscellaneous: ['Miscellaneous', 'Misc'],
  Other: ['Other', 'Miscellaneous', 'Misc', 'Unknown', 'Uncategorized'],
  Personal: ['Personal', 'Personal Care'],
  'Professional Services': ['Professional Services', 'Services'],
  Shopping: ['Shopping'],
  Travel: ['Travel']
};

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

function parseCurrencyText(valueText) {
  if (!valueText) {
    return null;
  }

  const normalized = String(valueText).replace(/,/g, '').trim();
  const match = normalized.match(/\$?([0-9]+(?:\.[0-9]{1,2})?)/);
  if (!match) {
    return null;
  }

  const isNegative = normalized.includes('-') || normalized.includes('(');
  return Number(match[1]) * (isNegative ? -1 : 1);
}

function getDisplayMultiplier(extractor) {
  return typeof extractor.netWorthMultiplier === 'number' ? extractor.netWorthMultiplier : 1;
}

function getModuleRunStatus(state, moduleId) {
  return state.runStatus?.modules?.[moduleId] || null;
}

function isModuleUpdating(state, moduleId) {
  const status = getModuleRunStatus(state, moduleId);
  if (status?.status !== 'running') {
    return false;
  }

  const startedAtMs = Date.parse(status.startedAt || '');
  if (!Number.isFinite(startedAtMs) || Date.now() - startedAtMs >= RUNNING_STATUS_TIMEOUT_MS) {
    return false;
  }

  const result = state.results?.[moduleId];
  const resultFinishedAtMs = Date.parse(result?.lastRunAt || '');
  if (result?.inProgress !== true && Number.isFinite(resultFinishedAtMs) && resultFinishedAtMs >= startedAtMs) {
    return false;
  }

  return true;
}

function hasUpdatingModule(state) {
  return MODULES.some((module) => isModuleUpdating(state, module.id));
}

function getExtractorCashflowRole(extractor, pageId) {
  if (typeof extractor.cashflowRole === 'string') {
    return extractor.cashflowRole;
  }

  if (pageId !== 'cashflow') {
    return null;
  }

  if (extractor.id === 'cashflowIncome') {
    return 'income';
  }

  if (extractor.id === 'cashflowFixed') {
    return 'fixed';
  }

  if (extractor.id === 'cashflowDiscretionary') {
    return 'discretionary';
  }

  return null;
}

function isAggregateCashflowUpdating(state, cashflowRole) {
  for (const module of MODULES) {
    if (!isModuleUpdating(state, module.id)) {
      continue;
    }

    const moduleState = state.modules?.[module.id];
    if (!moduleState?.enabled) {
      continue;
    }

    for (const page of module.pages) {
      for (const extractor of page.extractors) {
        if (moduleState.extractorConfig?.[extractor.id]?.enabled === false) {
          continue;
        }

        if (getExtractorCashflowRole(extractor, page.id) === cashflowRole) {
          return true;
        }
      }
    }
  }

  return false;
}

function normalizeCategoryKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getCategoryAliases(categoryLabel) {
  return BREAKDOWN_CATEGORY_ALIASES[categoryLabel] || [categoryLabel];
}

function resolveBreakdownCategory(existingItems, chaseCategory) {
  const existingCategoryMap = new Map(
    existingItems.map((item) => [normalizeCategoryKey(item.category), item.category])
  );

  for (const alias of getCategoryAliases(chaseCategory)) {
    const normalizedAlias = normalizeCategoryKey(alias);
    if (existingCategoryMap.has(normalizedAlias)) {
      return existingCategoryMap.get(normalizedAlias);
    }
  }

  const fuzzyMatch = existingItems.find((item) => {
    const normalizedExisting = normalizeCategoryKey(item.category);
    return getCategoryAliases(chaseCategory).some((alias) => {
      const normalizedAlias = normalizeCategoryKey(alias);
      return normalizedExisting.includes(normalizedAlias) || normalizedAlias.includes(normalizedExisting);
    });
  });

  if (fuzzyMatch?.category) {
    return fuzzyMatch.category;
  }

  const otherCategory = existingItems.find((item) => normalizeCategoryKey(item.category) === 'other');
  if (otherCategory?.category) {
    return otherCategory.category;
  }

  return 'Other';
}

function formatBreakdownPercentage(amountValue, totalValue) {
  if (typeof amountValue !== 'number' || Number.isNaN(amountValue)) {
    return '';
  }

  const denominator = Math.abs(totalValue);
  if (!denominator || Number.isNaN(denominator)) {
    return '';
  }

  const percentage = (Math.abs(amountValue) / denominator) * 100;
  if (!Number.isFinite(percentage)) {
    return '';
  }

  return `${percentage >= 10 ? percentage.toFixed(0) : percentage.toFixed(1)}% of discretionary`;
}

function mergeBreakdownItems(existingItems, chaseItems, totalDiscretionaryValue = null) {
  const merged = new Map();
  const mergeItem = (item, categoryLabel) => {
    const amountValue = parseCurrencyText(item.amount);
    if (typeof amountValue !== 'number' || Number.isNaN(amountValue)) {
      return;
    }

    const current = merged.get(categoryLabel) || {
      category: categoryLabel,
      amountValue: 0
    };

    current.amountValue += amountValue;
    merged.set(categoryLabel, current);
  };

  for (const item of existingItems) {
    mergeItem(item, item.category);
  }

  for (const item of chaseItems) {
    mergeItem(item, resolveBreakdownCategory(existingItems, item.category));
  }

  return Array.from(merged.values())
    .sort((left, right) => right.amountValue - left.amountValue)
    .map((item) => ({
      category: item.category,
      amount: formatCurrency(item.amountValue),
      detail: formatBreakdownPercentage(item.amountValue, totalDiscretionaryValue)
    }));
}

function createSyntheticBreakdownItem(category, amountValue) {
  if (typeof amountValue !== 'number' || Number.isNaN(amountValue) || amountValue === 0) {
    return null;
  }

  return {
    category,
    amount: formatCurrency(amountValue)
  };
}

function sumBreakdownItems(items) {
  if (!Array.isArray(items) || !items.length) {
    return 0;
  }

  return items.reduce((total, item) => {
    const amountValue = parseCurrencyText(item?.amount);
    if (typeof amountValue !== 'number' || Number.isNaN(amountValue)) {
      return total;
    }

    return total + amountValue;
  }, 0);
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

function formatPercentChange(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'No history';
  }

  const prefix = value >= 0 ? '+' : '-';
  const absolute = Math.abs(value);
  const digits = absolute >= 100 ? 0 : 1;
  return `${prefix}${absolute.toFixed(digits)}%`;
}

function createChangeRow(dailyChange, monthlyChange, options = {}) {
  const showDaily = options.showDaily !== false;
  const showMonthly = options.showMonthly !== false;
  const showMonthlyPercent = options.showMonthlyPercent === true;
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

  if (showMonthlyPercent) {
    const monthlyPercentPill = document.createElement('span');
    monthlyPercentPill.className = 'summary-change-pill';
    monthlyPercentPill.textContent = `1M ${formatPercentChange(options.monthlyPercentChange)}`;
    changeRow.appendChild(monthlyPercentPill);
  }

  return changeRow;
}

function createUpdatingIndicator() {
  const indicator = document.createElement('span');
  indicator.className = 'updating-indicator';
  indicator.textContent = 'Updating';
  return indicator;
}

function createSummaryCard(labelText, currentValue, dailyChange, monthlyChange, isStale = false, options = {}) {
  const item = document.createElement('section');
  item.className = 'result-item summary-item';
  item.classList.toggle('is-updating', options.isUpdating === true);

  const labelRow = document.createElement('div');
  labelRow.className = 'result-label-row';
  const label = document.createElement('div');
  label.className = 'result-label';
  label.textContent = labelText;
  labelRow.appendChild(label);
  if (options.isUpdating) {
    labelRow.appendChild(createUpdatingIndicator());
  }
  item.appendChild(labelRow);

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
      metricDetails.netWorth.isStale,
      { isUpdating: hasUpdatingModule(state) }
    )
  );

  globalSummaryElement.appendChild(
    createSummaryCard(
      'Monthly Cash Flow',
      metricDetails.netCashflow.value,
      dailyMetrics.netCashflow === null ? null : metricDetails.netCashflow.value - dailyMetrics.netCashflow,
      monthlyMetrics.netCashflow === null ? null : metricDetails.netCashflow.value - monthlyMetrics.netCashflow,
      metricDetails.netCashflow.isStale,
      { showDaily: false, isUpdating: hasUpdatingModule(state) }
    )
  );

  globalSummaryElement.classList.toggle('is-empty', !globalSummaryElement.children.length);
  return metricDetails.netWorth.isStale || metricDetails.netCashflow.isStale;
}

function buildAggregateCashflowEntry(extractorId, state, timestamps = {}) {
  const metricDetails = computeGlobalMetricDetails(state);
  const dailyMetrics = typeof timestamps.oneDayAgo === 'number'
    ? computeHistoricalMetrics(state, timestamps.oneDayAgo)
    : null;
  const monthlyMetrics = typeof timestamps.oneMonthAgo === 'number'
    ? computeHistoricalMetrics(state, timestamps.oneMonthAgo)
    : null;

  const aggregateMap = {
    cashflowIncome: {
      value: metricDetails.income.value,
      isStale: metricDetails.income.isStale,
      role: 'income',
      dailyHistoricalValue: dailyMetrics?.income ?? null,
      monthlyHistoricalValue: monthlyMetrics?.income ?? null
    },
    cashflowFixed: {
      value: metricDetails.fixed.value,
      isStale: metricDetails.fixed.isStale,
      role: 'fixed',
      dailyHistoricalValue: dailyMetrics?.fixed ?? null,
      monthlyHistoricalValue: monthlyMetrics?.fixed ?? null
    },
    cashflowDiscretionary: {
      value: metricDetails.discretionary.value,
      isStale: metricDetails.discretionary.isStale,
      role: 'discretionary',
      dailyHistoricalValue: dailyMetrics?.discretionary ?? null,
      monthlyHistoricalValue: monthlyMetrics?.discretionary ?? null
    }
  };

  const aggregate = aggregateMap[extractorId];
  if (!aggregate) {
    return null;
  }

  const northwesternModule = MODULES.find((module) => module.id === 'northwesternMutual');
  const northwesternCashflowUrl = northwesternModule
    ? getPageUrlByExtractorId(northwesternModule, 'cashflowDiscretionary')
    : '';

  return {
    id: extractorId,
    label: getDefaultExtractorLabel({ id: extractorId, label: extractorId }),
    result: {
      type: 'currency',
      label: getDefaultExtractorLabel({ id: extractorId, label: extractorId }),
      valueText: formatCurrency(aggregate.value),
      valueNumber: aggregate.value
    },
    isStale: aggregate.isStale,
    isUpdating: isAggregateCashflowUpdating(state, aggregate.role),
    displayMultiplier: 1,
    dailyHistoricalValue: aggregate.dailyHistoricalValue,
    monthlyHistoricalValue: aggregate.monthlyHistoricalValue,
    sourceUrl: northwesternCashflowUrl,
    sourceModuleName: northwesternModule?.displayName || 'Northwestern Mutual'
  };
}

function getPageUrlByExtractorId(module, extractorId) {
  for (const page of module.pages) {
    if (page.extractors.some((extractor) => extractor.id === extractorId)) {
      return page.url;
    }
  }

  return '';
}

function buildDisplayEntry(state, extractorId, timestamps = {}) {
  if (extractorId === 'cashflowDiscretionary') {
    return buildAggregateCashflowEntry(extractorId, state, timestamps);
  }

  const oneDayAgo = timestamps.oneDayAgo;
  const oneMonthAgo = timestamps.oneMonthAgo;

  for (const module of MODULES) {
    const moduleState = state.modules?.[module.id];
    if (!moduleState?.enabled) {
      continue;
    }

    const extractorState = moduleState.extractorConfig || {};
    for (const page of module.pages) {
      const extractor = page.extractors.find((candidate) => candidate.id === extractorId);
      if (!extractor) {
        continue;
      }

      if (extractorState[extractor.id]?.enabled === false) {
        return null;
      }

      const { result, isStale } = getEffectiveExtractorResult(state, module.id, extractor.id);
      return {
        id: extractor.id,
        label: moduleState.extractorConfig?.[extractor.id]?.label || getDefaultExtractorLabel(extractor),
        result,
        isStale,
        isUpdating: isModuleUpdating(state, module.id),
        displayMultiplier: getDisplayMultiplier(extractor),
        dailyHistoricalValue: typeof oneDayAgo === 'number'
          ? getInterpolatedExtractorValue(state, extractor.id, oneDayAgo)
          : null,
        monthlyHistoricalValue: typeof oneMonthAgo === 'number'
          ? getInterpolatedExtractorValue(state, extractor.id, oneMonthAgo)
          : null,
        sourceUrl: getPageUrlByExtractorId(module, extractor.id),
        sourceModuleName: module.displayName
      };
    }
  }

  return null;
}

function collectDisplayEntries(state) {
  const entries = new Map();
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);
  const timestamps = { oneDayAgo, oneMonthAgo };

  for (const sectionDefinition of SECTION_DEFINITIONS) {
    for (const entryId of sectionDefinition.entryIds) {
      if (entries.has(entryId)) {
        continue;
      }

      const entry = buildDisplayEntry(state, entryId, timestamps);
      if (entry) {
        entries.set(entryId, entry);
      }
    }
  }

  const chaseBreakdownEntry = buildDisplayEntry(state, 'chaseDiscretionaryBreakdown');
  const chaseSpendEntry = buildDisplayEntry(state, 'chaseDiscretionarySpend');
  const chaseBalanceEntry = buildDisplayEntry(state, 'chaseCreditCardBalance');
  const discretionaryEntry = entries.get('cashflowDiscretionary');
  const totalDiscretionaryValue = discretionaryEntry?.result?.type === 'currency'
    ? discretionaryEntry.result.valueNumber
    : null;
  const baseBreakdownEntry = entries.get('cashflowBreakdown');
  const baseBreakdownItems = baseBreakdownEntry?.result?.type === 'list' && Array.isArray(baseBreakdownEntry.result.items)
    ? baseBreakdownEntry.result.items
    : [];
  const chaseBreakdownItems = chaseBreakdownEntry?.result?.type === 'list' && Array.isArray(chaseBreakdownEntry.result.items)
    ? chaseBreakdownEntry.result.items
    : [];
  const chaseBreakdownTotal = sumBreakdownItems(chaseBreakdownItems);
  const chaseSpendValue = chaseSpendEntry?.result?.type === 'currency'
    ? chaseSpendEntry.result.valueNumber
    : null;
  const categorizedChaseAmount = typeof chaseSpendValue === 'number' && !Number.isNaN(chaseSpendValue)
    ? chaseSpendValue
    : chaseBreakdownTotal;
  const uncategorizedChaseBalanceAmount = chaseBalanceEntry?.result?.type === 'currency'
    ? chaseBalanceEntry.result.valueNumber - categorizedChaseAmount
    : null;
  const chaseBalanceBreakdownItem = chaseBalanceEntry?.result?.type === 'currency'
    ? createSyntheticBreakdownItem('Other', uncategorizedChaseBalanceAmount)
    : null;
  const supplementalBreakdownItems = chaseBalanceBreakdownItem
    ? [...chaseBreakdownItems, chaseBalanceBreakdownItem]
    : chaseBreakdownItems;

  if (baseBreakdownEntry || supplementalBreakdownItems.length) {
    entries.set('cashflowBreakdown', {
      ...(baseBreakdownEntry || chaseBreakdownEntry),
      id: 'cashflowBreakdown',
      label: baseBreakdownEntry?.label || 'Discretionary Spending Breakdown',
      result: {
        type: 'list',
        label: baseBreakdownEntry?.result?.label || 'Discretionary Spending Breakdown',
        items: mergeBreakdownItems(baseBreakdownItems, supplementalBreakdownItems, totalDiscretionaryValue)
      },
      isStale: Boolean(baseBreakdownEntry?.isStale || chaseBreakdownEntry?.isStale),
      isUpdating: Boolean(baseBreakdownEntry?.isUpdating || chaseBreakdownEntry?.isUpdating || chaseBalanceEntry?.isUpdating),
      sourceUrl: baseBreakdownEntry?.sourceUrl || chaseBreakdownEntry?.sourceUrl || '',
      sourceModuleName: baseBreakdownEntry?.sourceModuleName || chaseBreakdownEntry?.sourceModuleName || 'Chase'
    });
  }

  return entries;
}

function renderDisplayItem(entry) {
  const item = document.createElement('section');
  item.className = 'result-item';
  item.classList.toggle('is-updating', entry.isUpdating === true);

  const labelRow = document.createElement('div');
  labelRow.className = 'result-label-row';
  const label = document.createElement('div');
  label.className = 'result-label';
  label.textContent = entry.label;
  labelRow.appendChild(label);
  if (entry.isUpdating) {
    labelRow.appendChild(createUpdatingIndicator());
  }
  item.appendChild(labelRow);

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
    const monthlyPercentChange = typeof signedMonthlyHistoricalValue === 'number'
      && !Number.isNaN(signedMonthlyHistoricalValue)
      && signedMonthlyHistoricalValue > 0
      ? ((signedValueNumber - signedMonthlyHistoricalValue) / signedMonthlyHistoricalValue) * 100
      : null;
    item.appendChild(
      createChangeRow(dailyChange, monthlyChange, {
        showDaily: !MONTHLY_ONLY_ENTRY_IDS.has(entry.id),
        showMonthlyPercent: INVESTMENT_PERCENT_ENTRY_IDS.has(entry.id),
        monthlyPercentChange
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
