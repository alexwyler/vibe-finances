import { MODULES, getModuleById } from './lib/modules.js';
import {
  appendHistorySnapshot,
  ensureState,
  getState,
  mergeResultValues,
  saveState,
  updateModuleRunStatus,
  updateResult
} from './lib/storage.js';
import { runModule } from './lib/runner.js';

let storageUpdateQueue = Promise.resolve();

function enqueueStorageUpdate(work) {
  storageUpdateQueue = storageUpdateQueue.then(work, work);
  return storageUpdateQueue;
}

function createProgressOptions(moduleId) {
  return {
    onPageResult: (partialResult) => enqueueStorageUpdate(() => mergeResultValues(moduleId, partialResult))
  };
}

function moduleRequiresDebugger(module) {
  return Boolean(
    module?.requiresDebugger
    || module?.login?.nativeLoginFlow?.enabled
    || module?.login?.nativeSubmitFallback?.enabled
    || module?.login?.manualChallenge?.nativePrepare?.enabled
  );
}

async function runModuleAndPersist(moduleId, { saveSnapshot = true, preserveTabOnFailure = false } = {}) {
  const state = await getState();
  const module = getModuleById(moduleId);
  if (!module) {
    throw new Error(`Unknown module: ${moduleId}`);
  }

  await enqueueStorageUpdate(() => updateModuleRunStatus(moduleId, {
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: ''
  }));

  let result;
  try {
    result = await runModule(module, state.modules[moduleId], {
      preserveTabOnFailure,
      ...createProgressOptions(moduleId)
    });
  } catch (error) {
    result = {
      ok: false,
      moduleId,
      displayName: module.displayName,
      startedAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      pages: [],
      values: {}
    };
  }

  await enqueueStorageUpdate(async () => {
    await updateResult(moduleId, result);
    await updateModuleRunStatus(moduleId, {
      status: result?.ok ? 'succeeded' : 'failed',
      startedAt: result?.startedAt || null,
      finishedAt: result?.lastRunAt || new Date().toISOString(),
      error: result?.ok ? '' : (result?.error || 'Module failed.')
    });
    if (result?.ok && saveSnapshot) {
      await appendHistorySnapshot();
    }
  });

  return result;
}

async function runAllModulesAndPersist() {
  const state = await getState();
  const output = {};
  const enabledModules = MODULES.filter((module) => state.modules?.[module.id]?.enabled !== false);
  const debuggerModules = enabledModules.filter((module) => moduleRequiresDebugger(module));
  const parallelModules = enabledModules.filter((module) => !moduleRequiresDebugger(module));
  const moduleRuns = [];

  const runAndPersistModule = async (module) => {
    await enqueueStorageUpdate(() => updateModuleRunStatus(module.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: ''
    }));

    let result;
    try {
      result = await runModule(module, state.modules[module.id], createProgressOptions(module.id));
    } catch (error) {
      result = {
        ok: false,
        moduleId: module.id,
        displayName: module.displayName,
        startedAt: new Date().toISOString(),
        lastRunAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        pages: [],
        values: {}
      };
    }

    await enqueueStorageUpdate(async () => {
      await updateResult(module.id, result);
      await updateModuleRunStatus(module.id, {
        status: result?.ok ? 'succeeded' : 'failed',
        startedAt: result?.startedAt || null,
        finishedAt: result?.lastRunAt || new Date().toISOString(),
        error: result?.ok ? '' : (result?.error || 'Module failed.')
      });
    });

    return [module.id, result];
  };

  for (const module of debuggerModules) {
    moduleRuns.push(await runAndPersistModule(module));
  }

  if (parallelModules.length) {
    const parallelRuns = await Promise.all(
      parallelModules.map((module) => runAndPersistModule(module))
    );
    moduleRuns.push(...parallelRuns);
  }

  let hasSuccessfulRun = false;
  for (const [moduleId, result] of moduleRuns) {
    output[moduleId] = result;
    hasSuccessfulRun = hasSuccessfulRun || Boolean(result?.ok);
  }

  if (hasSuccessfulRun) {
    await enqueueStorageUpdate(() => appendHistorySnapshot());
  }
  return output;
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    if (chrome.storage?.local?.setAccessLevel) {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    }
  } catch (error) {
    console.warn('Could not restrict storage.local access level.', error);
  }

  try {
    await ensureState();
  } catch (error) {
    console.error('Could not initialize extension state.', error);
  }

  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (error) {
    console.warn('Could not set side panel behavior.', error);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!chrome.sidePanel?.open || !tab?.windowId) {
    return;
  }

  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.warn('Could not open side panel.', error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'GET_STATE': {
        sendResponse({ ok: true, state: await getState() });
        return;
      }
      case 'SAVE_STATE': {
        const nextState = await saveState(message.state || {});
        sendResponse({ ok: true, state: nextState });
        return;
      }
      case 'RUN_MODULE': {
        const result = await runModuleAndPersist(message.moduleId, {
          preserveTabOnFailure: message.preserveTabOnFailure === true
        });
        sendResponse({ ok: true, result });
        return;
      }
      case 'RUN_ALL': {
        const results = await runAllModulesAndPersist();
        sendResponse({ ok: true, results });
        return;
      }
      default: {
        sendResponse({ ok: false, error: `Unknown message type: ${message?.type}` });
      }
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });

  return true;
});
