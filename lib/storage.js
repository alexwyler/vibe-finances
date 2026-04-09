import { MODULES, flattenExtractors } from './modules.js';

export function buildDefaultState() {
  const modules = {};

  for (const module of MODULES) {
    const extractorConfig = {};

    for (const extractor of flattenExtractors(module)) {
      extractorConfig[extractor.id] = {
        enabled: extractor.defaultEnabled !== false,
        label: extractor.label
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
    results: {}
  };
}

export function mergeStateWithDefaults(storedState = {}) {
  const defaults = buildDefaultState();
  const merged = structuredClone(defaults);

  for (const [moduleId, moduleDefault] of Object.entries(defaults.modules)) {
    const storedModule = storedState.modules?.[moduleId] || {};

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
      merged.modules[moduleId].extractorConfig[extractorId] = {
        ...extractorDefault,
        ...(storedModule.extractorConfig?.[extractorId] || {})
      };
    }
  }

  merged.results = storedState.results || {};

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
