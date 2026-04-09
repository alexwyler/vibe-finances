import { MODULES } from './modules.js';

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

export function computeGlobalMetrics(state) {
  let netWorth = 0;
  let income = 0;
  let fixed = 0;
  let discretionary = 0;

  for (const module of MODULES) {
    const moduleState = state.modules?.[module.id];
    if (!moduleState?.enabled) {
      continue;
    }

    const moduleResult = state.results?.[module.id];
    const netWorthResults = collectNetWorthResults(module, moduleResult);
    const cashflowResults = collectPageResults(module, moduleResult, 'cashflow');
    const cashflowTotals = getCashflowTotals(cashflowResults);

    netWorth += sumCurrencyResults(netWorthResults);
    income += cashflowTotals.income;
    fixed += cashflowTotals.fixed;
    discretionary += cashflowTotals.discretionary;
  }

  return {
    netWorth,
    income,
    fixed,
    discretionary,
    netCashflow: income - fixed - discretionary
  };
}
