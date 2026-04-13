import { MODULES } from './modules.js';

const CASHFLOW_EXTRACTOR_IDS = {
  income: 'cashflowIncome',
  fixed: 'cashflowFixed',
  discretionary: 'cashflowDiscretionary'
};

function getNetWorthMultiplier(extractor) {
  return typeof extractor.netWorthMultiplier === 'number' ? extractor.netWorthMultiplier : 1;
}

export function getExtractorPageMap(module) {
  const pageMap = new Map();
  for (const page of module.pages) {
    for (const extractor of page.extractors) {
      pageMap.set(extractor.id, page.id);
    }
  }
  return pageMap;
}

function getSnapshots(source) {
  if (Array.isArray(source)) {
    return source;
  }

  return source?.history?.snapshots || [];
}

function getCurrentResultByExtractorId(state, extractorId) {
  for (const module of MODULES) {
    const result = state?.results?.[module.id]?.values?.[extractorId];
    if (result) {
      return result;
    }
  }

  return null;
}

export function isUsableResult(result) {
  if (!result || result.type === 'error') {
    return false;
  }

  if (result.type === 'currency') {
    return typeof result.valueNumber === 'number' && !Number.isNaN(result.valueNumber);
  }

  if (result.type === 'text') {
    return typeof result.text === 'string' && result.text.trim().length > 0;
  }

  if (result.type === 'list') {
    return Array.isArray(result.items) && result.items.length > 0;
  }

  return true;
}

function getCurrentExtractorResult(state, moduleId, extractorId) {
  return state.results?.[moduleId]?.values?.[extractorId] || null;
}

export function getLatestHistoricalExtractorResult(source, extractorId) {
  const snapshots = getSnapshots(source);

  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const candidate = snapshots[index]?.extractors?.[extractorId];
    if (isUsableResult(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function getEffectiveExtractorResult(state, moduleId, extractorId) {
  const currentResult = getCurrentExtractorResult(state, moduleId, extractorId);
  if (isUsableResult(currentResult)) {
    return {
      result: currentResult,
      isStale: false
    };
  }

  const historicalResult = getLatestHistoricalExtractorResult(state, extractorId);
  if (isUsableResult(historicalResult)) {
    return {
      result: historicalResult,
      isStale: true
    };
  }

  return {
    result: currentResult,
    isStale: false
  };
}

function interpolateNumberSeries(points, targetTimestamp) {
  if (!points.length) {
    return null;
  }

  if (points.length === 1) {
    return points[0].timestamp === targetTimestamp ? points[0].value : null;
  }

  const exact = points.find((point) => point.timestamp === targetTimestamp);
  if (exact) {
    return exact.value;
  }

  let before = [...points].reverse().find((point) => point.timestamp < targetTimestamp);
  let after = points.find((point) => point.timestamp > targetTimestamp);

  if (!before && targetTimestamp < points[0].timestamp) {
    [before, after] = points.slice(0, 2);
  } else if (!after && targetTimestamp > points[points.length - 1].timestamp) {
    [before, after] = points.slice(-2);
  }

  if (!before || !after) {
    return null;
  }

  const totalWindow = after.timestamp - before.timestamp;
  if (totalWindow <= 0) {
    return before.value;
  }

  const progress = (targetTimestamp - before.timestamp) / totalWindow;
  return before.value + ((after.value - before.value) * progress);
}

function getInterpolatedStoredMetricValue(snapshotsSource, metricKey, targetTimestamp) {
  const snapshots = getSnapshots(snapshotsSource);
  const points = snapshots
    .filter((snapshot) => typeof snapshot.metrics?.[metricKey] === 'number' && !Number.isNaN(snapshot.metrics[metricKey]))
    .map((snapshot) => ({
      timestamp: snapshot.timestamp,
      value: snapshot.metrics[metricKey]
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  return interpolateNumberSeries(points, targetTimestamp);
}

export function getInterpolatedExtractorValue(snapshotsSource, extractorId, targetTimestamp) {
  const snapshots = getSnapshots(snapshotsSource);
  const points = snapshots
    .map((snapshot) => ({
      timestamp: snapshot.timestamp,
      result: snapshot.extractors?.[extractorId]
    }))
    .filter((point) => isUsableResult(point.result) && point.result.type === 'currency')
    .map((point) => ({
      timestamp: point.timestamp,
      value: point.result.valueNumber
    }));

  if (!Array.isArray(snapshotsSource)) {
    const currentResult = getCurrentResultByExtractorId(snapshotsSource, extractorId);
    if (isUsableResult(currentResult) && currentResult.type === 'currency') {
      points.push({
        timestamp: Date.now(),
        value: currentResult.valueNumber
      });
    }
  }

  const uniquePoints = points
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((point, index, allPoints) => index === 0 || point.timestamp !== allPoints[index - 1].timestamp);

  return interpolateNumberSeries(uniquePoints, targetTimestamp);
}

function forEachEnabledExtractor(state, callback) {
  for (const module of MODULES) {
    const moduleState = state.modules?.[module.id];
    if (!moduleState?.enabled) {
      continue;
    }

    const extractorPageMap = getExtractorPageMap(module);
    const extractorState = moduleState.extractorConfig || {};

    for (const page of module.pages) {
      for (const extractor of page.extractors) {
        if (extractorState[extractor.id]?.enabled === false) {
          continue;
        }

        callback({
          module,
          pageId: extractorPageMap.get(extractor.id),
          extractor
        });
      }
    }
  }
}

export function computeGlobalMetricDetails(state) {
  let netWorth = 0;
  let income = 0;
  let fixed = 0;
  let discretionary = 0;
  let netWorthStale = false;
  let incomeStale = false;
  let fixedStale = false;
  let discretionaryStale = false;

  forEachEnabledExtractor(state, ({ module, pageId, extractor }) => {
    const { result, isStale } = getEffectiveExtractorResult(state, module.id, extractor.id);
    if (result?.type !== 'currency' || typeof result.valueNumber !== 'number' || Number.isNaN(result.valueNumber)) {
      return;
    }

    if (pageId !== 'cashflow') {
      netWorth += result.valueNumber * getNetWorthMultiplier(extractor);
      netWorthStale = netWorthStale || isStale;
      return;
    }

    if (extractor.id === CASHFLOW_EXTRACTOR_IDS.income) {
      income += result.valueNumber;
      incomeStale = incomeStale || isStale;
    } else if (extractor.id === CASHFLOW_EXTRACTOR_IDS.fixed) {
      fixed += result.valueNumber;
      fixedStale = fixedStale || isStale;
    } else if (extractor.id === CASHFLOW_EXTRACTOR_IDS.discretionary) {
      discretionary += result.valueNumber;
      discretionaryStale = discretionaryStale || isStale;
    }
  });

  return {
    netWorth: {
      value: netWorth,
      isStale: netWorthStale
    },
    income: {
      value: income,
      isStale: incomeStale
    },
    fixed: {
      value: fixed,
      isStale: fixedStale
    },
    discretionary: {
      value: discretionary,
      isStale: discretionaryStale
    },
    netCashflow: {
      value: income - fixed - discretionary,
      isStale: incomeStale || fixedStale || discretionaryStale
    }
  };
}

export function computeGlobalMetrics(state) {
  const metricDetails = computeGlobalMetricDetails(state);
  return {
    netWorth: metricDetails.netWorth.value,
    income: metricDetails.income.value,
    fixed: metricDetails.fixed.value,
    discretionary: metricDetails.discretionary.value,
    netCashflow: metricDetails.netCashflow.value
  };
}

export function computeHistoricalMetrics(state, targetTimestamp) {
  let netWorth = 0;
  let income = 0;
  let fixed = 0;
  let discretionary = 0;
  let hasNetWorthData = false;
  let hasIncomeData = false;
  let hasFixedData = false;
  let hasDiscretionaryData = false;

  forEachEnabledExtractor(state, ({ pageId, extractor }) => {
    const value = getInterpolatedExtractorValue(state, extractor.id, targetTimestamp);
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return;
    }

    if (pageId !== 'cashflow') {
      netWorth += value * getNetWorthMultiplier(extractor);
      hasNetWorthData = true;
      return;
    }

    if (extractor.id === CASHFLOW_EXTRACTOR_IDS.income) {
      income += value;
      hasIncomeData = true;
    } else if (extractor.id === CASHFLOW_EXTRACTOR_IDS.fixed) {
      fixed += value;
      hasFixedData = true;
    } else if (extractor.id === CASHFLOW_EXTRACTOR_IDS.discretionary) {
      discretionary += value;
      hasDiscretionaryData = true;
    }
  });

  return {
    netWorth: hasNetWorthData ? netWorth : getInterpolatedStoredMetricValue(state, 'netWorth', targetTimestamp),
    income: hasIncomeData ? income : null,
    fixed: hasFixedData ? fixed : null,
    discretionary: hasDiscretionaryData ? discretionary : null,
    netCashflow: hasIncomeData || hasFixedData || hasDiscretionaryData
      ? income - fixed - discretionary
      : getInterpolatedStoredMetricValue(state, 'netCashflow', targetTimestamp)
  };
}
