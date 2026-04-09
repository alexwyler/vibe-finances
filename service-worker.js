import { MODULES, getModuleById } from './lib/modules.js';
import { ensureState, getState, saveState, updateResult } from './lib/storage.js';
import { runModule } from './lib/runner.js';

async function runModuleAndPersist(moduleId) {
  const state = await getState();
  const module = getModuleById(moduleId);
  if (!module) {
    throw new Error(`Unknown module: ${moduleId}`);
  }

  const result = await runModule(module, state.modules[moduleId]);
  await updateResult(moduleId, result);
  return result;
}

async function runAllModulesAndPersist() {
  const output = {};
  for (const module of MODULES) {
    output[module.id] = await runModuleAndPersist(module.id);
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
        const result = await runModuleAndPersist(message.moduleId);
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
