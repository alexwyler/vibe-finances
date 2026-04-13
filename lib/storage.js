import { MODULES, flattenExtractors } from './modules.js';
import { getDefaultExtractorLabel } from './displayLabels.js';
import {
  computeGlobalMetrics,
  getLatestHistoricalExtractorResult,
  isUsableResult
} from './metrics.js';

const MAX_HISTORY_SNAPSHOTS = 1000;

export function buildDefaultState() {
  const modules = {};

  for (const module of MODULES) {
    const extractorConfig = {};

    for (const extractor of flattenExtractors(module)) {
      extractorConfig[extractor.id] = {
        enabled: extractor.defaultEnabled !== false,
        label: getDefaultExtractorLabel(extractor)
      };
    }

    modules[module.id] = {
      enabled: true,
      credentials: {
        username: '',
        password: ''
      },
      extractorConfig
    };
  }

  return {
    modules,
    results: {},
    history: {
      snapshots: []
    }
  };
}

export function mergeStateWithDefaults(storedState = {}) {
  const defaults = buildDefaultState();
  const merged = structuredClone(defaults);

  for (const module of MODULES) {
    const moduleId = module.id;
    const moduleDefault = defaults.modules[moduleId];
    const storedModule = storedState.modules?.[moduleId] || {};
    const extractorMap = new Map(flattenExtractors(module).map((extractor) => [extractor.id, extractor]));

    merged.modules[moduleId] = {
      ...moduleDefault,
      ...storedModule,
      credentials: {
        ...moduleDefault.credentials,
        ...(storedModule.credentials || {})
      },
      extractorConfig: {
        ...moduleDefault.extractorConfig,
        ...(storedModule.extractorConfig || {})
      }
    };

    for (const [extractorId, extractorDefault] of Object.entries(moduleDefault.extractorConfig)) {
      const extractor = extractorMap.get(extractorId);
      const storedExtractorConfig = storedModule.extractorConfig?.[extractorId] || {};
      const storedLabel = storedExtractorConfig.label;
      const shouldUseDefaultLabel = !storedLabel || storedLabel === extractor?.label;

      merged.modules[moduleId].extractorConfig[extractorId] = {
        ...extractorDefault,
        ...storedExtractorConfig,
        label: shouldUseDefaultLabel ? extractorDefault.label : storedLabel
      };
    }
  }

  merged.results = storedState.results || {};
  merged.history = {
    snapshots: Array.isArray(storedState.history?.snapshots) ? storedState.history.snapshots : []
  };

  return merged;
}

export async function ensureState() {
  const { state } = await chrome.storage.local.get('state');
  const merged = mergeStateWithDefaults(state);
  await chrome.storage.local.set({ state: merged });
  return merged;
}

export async function getState() {
  return ensureState();
}

export async function saveState(nextState) {
  const current = await ensureState();
  const merged = mergeStateWithDefaults({
    ...current,
    ...nextState,
    modules: nextState.modules || current.modules,
    results: nextState.results || current.results
  });
  await chrome.storage.local.set({ state: merged });
  return merged;
}

export async function updateResult(moduleId, result) {
  const state = await getState();
  state.results[moduleId] = result;
  await chrome.storage.local.set({ state });
  return state;
}

export async function updateResults(nextResults) {
  const state = await getState();
  state.results = {
    ...(state.results || {}),
    ...(nextResults || {})
  };
  await chrome.storage.local.set({ state });
  return state;
}

export async function appendHistorySnapshot(timestamp = Date.now()) {
  const state = await getState();
  const metrics = computeGlobalMetrics(state);
  const extractors = {};

  for (const module of MODULES) {
    const moduleResults = state.results?.[module.id]?.values || {};
    for (const [extractorId, result] of Object.entries(moduleResults)) {
      if (isUsableResult(result)) {
        extractors[extractorId] = structuredClone(result);
        continue;
      }

      const historicalResult = getLatestHistoricalExtractorResult(state, extractorId);
      if (isUsableResult(historicalResult)) {
        extractors[extractorId] = structuredClone(historicalResult);
      }
    }
  }

  state.history = state.history || { snapshots: [] };
  state.history.snapshots = [
    ...(state.history.snapshots || []),
    {
      timestamp,
      metrics,
      extractors
    }
  ].slice(-MAX_HISTORY_SNAPSHOTS);

  await chrome.storage.local.set({ state });
  return state;
}
