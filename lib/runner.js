function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label) {
  if (!timeoutMs) {
    return promise;
  }

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    })
  ]);
}

function getTabLoadError(tab) {
  if (!tab?.url) {
    return null;
  }

  if (String(tab.url).startsWith('chrome-error://')) {
    return `Browser failed to load ${tab.pendingUrl || tab.url}.`;
  }

  return null;
}

function normalizeComparableText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const existing = await chrome.tabs.get(tabId);
  const existingError = getTabLoadError(existing);
  if (existingError) {
    throw new Error(existingError);
  }
  if (existing.status === 'complete') {
    return existing;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Timed out waiting for tab ${tabId} to finish loading.`));
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo, tab) => {
      const loadError = getTabLoadError(tab);
      if (updatedTabId === tabId && loadError) {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(loadError));
        return;
      }

      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function navigateTab(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await waitForTabComplete(tabId);
}

async function waitForTabUrlMatch(tabId, urls = [], timeoutMs = 5000) {
  const normalizedTargets = urls
    .map((url) => normalizeUrlForComparison(url))
    .filter(Boolean);

  if (!normalizedTargets.length) {
    return null;
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    const loadError = getTabLoadError(tab);
    if (loadError) {
      throw new Error(loadError);
    }
    const currentUrl = normalizeUrlForComparison(tab.url);
    if (normalizedTargets.includes(currentUrl)) {
      return tab;
    }
    await sleep(200);
  }

  return null;
}

function normalizeUrlForComparison(url) {
  if (!url) {
    return '';
  }

  try {
    const parsed = new URL(url);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${normalizedPath}${parsed.search}${parsed.hash}`;
  } catch (error) {
    return String(url).replace(/\/+$/, '');
  }
}

function urlMatchesAnyTarget(url, targets = []) {
  const normalizedUrl = normalizeUrlForComparison(url);
  return targets.some((target) => {
    const normalizedTarget = normalizeUrlForComparison(target);
    return normalizedUrl === normalizedTarget || normalizedUrl.startsWith(normalizedTarget);
  });
}

async function ensurePageUrl(tabId, url) {
  const currentTab = await chrome.tabs.get(tabId);
  if (normalizeUrlForComparison(currentTab.url) === normalizeUrlForComparison(url)) {
    return currentTab;
  }

  await navigateTab(tabId, url);
  return chrome.tabs.get(tabId);
}

async function brieflyActivateTab(tabId, windowId, durationMs = 250) {
  const [previousActiveTab] = await chrome.tabs.query({ active: true, windowId });
  const needsRestore = previousActiveTab && previousActiveTab.id !== tabId;

  if (needsRestore) {
    await chrome.tabs.update(tabId, { active: true });
    await sleep(durationMs);
  }

  if (needsRestore && previousActiveTab?.id) {
    try {
      await chrome.tabs.update(previousActiveTab.id, { active: true });
    } catch (error) {
      console.warn('Could not restore previously active tab.', error);
    }
  }
}

async function closeTabsMatching(urlPatterns = []) {
  if (!Array.isArray(urlPatterns) || !urlPatterns.length) {
    return;
  }

  const tabs = await chrome.tabs.query({ url: urlPatterns });
  const tabIds = tabs.map((tab) => tab.id).filter((tabId) => typeof tabId === 'number');
  if (!tabIds.length) {
    return;
  }

  await chrome.tabs.remove(tabIds);
}

async function temporarilyActivateTab(tabId, windowId, callback, durationMs = 250) {
  await brieflyActivateTab(tabId, windowId, durationMs);
  return callback();
}

async function warmPageIfNeeded(tab, page) {
  if (!tab?.id || !tab?.windowId || !page?.activateBeforeScrapeMs) {
    return;
  }

  await brieflyActivateTab(tab.id, tab.windowId, page.activateBeforeScrapeMs);
}

async function executeInTab(tabId, func, args, options = {}) {
  const executionResults = await chrome.scripting.executeScript({
    target: options.allFrames ? { tabId, allFrames: true } : { tabId },
    func,
    args
  });

  if (options.allFrames) {
    return executionResults.map((entry) => entry.result);
  }

  return executionResults[0]?.result;
}

const debuggerTabQueues = new Map();

async function withAttachedDebugger(tabId, callback) {
  const priorWork = debuggerTabQueues.get(tabId) || Promise.resolve();
  let workPromise;

  workPromise = priorWork
    .catch(() => {})
    .then(async () => {
      const target = { tabId };
      let attached = false;

      try {
        await chrome.debugger.attach(target, '1.3');
        attached = true;
        return await callback(target);
      } finally {
        if (attached) {
          try {
            await chrome.debugger.detach(target);
          } catch (error) {
            console.warn('Could not detach debugger from tab.', error);
          }
        }
      }
    })
    .finally(() => {
      if (debuggerTabQueues.get(tabId) === workPromise) {
        debuggerTabQueues.delete(tabId);
      }
    });

  debuggerTabQueues.set(tabId, workPromise);
  return workPromise;
}

async function sendDebuggerCommand(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function dispatchNativeClick(tabId, point) {
  if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
    return false;
  }

  await sendDebuggerCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none'
  });
  await sendDebuggerCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1
  });
  await sendDebuggerCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1
  });

  return true;
}

async function dispatchNativeEnter(tabId) {
  const keyPayload = {
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    key: 'Enter',
    code: 'Enter',
    text: '\r',
    unmodifiedText: '\r'
  };

  await sendDebuggerCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    ...keyPayload
  });
  await sendDebuggerCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'char',
    ...keyPayload
  });
  await sendDebuggerCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    ...keyPayload
  });

  return true;
}

function injectedLocateElementCenter(payload = {}) {
  const normalizeText = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const getElementText = (element) => normalizeText(
    element?.innerText
    || element?.textContent
    || element?.value
    || element?.getAttribute?.('aria-label')
    || ''
  );
  const isVisible = (element) => {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
  };
  const queryFirstVisible = (selectorList) => {
    for (const selector of (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const elements = Array.from(document.querySelectorAll(selector));
      const visibleMatch = elements.find((element) => isVisible(element));
      if (visibleMatch) {
        return visibleMatch;
      }
    }
    return null;
  };
  const queryByText = (selectorList, text, match = 'exact') => {
    const normalizedNeedle = normalizeText(text).toLowerCase();
    const candidates = Array.from(document.querySelectorAll(selectorList || 'button, [role="button"], a, input'));
    return candidates.find((element) => {
      if (!isVisible(element)) {
        return false;
      }

      const haystack = getElementText(element).toLowerCase();
      if (!haystack) {
        return false;
      }

      return match === 'includes'
        ? haystack.includes(normalizedNeedle)
        : haystack === normalizedNeedle;
    }) || null;
  };

  const element = payload.text
    ? queryByText(payload.selectors, payload.text, payload.textMatch)
    : queryFirstVisible(payload.selectors);

  if (!element) {
    return { found: false };
  }

  const rect = element.getBoundingClientRect();
  let x = rect.left + (rect.width / 2);
  let y = rect.top + (rect.height / 2);

  try {
    let currentWindow = window;
    while (currentWindow !== currentWindow.top) {
      const frameElement = currentWindow.frameElement;
      if (!frameElement) {
        break;
      }

      const frameRect = frameElement.getBoundingClientRect();
      x += frameRect.left;
      y += frameRect.top;
      currentWindow = currentWindow.parent;
    }
  } catch (error) {
    // If frame traversal is blocked, fall back to the current frame coordinates.
  }

  return {
    found: true,
    x: Math.round(x),
    y: Math.round(y),
    text: getElementText(element),
    disabled: element.disabled === true || element.getAttribute?.('aria-disabled') === 'true'
  };
}

function injectedCheckLoginAdvance(payload = {}) {
  const isVisible = (element) => {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
  };
  const queryFirstVisible = (selectorList) => {
    for (const selector of (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const elements = Array.from(document.querySelectorAll(selector));
      const visibleMatch = elements.find((element) => isVisible(element));
      if (visibleMatch) {
        return visibleMatch;
      }
    }
    return null;
  };

  const passwordInput = queryFirstVisible(payload.passwordSelector);
  const progressElement = queryFirstVisible(payload.progressSelectors);
  const urlChanged = Boolean(payload.previousUrl) && location.href !== payload.previousUrl;
  const applicable = urlChanged || Boolean(passwordInput || progressElement);
  const advanced = urlChanged || Boolean(progressElement) || (applicable && !passwordInput);

  return {
    applicable,
    advanced,
    url: location.href
  };
}

function chooseTruthyResult(results = []) {
  const normalizedResults = (Array.isArray(results) ? results : [results]).filter(Boolean);
  return normalizedResults.find((result) => result.found || result.advanced) || normalizedResults[0] || null;
}

async function waitForLoginAdvance(tabId, loginConfig, previousUrl, timeoutMs, allFrames = false) {
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < timeoutMs) {
    const currentTab = await chrome.tabs.get(tabId);
    const loadError = getTabLoadError(currentTab);
    if (loadError) {
      throw new Error(loadError);
    }

    const progressResults = await executeInTab(tabId, injectedCheckLoginAdvance, [{
      previousUrl,
      passwordSelector: loginConfig.selectors?.password,
      progressSelectors: loginConfig.submitProgressSelectors
    }], { allFrames });

    const progressChecks = Array.isArray(progressResults) ? progressResults : [progressResults];
    if (progressChecks.some((result) => result?.advanced)) {
      return true;
    }

    await sleep(150);
  }

  return false;
}

async function evaluateWithDebuggerDomHelpers(tabId, payload, body) {
  const expression = `(() => {
    const payload = ${JSON.stringify(payload)};
    const normalizeText = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const getElementText = (element) => normalizeText(
      element?.innerText
      || element?.textContent
      || element?.value
      || element?.getAttribute?.('aria-label')
      || ''
    );
    const isVisible = (element) => {
      if (!element) {
        return false;
      }

      const style = window.getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
    };
    const entries = [];
    const collectQueryRoots = (root) => {
      const roots = [];
      const pending = [root];
      const seen = new Set();

      while (pending.length) {
        const current = pending.shift();
        if (!current || seen.has(current)) {
          continue;
        }

        seen.add(current);
        roots.push(current);

        if (typeof current.querySelectorAll !== 'function') {
          continue;
        }

        for (const element of Array.from(current.querySelectorAll('*'))) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) {
            pending.push(element.shadowRoot);
          }
        }
      }

      return roots;
    };
    const queryAllDeep = (root, selector) => {
      const matches = [];
      for (const searchRoot of collectQueryRoots(root)) {
        try {
          matches.push(...Array.from(searchRoot.querySelectorAll(selector)));
        } catch (error) {
          // Ignore invalid selectors for this search root.
        }
      }
      return matches;
    };
    const walkFrames = (win, offsetX = 0, offsetY = 0) => {
      try {
        const doc = win.document;
        entries.push({ doc, offsetX, offsetY });
        for (const frame of Array.from(doc.querySelectorAll('iframe, frame'))) {
          let childWindow = null;
          try {
            childWindow = frame.contentWindow;
          } catch (error) {
            childWindow = null;
          }

          if (!childWindow) {
            continue;
          }

          const rect = frame.getBoundingClientRect();
          walkFrames(childWindow, offsetX + rect.left, offsetY + rect.top);
        }
      } catch (error) {
        // Ignore cross-origin or unavailable frames.
      }
    };
    walkFrames(window);
    const parseSelectors = (selectorList) => String(selectorList || '').split(',').map((part) => part.trim()).filter(Boolean);
    const findEntry = (selectorList) => {
      for (const selector of parseSelectors(selectorList)) {
        for (const entry of entries) {
          const elements = queryAllDeep(entry.doc, selector);
          const found = elements.find((element) => isVisible(element));
          if (found) {
            return {
              element: found,
              offsetX: entry.offsetX,
              offsetY: entry.offsetY
            };
          }
        }
      }
      return null;
    };
    const findEntryByText = (selectorList, text, match = 'exact') => {
      const needle = normalizeText(text).toLowerCase();
      for (const selector of parseSelectors(selectorList || 'button, [role="button"], a, input')) {
        for (const entry of entries) {
          const elements = queryAllDeep(entry.doc, selector);
          const found = elements.find((element) => {
            if (!isVisible(element)) {
              return false;
            }

            const haystack = getElementText(element).toLowerCase();
            if (!haystack) {
              return false;
            }

            return match === 'includes'
              ? haystack.includes(needle)
              : haystack === needle;
          });

          if (found) {
            return {
              element: found,
              offsetX: entry.offsetX,
              offsetY: entry.offsetY
            };
          }
        }
      }
      return null;
    };
    ${body}
  })()`;

  const result = await sendDebuggerCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });

  return result?.result?.value;
}

function isNativeScrapeValueReady(value) {
  if (!value || value.type === 'error') {
    return false;
  }

  if (value.type === 'currency') {
    return Boolean(value.valueText) || (typeof value.valueNumber === 'number' && !Number.isNaN(value.valueNumber));
  }

  if (value.type === 'text') {
    return Boolean(value.text);
  }

  if (value.type === 'list') {
    return Array.isArray(value.items) && value.items.length > 0;
  }

  return true;
}

async function getNativePageScrapeSnapshot(tabId, page, extractors) {
  return evaluateWithDebuggerDomHelpers(tabId, {
    waitFor: page.waitFor || {},
    extractors
  }, `
    const parseCurrency = (rawValue) => {
      const normalized = normalizeText(rawValue).replace(/,/g, '');
      if (!normalized) {
        return null;
      }

      const match = normalized.match(/\\$?([0-9]+(?:\\.[0-9]{1,2})?)/);
      const isNegative = normalized.includes('-') || normalized.includes('(') || /\\bCR\\b/i.test(normalized);
      return match ? Number(match[1]) * (isNegative ? -1 : 1) : null;
    };
    const findWithin = (root, selectorList) => {
      for (const selector of String(selectorList || '').split(',').map((part) => part.trim()).filter(Boolean)) {
        const elements = queryAllDeep(root, selector);
        const visibleMatch = elements.find((element) => isVisible(element));
        if (visibleMatch) {
          return visibleMatch;
        }
      }
      return null;
    };
    const queryTextWithin = (root, selectorList) => normalizeText(getElementText(findWithin(root, selectorList)));
    const buildMeta = (root, metaConfig = {}) => {
      const meta = {};
      for (const [key, selector] of Object.entries(metaConfig)) {
        meta[key] = queryTextWithin(root, selector);
      }
      return meta;
    };

    const values = {};
    for (const extractor of payload.extractors || []) {
      try {
        if (extractor.kind === 'text') {
          const entry = findEntry(extractor.selector);
          values[extractor.id] = {
            type: 'text',
            label: extractor.label,
            text: normalizeText(getElementText(entry?.element))
          };
          continue;
        }

        if (extractor.kind === 'attribute') {
          const entry = findEntry(extractor.selector);
          values[extractor.id] = {
            type: 'text',
            label: extractor.label,
            text: normalizeText(entry?.element?.getAttribute?.(extractor.attribute) || '')
          };
          continue;
        }

        if (extractor.kind === 'itemValue') {
          const itemEntry = findEntry(extractor.itemSelector);
          const item = itemEntry?.element || null;
          const valueText = item ? queryTextWithin(item, extractor.valueSelector) : '';
          values[extractor.id] = {
            type: 'currency',
            label: extractor.label,
            valueText,
            valueNumber: parseCurrency(valueText),
            meta: item ? buildMeta(item, extractor.meta) : {}
          };
          continue;
        }

        values[extractor.id] = {
          type: 'error',
          label: extractor.label,
          error: \`Unsupported native extractor kind: \${extractor.kind}\`
        };
      } catch (error) {
        values[extractor.id] = {
          type: 'error',
          label: extractor.label,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    return {
      pageTitle: document.title,
      waitFound: payload.waitFor?.selector ? Boolean(findEntry(payload.waitFor.selector)) : true,
      values
    };
  `);
}

async function scrapePageNatively(tabId, page, extractors) {
  return withAttachedDebugger(tabId, async () => {
    const timeoutMs = page.nativeScrape?.timeoutMs || page.executionTimeoutMs || page.waitFor?.timeoutMs || 15000;
    const pollMs = page.nativeScrape?.pollMs || 250;
    const requiredExtractorIds = page.nativeScrape?.requiredExtractorIds
      || (page.nativeScrape?.requireValueForAllExtractors ? extractors.map((extractor) => extractor.id) : []);
    const startedAtMs = Date.now();

    let snapshot = null;
    while (Date.now() - startedAtMs < timeoutMs) {
      const currentTab = await chrome.tabs.get(tabId);
      const loadError = getTabLoadError(currentTab);
      if (loadError) {
        throw new Error(loadError);
      }

      snapshot = await getNativePageScrapeSnapshot(tabId, page, extractors);
      const waitSatisfied = !page.waitFor?.selector || snapshot?.waitFound;
      const requiredValuesReady = requiredExtractorIds.every((extractorId) => isNativeScrapeValueReady(snapshot?.values?.[extractorId]));
      if (waitSatisfied && requiredValuesReady) {
        break;
      }

      await sleep(pollMs);
    }

    const waitSatisfied = !page.waitFor?.selector || snapshot?.waitFound;
    const requiredValuesReady = requiredExtractorIds.every((extractorId) => isNativeScrapeValueReady(snapshot?.values?.[extractorId]));
    if (!waitSatisfied || !requiredValuesReady) {
      return {
        ok: false,
        pageTitle: snapshot?.pageTitle || '',
        error: !waitSatisfied
          ? `Timed out waiting for selector: ${page.waitFor?.selector}`
          : `Timed out waiting for extractor values: ${requiredExtractorIds.join(', ')}`
      };
    }

    if (page.waitFor?.settleMs) {
      await sleep(page.waitFor.settleMs);
      snapshot = await getNativePageScrapeSnapshot(tabId, page, extractors);
    }

    return {
      ok: true,
      pageTitle: snapshot?.pageTitle || '',
      values: snapshot?.values || {}
    };
  });
}

async function locateNativeElement(tabId, selectorList, { text = null, textMatch = 'exact' } = {}) {
  return evaluateWithDebuggerDomHelpers(tabId, {
    selectors: selectorList,
    text,
    textMatch
  }, `
    const entry = payload.text
      ? findEntryByText(payload.selectors, payload.text, payload.textMatch || 'exact')
      : findEntry(payload.selectors);

    if (!entry) {
      return { found: false };
    }

    const rect = entry.element.getBoundingClientRect();
    return {
      found: true,
      x: Math.round(entry.offsetX + rect.left + (rect.width / 2)),
      y: Math.round(entry.offsetY + rect.top + (rect.height / 2)),
      text: getElementText(entry.element),
      value: 'value' in entry.element ? entry.element.value : '',
      disabled: entry.element.disabled === true || entry.element.getAttribute?.('aria-disabled') === 'true'
    };
  `);
}

async function prepareNativeInputSelection(tabId, selectorList) {
  return evaluateWithDebuggerDomHelpers(tabId, {
    selectors: selectorList
  }, `
    const entry = findEntry(payload.selectors);
    if (!entry) {
      return false;
    }

    const element = entry.element;
    element.focus?.();
    if (typeof element.select === 'function') {
      element.select();
    } else if (typeof element.setSelectionRange === 'function' && typeof element.value === 'string') {
      element.setSelectionRange(0, element.value.length);
    }

    return true;
  `);
}

async function getNativeLoginState(tabId, loginConfig, nativeConfig = {}) {
  return evaluateWithDebuggerDomHelpers(tabId, {
    usernameSelectors: nativeConfig.usernameSelectors || loginConfig.selectors?.username,
    passwordSelectors: nativeConfig.passwordSelectors || loginConfig.selectors?.password,
    submitSelectors: nativeConfig.submitSelectors || loginConfig.selectors?.submit,
    progressSelectors: nativeConfig.progressSelectors || loginConfig.submitProgressSelectors
  }, `
    const describe = (selectorList) => {
      const entry = findEntry(selectorList);
      if (!entry) {
        return { found: false };
      }

      const rect = entry.element.getBoundingClientRect();
      return {
        found: true,
        x: Math.round(entry.offsetX + rect.left + (rect.width / 2)),
        y: Math.round(entry.offsetY + rect.top + (rect.height / 2)),
        text: getElementText(entry.element),
        value: 'value' in entry.element ? entry.element.value : '',
        disabled: entry.element.disabled === true || entry.element.getAttribute?.('aria-disabled') === 'true'
      };
    };

    return {
      url: location.href,
      username: describe(payload.usernameSelectors),
      password: describe(payload.passwordSelectors),
      submit: describe(payload.submitSelectors),
      progressFound: Boolean(findEntry(payload.progressSelectors))
    };
  `);
}

async function fillFieldNatively(tabId, selectorList, value, nativeConfig = {}) {
  const locator = await locateNativeElement(tabId, selectorList);
  if (!locator?.found) {
    return false;
  }

  await dispatchNativeClick(tabId, locator);
  await sleep(nativeConfig.focusSettleMs || 120);
  await prepareNativeInputSelection(tabId, selectorList);
  await sleep(nativeConfig.selectionSettleMs || 60);
  await sendDebuggerCommand(tabId, 'Input.insertText', { text: String(value ?? '') });
  await sleep(nativeConfig.typingSettleMs || 220);
  return true;
}

async function waitForNativePasswordStep(tabId, loginConfig, nativeConfig, previousUrl, timeoutMs) {
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < timeoutMs) {
    const currentTab = await chrome.tabs.get(tabId);
    const loadError = getTabLoadError(currentTab);
    if (loadError) {
      throw new Error(loadError);
    }

    const state = await getNativeLoginState(tabId, loginConfig, nativeConfig);
    if (state?.url !== previousUrl || state?.password?.found) {
      return state;
    }

    await sleep(150);
  }

  return null;
}

async function waitForNativeFinalAdvance(tabId, loginConfig, nativeConfig, previousUrl, timeoutMs) {
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < timeoutMs) {
    const currentTab = await chrome.tabs.get(tabId);
    const loadError = getTabLoadError(currentTab);
    if (loadError) {
      throw new Error(loadError);
    }

    const state = await getNativeLoginState(tabId, loginConfig, nativeConfig);
    const advanced = state?.url !== previousUrl
      || state?.progressFound
      || (state?.password?.found === false);
    if (advanced) {
      return state;
    }

    await sleep(150);
  }

  return null;
}

async function attemptTrustedSubmitSequenceAttached(tabId, loginConfig, nativeConfig, stage = 'final') {
  const methods = Array.isArray(nativeConfig.methods)
    ? nativeConfig.methods.filter(Boolean)
    : [];

  for (const method of methods) {
    const previousUrl = (await chrome.tabs.get(tabId)).url;

    if (method === 'nativeClick' || method === 'nativeClickPassword') {
      const locator = await locateNativeElement(
        tabId,
        method === 'nativeClickPassword'
          ? (nativeConfig.passwordSelectors || loginConfig.selectors?.password)
          : (nativeConfig.submitSelectors || loginConfig.selectors?.submit),
        method === 'nativeClickPassword'
          ? {}
          : {
            text: nativeConfig.submitText,
            textMatch: nativeConfig.submitTextMatch
          }
      );

      if (!locator?.found) {
        continue;
      }

      await dispatchNativeClick(tabId, locator);
    } else if (method === 'nativeEnter') {
      if (nativeConfig.focusPasswordBeforeEnter !== false) {
        const passwordLocator = await locateNativeElement(
          tabId,
          nativeConfig.passwordSelectors || loginConfig.selectors?.password
        );
        if (passwordLocator?.found) {
          await dispatchNativeClick(tabId, passwordLocator);
          await sleep(nativeConfig.focusSettleMs || 120);
        }
      }

      await dispatchNativeEnter(tabId);
    } else {
      continue;
    }

    await sleep(nativeConfig.postActionWaitMs || 250);
    const advancedState = stage === 'username'
      ? await waitForNativePasswordStep(
        tabId,
        loginConfig,
        nativeConfig,
        previousUrl,
        nativeConfig.passwordStepTimeoutMs || loginConfig.passwordStepTimeoutMs || 5000
      )
      : await waitForNativeFinalAdvance(
        tabId,
        loginConfig,
        nativeConfig,
        previousUrl,
        nativeConfig.progressTimeoutMs || loginConfig.submitProgressTimeoutMs || 1500
      );

    if (advancedState) {
      return {
        ok: true,
        state: advancedState,
        message: `Login advanced after trusted ${method}.`
      };
    }
  }

  return {
    ok: false,
    message: stage === 'username'
      ? 'Trusted username-step submit did not reveal the password field.'
      : 'Trusted submit attempts did not advance the Chase login page.'
  };
}

async function runNativeLoginFlow(tab, loginConfig, username, password) {
  const nativeConfig = loginConfig.nativeLoginFlow;
  if (!nativeConfig?.enabled || !tab?.id) {
    return null;
  }

  const currentTab = await chrome.tabs.get(tab.id);
  let previousActiveTabId = null;

  if (nativeConfig.activateTab && currentTab.windowId) {
    const [previousActiveTab] = await chrome.tabs.query({ active: true, windowId: currentTab.windowId });
    previousActiveTabId = previousActiveTab?.id || null;
    await chrome.tabs.update(tab.id, { active: true });
    await sleep(nativeConfig.activationSettleMs || 250);
  }

  try {
    return await withAttachedDebugger(tab.id, async () => {
      let state = null;
      const stateTimeoutMs = nativeConfig.initialStateTimeoutMs || loginConfig.timeoutMs || 10000;
      const startedAtMs = Date.now();

      while (Date.now() - startedAtMs < stateTimeoutMs) {
        state = await getNativeLoginState(tab.id, loginConfig, nativeConfig);
        if (state?.username?.found || state?.password?.found || state?.submit?.found) {
          break;
        }
        await sleep(150);
      }

      if (!state?.username?.found && !state?.password?.found) {
        return {
          ok: false,
          foundForm: false,
          message: 'Trusted Chase login flow could not find the username/password fields.'
        };
      }

      if (username && state?.username?.found) {
        await fillFieldNatively(tab.id, nativeConfig.usernameSelectors || loginConfig.selectors?.username, username, nativeConfig);
        state = await getNativeLoginState(tab.id, loginConfig, nativeConfig);
      }

      if (!state?.password?.found && loginConfig.allowUsernameOnlyStep === true) {
        const usernameStepResult = await attemptTrustedSubmitSequenceAttached(tab.id, loginConfig, nativeConfig, 'username');
        if (!usernameStepResult.ok) {
          return {
            ok: false,
            foundForm: true,
            message: usernameStepResult.message
          };
        }
        state = usernameStepResult.state || await getNativeLoginState(tab.id, loginConfig, nativeConfig);
      }

      if (!state?.password?.found) {
        return {
          ok: false,
          foundForm: true,
          message: 'Trusted Chase login flow could not reach the password field.'
        };
      }

      await fillFieldNatively(tab.id, nativeConfig.passwordSelectors || loginConfig.selectors?.password, password || '', nativeConfig);

      const submitResult = await attemptTrustedSubmitSequenceAttached(tab.id, loginConfig, nativeConfig, 'final');
      return submitResult.ok
        ? {
          ok: true,
          foundForm: true,
          message: submitResult.message
        }
        : {
          ok: false,
          foundForm: true,
          message: submitResult.message
        };
    });
  } finally {
    if (previousActiveTabId && previousActiveTabId !== tab.id) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, windowId: currentTab.windowId });
        if (activeTab?.id === tab.id) {
          await chrome.tabs.update(previousActiveTabId, { active: true });
        }
      } catch (error) {
        console.warn('Could not restore previously active tab after native login flow.', error);
      }
    }
  }
}

async function runNativeLoginSubmitFallback(tab, loginConfig) {
  const fallbackConfig = loginConfig.nativeSubmitFallback;
  if (!fallbackConfig?.enabled || !tab?.id) {
    return null;
  }

  const methods = Array.isArray(fallbackConfig.methods)
    ? fallbackConfig.methods.filter(Boolean)
    : [];
  if (!methods.length) {
    return null;
  }

  const currentTab = await chrome.tabs.get(tab.id);
  let previousActiveTabId = null;

  if (fallbackConfig.activateTab && currentTab.windowId) {
    const [previousActiveTab] = await chrome.tabs.query({ active: true, windowId: currentTab.windowId });
    previousActiveTabId = previousActiveTab?.id || null;
    await chrome.tabs.update(tab.id, { active: true });
    await sleep(fallbackConfig.activationSettleMs || 250);
  }

  try {
    return await withAttachedDebugger(tab.id, async () => {
      const submitResult = await attemptTrustedSubmitSequenceAttached(tab.id, loginConfig, fallbackConfig, 'final');
      return submitResult.ok
        ? {
          ok: true,
          foundForm: true,
          message: submitResult.message
        }
        : {
          ok: false,
          foundForm: true,
          message: submitResult.message
        };
    });
  } finally {
    if (previousActiveTabId && previousActiveTabId !== tab.id) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, windowId: currentTab.windowId });
        if (activeTab?.id === tab.id) {
          await chrome.tabs.update(previousActiveTabId, { active: true });
        }
      } catch (error) {
        console.warn('Could not restore previously active tab after trusted login fallback.', error);
      }
    }
  }
}

function isNativeManualChallengeSelectionResolved(state, challengeConfig = {}) {
  if (state?.code?.found || state?.password?.found) {
    return true;
  }

  const triggerValue = normalizeComparableText(state?.trigger?.value || state?.trigger?.text);
  if (!triggerValue) {
    return false;
  }

  const placeholders = (challengeConfig.optionPlaceholderTexts || ['Choose one'])
    .map((value) => normalizeComparableText(value))
    .filter(Boolean);

  if (!placeholders.length) {
    return Boolean(triggerValue);
  }

  return !placeholders.includes(triggerValue);
}

async function getNativeManualChallengeState(tabId, challengeConfig = {}) {
  return evaluateWithDebuggerDomHelpers(tabId, {
    challengeShellSelectors: challengeConfig.challengeShellSelectors,
    challengeTexts: challengeConfig.challengeTexts,
    continuePreferredSelector: challengeConfig.continuePreferredSelector,
    optionTriggerSelector: challengeConfig.optionTriggerSelector,
    optionTriggerValueSelector: challengeConfig.optionTriggerValueSelector,
    optionContainerSelector: challengeConfig.optionContainerSelector,
    optionPreferredSelector: challengeConfig.optionPreferredSelector,
    optionSelectors: challengeConfig.optionSelectors,
    optionText: challengeConfig.optionText,
    optionTexts: challengeConfig.optionTexts,
    continueSelectors: challengeConfig.continueSelectors,
    continueTexts: challengeConfig.continueTexts,
    passwordSelectors: challengeConfig.passwordSelectors,
    codeSelectors: challengeConfig.codeSelectors,
    submitSelectors: challengeConfig.submitSelectors
  }, `
    const describeEntry = (entry) => {
      if (!entry) {
        return { found: false };
      }

      const rect = entry.element.getBoundingClientRect();
      return {
        found: true,
        x: Math.round(entry.offsetX + rect.left + (rect.width / 2)),
        y: Math.round(entry.offsetY + rect.top + (rect.height / 2)),
        text: getElementText(entry.element),
        value: 'value' in entry.element ? entry.element.value : '',
        disabled: entry.element.disabled === true || entry.element.getAttribute?.('aria-disabled') === 'true'
      };
    };

    const findByTexts = (selectorList, texts = []) => {
      for (const text of texts || []) {
        const entry = findEntryByText(selectorList, text, 'includes');
        if (entry) {
          return entry;
        }
      }

      return null;
    };

    const optionTexts = payload.optionTexts || (payload.optionText ? [payload.optionText] : []);
    const challengeTexts = payload.challengeTexts || [];
    const shellEntry = payload.challengeShellSelectors
      ? findEntry(payload.challengeShellSelectors)
      : null;
    const challengeTextEntry = findByTexts(
      'h1, h2, h3, h4, p, span, div, label, button, [role="heading"], [aria-live]',
      challengeTexts
    );
    const triggerEntry = findEntry(payload.optionTriggerValueSelector || payload.optionTriggerSelector);
    const optionContainerEntry = findEntry(payload.optionContainerSelector);
    const preferredOptionEntry = payload.optionPreferredSelector
      ? findEntry(payload.optionPreferredSelector)
      : null;
    const fallbackOptionEntry = preferredOptionEntry
      || findByTexts(
        payload.optionSelectors || 'label, button, [role="button"], [role="radio"], input[type="radio"], span, div, a',
        optionTexts
      );
    const continueEntry = payload.continuePreferredSelector
      ? findEntry(payload.continuePreferredSelector)
      : null;
    const fallbackContinueEntry = continueEntry || findByTexts(
      payload.continueSelectors || 'button, [role="button"], input[type="submit"]',
      payload.continueTexts || []
    );

    return {
      url: location.href,
      shell: describeEntry(shellEntry || challengeTextEntry),
      trigger: describeEntry(triggerEntry),
      optionContainerOpen: Boolean(optionContainerEntry),
      preferredOption: describeEntry(preferredOptionEntry || fallbackOptionEntry),
      continueButton: describeEntry(fallbackContinueEntry),
      password: describeEntry(findEntry(payload.passwordSelectors)),
      code: describeEntry(findEntry(payload.codeSelectors)),
      submitButton: describeEntry(findEntry(payload.submitSelectors))
    };
  `);
}

async function waitForNativeManualChallengeState(tabId, challengeConfig, predicate, timeoutMs, pollMs = 200) {
  const startedAtMs = Date.now();

  while (Date.now() - startedAtMs < timeoutMs) {
    const currentTab = await chrome.tabs.get(tabId);
    const loadError = getTabLoadError(currentTab);
    if (loadError) {
      throw new Error(loadError);
    }

    const state = await getNativeManualChallengeState(tabId, challengeConfig);
    if (predicate(state)) {
      return state;
    }

    await sleep(pollMs);
  }

  return getNativeManualChallengeState(tabId, challengeConfig);
}

async function runNativeManualChallengePreparation(tab, challengeConfig) {
  const nativeConfig = challengeConfig.nativePrepare;
  if (!nativeConfig?.enabled || !tab?.id) {
    return null;
  }

  const currentTab = await chrome.tabs.get(tab.id);
  let previousActiveTabId = null;

  if (nativeConfig.activateTab !== false && currentTab.windowId) {
    const [previousActiveTab] = await chrome.tabs.query({ active: true, windowId: currentTab.windowId });
    previousActiveTabId = previousActiveTab?.id || null;
    await chrome.tabs.update(tab.id, { active: true });
    await sleep(nativeConfig.activationSettleMs || 250);
  }

  try {
    return await withAttachedDebugger(tab.id, async () => {
      const timeoutMs = nativeConfig.timeoutMs || Math.min(challengeConfig.timeoutMs || 15000, 12000);
      const pollMs = nativeConfig.pollMs || 200;
      const startedAtMs = Date.now();

      while (Date.now() - startedAtMs < timeoutMs) {
        const state = await getNativeManualChallengeState(tab.id, challengeConfig);
        if (state?.code?.found || state?.password?.found) {
          return {
            ok: true,
            prepared: true,
            stage: state?.code?.found ? 'code' : 'password',
            awaitingUser: Boolean(state?.code?.found),
            message: state?.code?.found
              ? 'Trusted verification flow reached the verification code form.'
              : 'Trusted verification flow reached the verification password form.'
          };
        }

        const selectionResolved = isNativeManualChallengeSelectionResolved(state, challengeConfig);
        if (!selectionResolved) {
          if (state?.continueButton?.found && !state.continueButton.disabled && !state?.trigger?.found) {
            if (nativeConfig.beforeContinueWaitMs || challengeConfig.beforeContinueWaitMs) {
              await sleep(nativeConfig.beforeContinueWaitMs || challengeConfig.beforeContinueWaitMs);
            }

            await dispatchNativeClick(tab.id, state.continueButton);
            if (nativeConfig.continueSettleMs || challengeConfig.continueSettleMs) {
              await sleep(nativeConfig.continueSettleMs || challengeConfig.continueSettleMs);
            }

            const advancedState = await waitForNativeManualChallengeState(
              tab.id,
              challengeConfig,
              (nextState) => Boolean(
                nextState?.code?.found
                || nextState?.password?.found
                || (!nextState?.continueButton?.found && !nextState?.preferredOption?.found && !nextState?.trigger?.found)
              ),
              nativeConfig.advanceTimeoutMs || Math.max(challengeConfig.continueSettleMs || 1500, 1500),
              pollMs
            );

            if (advancedState?.code?.found || advancedState?.password?.found) {
              return {
                ok: true,
                prepared: true,
                stage: advancedState?.code?.found ? 'code' : 'password',
                awaitingUser: Boolean(advancedState?.code?.found),
                message: advancedState?.code?.found
                  ? 'Trusted verification flow reached the verification code form.'
                  : 'Trusted verification flow reached the verification password form.'
              };
            }

            await sleep(pollMs);
            continue;
          }

          if (state?.preferredOption?.found && !state.preferredOption.disabled && !state?.trigger?.found) {
            await dispatchNativeClick(tab.id, state.preferredOption);
            if (nativeConfig.optionPostClickWaitMs || challengeConfig.optionPostClickWaitMs) {
              await sleep(nativeConfig.optionPostClickWaitMs || challengeConfig.optionPostClickWaitMs);
            }

            const selectionState = await waitForNativeManualChallengeState(
              tab.id,
              challengeConfig,
              (nextState) => (
                isNativeManualChallengeSelectionResolved(nextState, challengeConfig)
                || nextState?.code?.found
                || nextState?.password?.found
                || Boolean(nextState?.continueButton?.found)
              ),
              nativeConfig.optionSelectedTimeoutMs || challengeConfig.optionSelectedTimeoutMs || 4000,
              nativeConfig.optionSelectionPollMs || challengeConfig.optionSelectionPollMs || pollMs
            );

            if (selectionState?.code?.found || selectionState?.password?.found) {
              return {
                ok: true,
                prepared: true,
                stage: selectionState?.code?.found ? 'code' : 'password',
                awaitingUser: Boolean(selectionState?.code?.found),
                message: selectionState?.code?.found
                  ? 'Trusted verification flow reached the verification code form.'
                  : 'Trusted verification flow reached the verification password form.'
              };
            }

            await sleep(nativeConfig.optionSettleMs || challengeConfig.optionSettleMs || 500);
            continue;
          }

          if (!state?.trigger?.found) {
            await sleep(pollMs);
            continue;
          }

          if (!state.optionContainerOpen) {
            await dispatchNativeClick(tab.id, state.trigger);
            await sleep(nativeConfig.optionMenuOpenWaitMs || challengeConfig.optionMenuOpenWaitMs || 500);
            continue;
          }

          if (state.preferredOption?.found && !state.preferredOption.disabled) {
            await dispatchNativeClick(tab.id, state.preferredOption);
            if (nativeConfig.optionPostClickWaitMs || challengeConfig.optionPostClickWaitMs) {
              await sleep(nativeConfig.optionPostClickWaitMs || challengeConfig.optionPostClickWaitMs);
            }

            const selectionState = await waitForNativeManualChallengeState(
              tab.id,
              challengeConfig,
              (nextState) => (
                isNativeManualChallengeSelectionResolved(nextState, challengeConfig)
                || nextState?.code?.found
                || nextState?.password?.found
              ),
              nativeConfig.optionSelectedTimeoutMs || challengeConfig.optionSelectedTimeoutMs || 4000,
              nativeConfig.optionSelectionPollMs || challengeConfig.optionSelectionPollMs || pollMs
            );

            if (selectionState?.code?.found || selectionState?.password?.found) {
              return {
                ok: true,
                prepared: true,
                stage: selectionState?.code?.found ? 'code' : 'password',
                awaitingUser: Boolean(selectionState?.code?.found),
                message: selectionState?.code?.found
                  ? 'Trusted verification flow reached the verification code form.'
                  : 'Trusted verification flow reached the verification password form.'
              };
            }

            await sleep(nativeConfig.optionSettleMs || challengeConfig.optionSettleMs || 500);
            continue;
          }

          await sleep(pollMs);
          continue;
        }

        const continueState = state.continueButton?.found
          ? state
          : await waitForNativeManualChallengeState(
            tab.id,
            challengeConfig,
            (nextState) => Boolean(
              nextState?.continueButton?.found
              || nextState?.code?.found
              || nextState?.password?.found
            ),
            nativeConfig.continueDiscoveryTimeoutMs || 2500,
            pollMs
          );

        if (continueState?.code?.found || continueState?.password?.found) {
          return {
            ok: true,
            prepared: true,
            stage: continueState?.code?.found ? 'code' : 'password',
            awaitingUser: Boolean(continueState?.code?.found),
            message: continueState?.code?.found
              ? 'Trusted verification flow reached the verification code form.'
              : 'Trusted verification flow reached the verification password form.'
          };
        }

        if (continueState?.continueButton?.found && !continueState.continueButton.disabled) {
          if (nativeConfig.beforeContinueWaitMs || challengeConfig.beforeContinueWaitMs) {
            await sleep(nativeConfig.beforeContinueWaitMs || challengeConfig.beforeContinueWaitMs);
          }

          await dispatchNativeClick(tab.id, continueState.continueButton);
          if (nativeConfig.continueSettleMs || challengeConfig.continueSettleMs) {
            await sleep(nativeConfig.continueSettleMs || challengeConfig.continueSettleMs);
          }

          const advancedState = await waitForNativeManualChallengeState(
            tab.id,
            challengeConfig,
            (nextState) => Boolean(
              nextState?.code?.found
              || nextState?.password?.found
              || (!nextState?.continueButton?.found && !nextState?.trigger?.found)
            ),
            nativeConfig.advanceTimeoutMs || Math.max(challengeConfig.continueSettleMs || 1500, 1500),
            pollMs
          );

          if (advancedState?.code?.found || advancedState?.password?.found) {
            return {
              ok: true,
              prepared: true,
              message: 'Trusted verification flow reached the challenge form.'
            };
          }
        }

        await sleep(pollMs);
      }

      return {
        ok: false,
        message: 'Trusted verification preparation did not finish selecting the Chase delivery method.'
      };
    });
  } finally {
    if (previousActiveTabId && previousActiveTabId !== tab.id) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, windowId: currentTab.windowId });
        if (activeTab?.id === tab.id) {
          await chrome.tabs.update(previousActiveTabId, { active: true });
        }
      } catch (error) {
        console.warn('Could not restore previously active tab after trusted verification preparation.', error);
      }
    }
  }
}

async function runNativeManualChallengeSubmit(tab, challengeConfig) {
  const nativeConfig = challengeConfig.nativeSubmitAfterCode;
  if (!nativeConfig?.enabled || !tab?.id) {
    return null;
  }

  const currentTab = await chrome.tabs.get(tab.id);
  let previousActiveTabId = null;

  if (nativeConfig.activateTab !== false && currentTab.windowId) {
    const [previousActiveTab] = await chrome.tabs.query({ active: true, windowId: currentTab.windowId });
    previousActiveTabId = previousActiveTab?.id || null;
    await chrome.tabs.update(tab.id, { active: true });
    await sleep(nativeConfig.activationSettleMs || 250);
  }

  try {
    return await withAttachedDebugger(tab.id, async () => {
      const methods = Array.isArray(nativeConfig.methods) && nativeConfig.methods.length
        ? nativeConfig.methods
        : ['nativeClick', 'nativeEnter'];

      for (const method of methods) {
        const state = await getNativeManualChallengeState(tab.id, challengeConfig);

        if (method === 'nativeClick' && state?.submitButton?.found && !state.submitButton.disabled) {
          await dispatchNativeClick(tab.id, state.submitButton);
          await sleep(nativeConfig.postActionWaitMs || 300);
          return {
            ok: true,
            message: 'Submitted verification with a trusted click.'
          };
        }

        if (method === 'nativeEnter') {
          const focusTarget = state?.submitButton?.found
            ? state.submitButton
            : (state?.code?.found ? state.code : null);
          if (focusTarget?.found) {
            await dispatchNativeClick(tab.id, focusTarget);
            await sleep(nativeConfig.focusSettleMs || 120);
            await dispatchNativeEnter(tab.id);
            await sleep(nativeConfig.postActionWaitMs || 300);
            return {
              ok: true,
              message: 'Submitted verification with trusted Enter.'
            };
          }
        }
      }

      return {
        ok: false,
        message: 'Trusted verification submit could not find a usable submit control.'
      };
    });
  } finally {
    if (previousActiveTabId && previousActiveTabId !== tab.id) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, windowId: currentTab.windowId });
        if (activeTab?.id === tab.id) {
          await chrome.tabs.update(previousActiveTabId, { active: true });
        }
      } catch (error) {
        console.warn('Could not restore previously active tab after trusted verification submit.', error);
      }
    }
  }
}

function injectedLogin(payload) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const normalizeText = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const getElementText = (element) => normalizeText(
    element?.innerText
    || element?.textContent
    || element?.value
    || element?.getAttribute?.('aria-label')
    || element?.getAttribute?.('value')
    || ''
  );
  const isVisible = (element) => {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
  };

  const queryFirst = (selectorList) => {
    for (const selector of (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }
    return null;
  };
  const queryFirstVisible = (selectorList) => {
    for (const selector of (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const elements = Array.from(document.querySelectorAll(selector));
      const visibleMatch = elements.find((element) => isVisible(element));
      if (visibleMatch) {
        return visibleMatch;
      }
    }
    return null;
  };

  const queryByText = (selectorList, text, options = {}) => {
    const normalizedNeedle = normalizeText(text).toLowerCase();
    const candidates = Array.from(document.querySelectorAll(selectorList || 'a, button, [role="button"]'));
    const mode = options.match === 'includes' ? 'includes' : 'exact';
    return candidates.find((element) => {
      const haystack = getElementText(element).toLowerCase();
      if (!haystack) {
        return false;
      }

      return mode === 'includes'
        ? haystack.includes(normalizedNeedle)
        : haystack === normalizedNeedle;
    }) || null;
  };

  const clickElement = (element) => {
    if (!element) {
      return false;
    }

    element.focus?.();
    for (const eventName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      element.dispatchEvent(new MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      }));
    }

    if (typeof element.click === 'function') {
      element.click();
    }

    return true;
  };

  const pressEnter = (element) => {
    if (!element) {
      return false;
    }

    element.focus?.();
    for (const eventName of ['keydown', 'keypress', 'keyup']) {
      element.dispatchEvent(new KeyboardEvent(eventName, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      }));
    }

    return true;
  };

  const waitForSelector = async (selectorList, timeoutMs = 15000, options = {}) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const element = queryFirst(selectorList);
      if (element && (!options.visible || isVisible(element))) {
        return element;
      }
      await sleep(250);
    }
    return null;
  };

  const setNativeValue = (element, value) => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    const previousValue = element.value;
    descriptor?.set?.call(element, value);
    if (element._valueTracker?.setValue) {
      element._valueTracker.setValue(previousValue);
    }
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Unidentified' }));
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: String(value ?? ''),
      inputType: 'insertText'
    }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  };

  const { login, username, password } = payload;
  const loginTimeoutMs = login.timeoutMs || 5000;

  const setValueIfPresent = async (selectorList, value) => {
    if (!selectorList) {
      return false;
    }

    const element = await waitForSelector(selectorList, loginTimeoutMs);
    if (!element) {
      return false;
    }

    element.focus?.();
    setNativeValue(element, value);
    await sleep(100);
    return true;
  };

  const runPreLoginActions = async () => {
    for (const action of login.preActions || []) {
      if (action.type === 'click') {
        const selector = action.selector || 'a, button, [role="button"]';
        const target = action.text
          ? queryByText(selector, action.text, { match: action.textMatch })
          : queryFirst(selector);

        if (target) {
          clickElement(target);
          if (action.waitFor) {
            await waitForSelector(action.waitFor, action.timeoutMs || loginTimeoutMs, {
              visible: action.waitForVisible === true
            });
          }
          await sleep(action.waitMs || 500);
        }
      }
    }
  };

  const waitForLoginInputs = async (requiresUsername) => {
    const start = Date.now();
    while (Date.now() - start < loginTimeoutMs) {
      const usernameInput = queryFirstVisible(login.selectors.username);
      const passwordInput = queryFirstVisible(login.selectors.password);

      if ((!requiresUsername || usernameInput) && passwordInput) {
        return { usernameInput, passwordInput };
      }

      await sleep(200);
    }

    return {
      usernameInput: queryFirstVisible(login.selectors.username),
      passwordInput: queryFirstVisible(login.selectors.password)
    };
  };

  const waitForSubmitReady = async (submitButton, timeoutMs = login.submitReadyTimeoutMs || Math.min(loginTimeoutMs, 2000)) => {
    if (!submitButton) {
      return null;
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!submitButton.disabled && submitButton.getAttribute('aria-disabled') !== 'true') {
        return submitButton;
      }
      await sleep(150);
    }

    return submitButton;
  };

  const hasSubmitProgress = (previousUrl, previousPasswordInput) => {
    if (location.href !== previousUrl) {
      return true;
    }

    if (login.submitProgressSelectors && queryFirstVisible(login.submitProgressSelectors)) {
      return true;
    }

    const currentPasswordInput = queryFirstVisible(login.selectors.password);
    if (!currentPasswordInput) {
      return true;
    }

    if (previousPasswordInput && currentPasswordInput !== previousPasswordInput) {
      return true;
    }

    return false;
  };

  const waitForSubmitProgress = async (previousUrl, previousPasswordInput, timeoutMs = login.submitProgressTimeoutMs || 0) => {
    if (!timeoutMs) {
      return hasSubmitProgress(previousUrl, previousPasswordInput);
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (hasSubmitProgress(previousUrl, previousPasswordInput)) {
        return true;
      }
      await sleep(150);
    }

    return hasSubmitProgress(previousUrl, previousPasswordInput);
  };

  const submitForm = async (submitButton, usernameInput, passwordInput) => {
    const form = usernameInput?.closest('form') || passwordInput?.closest('form');
    const submitStrategy = login.submitStrategy || 'auto';
    const shouldPressEnterFirst = login.submitWithEnter && passwordInput && login.submitWithEnterFirst !== false;
    const submitMethods = Array.isArray(login.submitMethods)
      ? login.submitMethods.filter(Boolean)
      : null;
    const submitMethodWaitMs = login.submitMethodWaitMs || 150;

    const attemptSubmitMethod = async (method) => {
      switch (method) {
        case 'click':
          if (submitButton) {
            clickElement(submitButton);
            return true;
          }
          return false;
        case 'requestSubmit':
          if (submitStrategy !== 'clickOnly' && form) {
            form.requestSubmit(submitButton || undefined);
            return true;
          }
          return false;
        case 'dispatchSubmit':
          if (form) {
            const submitEvent = typeof SubmitEvent === 'function'
              ? new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: submitButton || undefined })
              : new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(submitEvent);
            return true;
          }
          return false;
        case 'enter':
          if (passwordInput) {
            pressEnter(passwordInput);
            await sleep(login.enterSubmitWaitMs || 400);
            return true;
          }
          return false;
        default:
          return false;
      }
    };

    if (submitMethods?.length) {
      const attemptedMethods = [];
      for (const method of submitMethods) {
        const attempted = await attemptSubmitMethod(method);
        if (attempted) {
          attemptedMethods.push(method);
          await sleep(submitMethodWaitMs);
        }
      }

      if (attemptedMethods.length) {
        return {
          ok: true,
          foundForm: true,
          message: `Submitted login form using ${attemptedMethods.join(', ')}.`
        };
      }
    }

    if (shouldPressEnterFirst) {
      pressEnter(passwordInput);
      await sleep(login.enterSubmitWaitMs || 400);
    }

    if (submitButton && !submitButton.disabled && submitButton.getAttribute('aria-disabled') !== 'true') {
      clickElement(submitButton);
      return {
        ok: true,
        foundForm: true,
        message: `Submitted login form using ${normalizeText(login.selectors.submit)}.`
      };
    }

    if (submitStrategy !== 'clickOnly' && form) {
      form.requestSubmit();
      return {
        ok: true,
        foundForm: true,
        message: 'Submitted login form using requestSubmit().'
      };
    }

    if (submitButton && submitStrategy !== 'formOnly') {
      clickElement(submitButton);
      return {
        ok: true,
        foundForm: true,
        message: `Attempted submit using ${normalizeText(login.selectors.submit)} while button appeared disabled.`
      };
    }

    if (login.submitWithEnter && passwordInput && login.submitWithEnterFirst === false) {
      pressEnter(passwordInput);
      await sleep(login.enterSubmitWaitMs || 400);
      return {
        ok: true,
        foundForm: true,
        message: 'Submitted login form using Enter on the password field.'
      };
    }

    return {
      ok: false,
      foundForm: true,
      message: 'Could not find a submit control for the login form.'
    };
  };

  const submitFormWithRetries = async (usernameInput, passwordInput, options = {}) => {
    const attempts = Math.max(1, login.submitAttempts || 1);
    let lastResult = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const submitButton = options.skipReadyWait
        ? queryFirstVisible(login.selectors.submit)
        : await waitForSubmitReady(
          queryFirstVisible(login.selectors.submit),
          options.readyTimeoutMs
        );
      const previousUrl = location.href;
      lastResult = await submitForm(submitButton, usernameInput, passwordInput);
      if (!lastResult.ok) {
        return lastResult;
      }

      const progressed = await waitForSubmitProgress(previousUrl, passwordInput, login.submitProgressTimeoutMs || 0);
      if (progressed) {
        return {
          ...lastResult,
          message: `${lastResult.message} Login advanced after submit attempt ${attempt + 1}.`
        };
      }

      if (attempt < attempts - 1) {
        await sleep(login.submitRetryDelayMs || 350);
      }
    }

    return {
      ...(lastResult || {
        foundForm: true,
        ok: false,
        message: 'Login submit was attempted, but the page did not advance.'
      }),
      ok: false,
      foundForm: true,
      message: `Tried submitting the login form ${Math.max(1, login.submitAttempts || 1)} time(s), but the page did not advance.`
    };
  };

  return (async () => {
    await runPreLoginActions();

    const requiresUsername = !login.usernameOptional || Boolean(username);
    let { usernameInput, passwordInput } = await waitForLoginInputs(requiresUsername);

    if (login.allowUsernameOnlyStep === true && usernameInput && !passwordInput) {
      if (username) {
        usernameInput.focus();
        setNativeValue(usernameInput, username);
        await sleep(150);
      }

      if (username) {
        await setValueIfPresent(login.selectors.hiddenUsername, username);
      }

      if (login.initialInputSettleMs) {
        await sleep(login.initialInputSettleMs);
      }

      const initialSubmitButton = await waitForSubmitReady(
        queryFirstVisible(login.initialSubmitSelectors || login.selectors.submit),
        login.initialSubmitReadyTimeoutMs || login.submitReadyTimeoutMs
      );
      const initialSubmitResult = await submitForm(initialSubmitButton, usernameInput, null);
      await sleep(login.initialSubmitWaitMs || 1000);

      passwordInput = await waitForSelector(
        login.selectors.password,
        login.passwordStepTimeoutMs || loginTimeoutMs,
        { visible: true }
      );

      if (!passwordInput) {
        return {
          ok: false,
          foundForm: initialSubmitResult.foundForm,
          message: 'Chase advanced past the username step, but the password field never appeared.'
        };
      }
    }

    if ((requiresUsername && !usernameInput) || !passwordInput) {
      return {
        ok: false,
        message: 'Login form not found. The site may already be logged in, may require a different flow, or may have changed.'
      };
    }

    if (usernameInput && username) {
      usernameInput.focus();
      setNativeValue(usernameInput, username);
      await sleep(150);
    }

    if (username) {
      await setValueIfPresent(login.selectors.hiddenUsername, username);
    }

    passwordInput.focus();
    setNativeValue(passwordInput, password || '');
    await sleep(login.passwordInputSettleMs || 150);

    if (password) {
      await setValueIfPresent(login.selectors.hiddenPassword, password);
    }

    if (login.submitImmediatelyAfterPassword === true) {
      return submitFormWithRetries(usernameInput, passwordInput, { skipReadyWait: true });
    }

    return submitFormWithRetries(usernameInput, passwordInput, {
      readyTimeoutMs: login.submitReadyTimeoutMs || Math.min(loginTimeoutMs, 2000)
    });
  })();
}

function chooseLoginResult(results = []) {
  const normalizedResults = (Array.isArray(results) ? results : [results]).filter(Boolean);

  const successfulResult = normalizedResults.find((result) => result.ok);
  if (successfulResult) {
    return successfulResult;
  }

  const foundFormResult = normalizedResults.find((result) => result.foundForm);
  if (foundFormResult) {
    return foundFormResult;
  }

  return normalizedResults[0] || {
    ok: false,
    message: 'Login form not found. The site may already be logged in, may require a different flow, or may have changed.'
  };
}

function chooseChallengeResult(results = []) {
  const normalizedResults = (Array.isArray(results) ? results : [results]).filter(Boolean);

  const awaitingUser = normalizedResults.find((result) => result.awaitingUser);
  if (awaitingUser) {
    return awaitingUser;
  }

  const preparedResult = normalizedResults.find((result) => result.ok && result.prepared);
  if (preparedResult) {
    return preparedResult;
  }

  const successfulResult = normalizedResults.find((result) => result.ok);
  if (successfulResult) {
    return successfulResult;
  }

  return normalizedResults[0] || {
    ok: false,
    message: 'Manual verification challenge was not found.'
  };
}

function injectedDetectManualChallengeUi(payload) {
  const normalizeText = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const getElementText = (element) => normalizeText(
    element?.innerText
    || element?.textContent
    || element?.value
    || element?.getAttribute?.('aria-label')
    || element?.getAttribute?.('value')
    || ''
  );
  const isVisible = (element) => {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
  };
  const queryFirstVisible = (selectorList) => {
    for (const selector of (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const elements = Array.from(document.querySelectorAll(selector));
      const visibleMatch = elements.find((element) => isVisible(element));
      if (visibleMatch) {
        return visibleMatch;
      }
    }
    return null;
  };
  const queryByText = (selectorList, text, options = {}) => {
    const normalizedNeedle = normalizeText(text).toLowerCase();
    const mode = options.match === 'includes' ? 'includes' : 'exact';
    const candidates = Array.from(document.querySelectorAll(selectorList || 'a, button, [role="button"], span, div'));
    return candidates.find((element) => {
      if (!isVisible(element)) {
        return false;
      }

      const haystack = getElementText(element).toLowerCase();
      if (!haystack) {
        return false;
      }

      return mode === 'includes'
        ? haystack.includes(normalizedNeedle)
        : haystack === normalizedNeedle;
    }) || null;
  };
  const queryAnyText = (selectorList, texts = [], options = {}) => {
    for (const text of texts || []) {
      const match = queryByText(selectorList, text, options);
      if (match) {
        return match;
      }
    }
    return null;
  };
  const queryVisibleInputs = (selectorList) => {
    const selectors = (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean);
    const matches = new Set();
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (isVisible(element)) {
          matches.add(element);
        }
      }
    }
    return Array.from(matches);
  };

  const optionTexts = payload.optionTexts || (payload.optionText ? [payload.optionText] : []);
  const challengeTextMatch = queryAnyText(
    'h1, h2, h3, h4, p, span, div, label, button, [role="heading"], [aria-live]',
    payload.challengeTexts || [],
    { match: 'includes' }
  );
  const hasOptionText = optionTexts.some((text) => queryByText(
    payload.optionSelectors || 'label, button, [role="button"], [role="radio"], input[type="radio"], span, div, a',
    text,
    { match: payload.optionTextMatch }
  ));
  const hasContinueText = Array.isArray(payload.continueTexts)
    && payload.continueTexts.some((text) => queryByText(payload.continueSelectors, text, { match: 'includes' }));

  return {
    found: Boolean(
      queryVisibleInputs(payload.codeSelectors).length
      || queryVisibleInputs(payload.passwordSelectors).length
      || (payload.challengeShellSelectors && queryFirstVisible(payload.challengeShellSelectors))
      || challengeTextMatch
      || (payload.optionTriggerSelector && queryFirstVisible(payload.optionTriggerSelector))
      || (payload.optionContainerSelector && queryFirstVisible(payload.optionContainerSelector))
      || hasOptionText
      || hasContinueText
    )
  };
}

function injectedAssistManualChallenge(payload) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalizeText = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const getElementText = (element) => normalizeText(
    element?.innerText
    || element?.textContent
    || element?.value
    || element?.getAttribute?.('aria-label')
    || element?.getAttribute?.('value')
    || ''
  );
  const isVisible = (element) => {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
  };
  const collectQueryRoots = (root) => {
    const roots = [];
    const pending = [root];
    const seen = new Set();

    while (pending.length) {
      const current = pending.shift();
      if (!current || seen.has(current)) {
        continue;
      }

      seen.add(current);
      roots.push(current);

      if (typeof current.querySelectorAll !== 'function') {
        continue;
      }

      for (const element of Array.from(current.querySelectorAll('*'))) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) {
          pending.push(element.shadowRoot);
        }
      }
    }

    return roots;
  };
  const queryAllDeep = (root, selector) => {
    const matches = [];
    for (const searchRoot of collectQueryRoots(root)) {
      try {
        matches.push(...Array.from(searchRoot.querySelectorAll(selector)));
      } catch (error) {
        // Ignore invalid selectors for this search root.
      }
    }
    return matches;
  };
  const queryFirst = (selectorList) => {
    for (const selector of (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const element = queryAllDeep(document, selector)[0];
      if (element) {
        return element;
      }
    }
    return null;
  };
  const queryFirstVisible = (selectorList) => {
    for (const selector of (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const elements = queryAllDeep(document, selector);
      const visibleMatch = elements.find((element) => isVisible(element));
      if (visibleMatch) {
        return visibleMatch;
      }
    }
    return null;
  };
  const queryByText = (selectorList, text, options = {}) => {
    const normalizedNeedle = normalizeText(text).toLowerCase();
    const mode = options.match === 'includes' ? 'includes' : 'exact';
    const candidates = queryAllDeep(document, selectorList || 'a, button, [role="button"]');
    return candidates.find((element) => {
      if (!isVisible(element)) {
        return false;
      }

      const haystack = getElementText(element).toLowerCase();
      if (!haystack) {
        return false;
      }

      return mode === 'includes'
        ? haystack.includes(normalizedNeedle)
        : haystack === normalizedNeedle;
    }) || null;
  };
  const queryAnyText = (selectorList, texts = [], options = {}) => {
    for (const text of texts || []) {
      const match = queryByText(selectorList, text, options);
      if (match) {
        return match;
      }
    }
    return null;
  };
  const findChoiceByText = (textOptions = []) => {
    const normalizedOptions = textOptions
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean);

    if (!normalizedOptions.length) {
      return null;
    }

    const candidates = Array.from(document.querySelectorAll(
      payload.optionSelectors || 'label, button, [role="button"], [role="radio"], input[type="radio"], span, div'
    ));
    const deepCandidates = candidates.length ? candidates : queryAllDeep(
      document,
      payload.optionSelectors || 'label, button, [role="button"], [role="radio"], input[type="radio"], span, div'
    );

    const matchingCandidate = deepCandidates.find((element) => {
      if (!isVisible(element)) {
        return false;
      }

      const haystack = getElementText(element).toLowerCase();
      return haystack && normalizedOptions.some((option) => haystack.includes(option));
    });

    if (!matchingCandidate) {
      return null;
    }

    const chooseGroupedOption = (groupHeader) => {
      const groupItem = groupHeader.closest?.('li[role="presentation"]');
      let sibling = groupItem?.nextElementSibling || null;
      while (sibling) {
        const option = sibling.querySelector?.('a[role="option"], button, [role="button"], [role="radio"], input[type="radio"], input[type="checkbox"]');
        if (!option || !isVisible(option)) {
          sibling = sibling.nextElementSibling;
          continue;
        }

        const isDisabled = option.getAttribute('aria-disabled') === 'true' || option.disabled === true;
        if (isDisabled) {
          break;
        }

        return option;
      }

      return null;
    };

    const candidateIsGroupHeader = matchingCandidate.getAttribute?.('aria-disabled') === 'true'
      || matchingCandidate.classList?.contains('groupLabelContainer')
      || matchingCandidate.closest?.('.groupLabelContainer');
    if (candidateIsGroupHeader) {
      const groupedOption = chooseGroupedOption(matchingCandidate);
      if (groupedOption) {
        return groupedOption;
      }
    }

    if (matchingCandidate.matches('input[type="radio"], input[type="checkbox"]')) {
      return matchingCandidate;
    }

    const nestedChoice = matchingCandidate.querySelector?.('input[type="radio"], input[type="checkbox"], button, [role="button"], [role="radio"]');
    if (nestedChoice && isVisible(nestedChoice)) {
      return nestedChoice;
    }

    const closestLabel = matchingCandidate.closest?.('label');
    if (closestLabel) {
      const labeledInput = closestLabel.querySelector('input[type="radio"], input[type="checkbox"]');
      if (labeledInput && isVisible(labeledInput)) {
        return labeledInput;
      }
    }

    const forAttribute = matchingCandidate.getAttribute?.('for');
    if (forAttribute) {
      const referencedInput = document.getElementById(forAttribute);
      if (referencedInput && isVisible(referencedInput)) {
        return referencedInput;
      }
    }

    return matchingCandidate;
  };
  const queryVisibleInputs = (selectorList) => {
    const selectors = (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean);
    const matches = new Set();
    for (const selector of selectors) {
      for (const element of queryAllDeep(document, selector)) {
        if (isVisible(element)) {
          matches.add(element);
        }
      }
    }
    return Array.from(matches);
  };
  const clickElement = (element) => {
    if (!element) {
      return false;
    }

    element.focus?.();
    for (const eventName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      element.dispatchEvent(new MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      }));
    }

    element.click?.();
    return true;
  };
  const pressEnter = (element) => {
    if (!element) {
      return false;
    }

    element.focus?.();
    for (const eventName of ['keydown', 'keypress', 'keyup']) {
      element.dispatchEvent(new KeyboardEvent(eventName, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      }));
    }

    return true;
  };
  const setNativeValue = (element, value) => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    const previousValue = element.value;
    descriptor?.set?.call(element, value);
    if (element._valueTracker?.setValue) {
      element._valueTracker.setValue(previousValue);
    }
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Unidentified' }));
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: String(value ?? ''),
      inputType: 'insertText'
    }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const submitChallenge = (referenceInput) => {
    const submitButton = queryFirstVisible(payload.submitSelectors);
    if (submitButton && !submitButton.disabled && submitButton.getAttribute('aria-disabled') !== 'true') {
      clickElement(submitButton);
      return true;
    }

    const form = referenceInput?.closest('form');
    if (form) {
      form.requestSubmit();
      return true;
    }

    if (submitButton) {
      clickElement(submitButton);
      return true;
    }

    return false;
  };
  const bindAutoSubmit = (codeInputs) => {
    if (payload.autoSubmitCode === false) {
      return false;
    }

    if (!codeInputs.length) {
      return false;
    }

    const allFilled = () => codeInputs.every((input) => normalizeText(input.value).length > 0);
    for (const input of codeInputs) {
      if (input.dataset.codexChallengeBound === 'true') {
        continue;
      }

      const maybeSubmit = () => {
        if (allFilled()) {
          submitChallenge(input);
        }
      };

      input.addEventListener('blur', maybeSubmit);
      input.addEventListener('change', maybeSubmit);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          maybeSubmit();
        }
      });
      input.dataset.codexChallengeBound = 'true';
    }

    return true;
  };

  const bindManualReady = (codeInputs) => {
    if (payload.autoSubmitCode !== false || !codeInputs.length) {
      return false;
    }

    const allFilled = () => codeInputs.every((input) => normalizeText(input.value).length > 0);
    const settleMs = payload.manualSubmitSettleMs || 500;

    for (const input of codeInputs) {
      if (input.dataset.codexManualReadyBound === 'true') {
        continue;
      }

      const maybeBlur = () => {
        if (!allFilled()) {
          return;
        }

        window.setTimeout(() => {
          for (const codeInput of codeInputs) {
            codeInput.blur?.();
          }

          const submitButton = queryFirstVisible(payload.submitSelectors);
          if (submitButton && payload.focusSubmitAfterCode !== false) {
            submitButton.focus?.();
          } else {
            document.body?.focus?.();
          }
        }, settleMs);
      };

      input.addEventListener('input', maybeBlur);
      input.addEventListener('change', maybeBlur);
      input.addEventListener('keyup', maybeBlur);
      input.dataset.codexManualReadyBound = 'true';
    }

    return true;
  };

  const getCodeEntryState = () => {
    const codeInputs = queryVisibleInputs(payload.codeSelectors);
    return {
      found: codeInputs.length > 0,
      allFilled: codeInputs.length > 0 && codeInputs.every((input) => normalizeText(input.value).length > 0)
    };
  };

  return (async () => {
    const timeoutMs = payload.timeoutMs || 15000;
    const start = Date.now();
    let clickedOption = false;
    let clickedContinue = false;
    let challengeUiDetected = false;
    let submittedAfterPassword = false;
    let openedOptionMenu = false;

    const frameDiscoveryTimeoutMs = payload.frameDiscoveryTimeoutMs || Math.min(timeoutMs, 8000);
    const getOptionTrigger = () => queryFirstVisible(payload.optionTriggerValueSelector || payload.optionTriggerSelector);
    const getOptionTriggerValue = () => normalizeText(getElementText(getOptionTrigger()));
    const hasResolvedOptionSelection = () => {
      const triggerValue = getOptionTriggerValue().toLowerCase();
      if (!triggerValue) {
        return false;
      }

      const placeholders = (payload.optionPlaceholderTexts || ['Choose one'])
        .map((value) => normalizeText(value).toLowerCase())
        .filter(Boolean);
      return !placeholders.includes(triggerValue);
    };
    const isOptionMenuVisible = () => (
      !payload.optionContainerSelector || Boolean(queryFirstVisible(payload.optionContainerSelector))
    );
    const isOptionListReady = () => {
      if (!isOptionMenuVisible()) {
        return false;
      }

      if (payload.optionPreferredSelector && queryFirstVisible(payload.optionPreferredSelector)) {
        return true;
      }

      const optionTexts = payload.optionTexts || (payload.optionText ? [payload.optionText] : []);
      return Boolean(findChoiceByText(optionTexts));
    };
    const waitForOptionSelection = async () => {
      const selectionTimeoutMs = payload.optionSelectedTimeoutMs || 4000;
      const startedAtMs = Date.now();
      while (Date.now() - startedAtMs < selectionTimeoutMs) {
        if (hasResolvedOptionSelection()) {
          return true;
        }

        if (!isOptionMenuVisible()) {
          const continueReady = Array.isArray(payload.continueTexts)
            && payload.continueTexts.some((text) => queryByText(payload.continueSelectors, text, { match: 'includes' }));
          if (continueReady) {
            return true;
          }
        }

        await sleep(payload.optionSelectionPollMs || 200);
      }

      return hasResolvedOptionSelection();
    };

    const hasChallengeUi = () => {
      if (queryVisibleInputs(payload.codeSelectors).length || queryVisibleInputs(payload.passwordSelectors).length) {
        return true;
      }

      if (payload.challengeShellSelectors && queryFirstVisible(payload.challengeShellSelectors)) {
        return true;
      }

      if (queryAnyText(
        'h1, h2, h3, h4, p, span, div, label, button, [role="heading"], [aria-live]',
        payload.challengeTexts || [],
        { match: 'includes' }
      )) {
        return true;
      }

      if (payload.optionTriggerSelector && queryFirstVisible(payload.optionTriggerSelector)) {
        return true;
      }

      if (payload.optionContainerSelector && queryFirstVisible(payload.optionContainerSelector)) {
        return true;
      }

      const optionTexts = payload.optionTexts || (payload.optionText ? [payload.optionText] : []);
      if (findChoiceByText(optionTexts)) {
        return true;
      }

      return Array.isArray(payload.continueTexts)
        && payload.continueTexts.some((text) => queryByText(payload.continueSelectors, text, { match: 'includes' }));
    };

    while (Date.now() - start < timeoutMs) {
      if (!challengeUiDetected) {
        challengeUiDetected = hasChallengeUi();
        if (!challengeUiDetected && Date.now() - start > frameDiscoveryTimeoutMs) {
          return {
            ok: false,
            message: 'Verification challenge not found in this frame.'
          };
        }
      }

      const codeInputs = queryVisibleInputs(payload.codeSelectors);
      if (codeInputs.length) {
        const passwordInput = queryVisibleInputs(payload.passwordSelectors)[0];
        if (passwordInput && payload.password && normalizeText(passwordInput.value) !== payload.password) {
          passwordInput.focus?.();
          setNativeValue(passwordInput, payload.password);
          await sleep(100);
        }

        bindAutoSubmit(codeInputs);
        bindManualReady(codeInputs);
        codeInputs[0].focus?.();
        return {
          ok: true,
          prepared: true,
          awaitingUser: true,
          message: payload.autoSubmitCode === false
            ? 'Verification code entry is ready. Submit the form when you are done.'
            : 'Verification code entry is ready.'
        };
      }

      const passwordInput = queryVisibleInputs(payload.passwordSelectors)[0];
      if (passwordInput && payload.password && normalizeText(passwordInput.value) !== payload.password) {
        passwordInput.focus?.();
        setNativeValue(passwordInput, payload.password);
        await sleep(payload.passwordInputSettleMs || 100);
      }

      if (!clickedOption) {
        if (hasResolvedOptionSelection()) {
          clickedOption = true;
        } else if (!isOptionListReady()) {
          const optionTrigger = queryFirstVisible(payload.optionTriggerSelector);
          if (optionTrigger && (!openedOptionMenu || payload.reopenOptionMenu !== false)) {
            clickElement(optionTrigger);
            openedOptionMenu = true;
            await sleep(payload.optionMenuOpenWaitMs || 400);
            continue;
          }

          await sleep(payload.optionMenuPollMs || 250);
          continue;
        } else {
          const option = queryFirstVisible(payload.optionPreferredSelector)
            || findChoiceByText(payload.optionTexts || (payload.optionText ? [payload.optionText] : []));
          if (option) {
            clickElement(option);
            if (payload.optionPostClickWaitMs) {
              await sleep(payload.optionPostClickWaitMs);
            }
            const selectionApplied = await waitForOptionSelection();
            clickedOption = selectionApplied;
            openedOptionMenu = !selectionApplied;
            await sleep(payload.optionSettleMs || 500);
            continue;
          }

          await sleep(payload.optionMenuPollMs || 250);
          continue;
        }
      }

      if (!clickedContinue && Array.isArray(payload.continueTexts)) {
        const continueButton = payload.continueTexts
          .map((text) => queryByText(payload.continueSelectors, text, { match: 'includes' }))
          .find(Boolean);
        if (continueButton) {
          if (payload.beforeContinueWaitMs) {
            await sleep(payload.beforeContinueWaitMs);
          }
          clickElement(continueButton);
          clickedContinue = true;
          await sleep(payload.continueSettleMs || 750);
          continue;
        }
      }

      if (passwordInput && payload.submitAfterPassword === true && !submittedAfterPassword) {
        if (payload.beforePasswordSubmitWaitMs) {
          await sleep(payload.beforePasswordSubmitWaitMs);
        }
        submitChallenge(passwordInput);
        submittedAfterPassword = true;
        if (payload.passwordSubmitSettleMs) {
          await sleep(payload.passwordSubmitSettleMs);
        }
      }

      await sleep(250);
    }

    return {
      ok: false,
      message: 'Verification code field was not found.'
    };
  })();
}

function injectedCheckManualCodeEntry(payload) {
  const normalizeText = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const isVisible = (element) => {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
  };
  const collectQueryRoots = (root) => {
    const roots = [];
    const pending = [root];
    const seen = new Set();

    while (pending.length) {
      const current = pending.shift();
      if (!current || seen.has(current)) {
        continue;
      }

      seen.add(current);
      roots.push(current);

      if (typeof current.querySelectorAll !== 'function') {
        continue;
      }

      for (const element of Array.from(current.querySelectorAll('*'))) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) {
          pending.push(element.shadowRoot);
        }
      }
    }

    return roots;
  };
  const queryAllDeep = (root, selector) => {
    const matches = [];
    for (const searchRoot of collectQueryRoots(root)) {
      try {
        matches.push(...Array.from(searchRoot.querySelectorAll(selector)));
      } catch (error) {
        // Ignore invalid selectors for this search root.
      }
    }
    return matches;
  };
  const queryVisibleInputs = (selectorList) => {
    const selectors = (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean);
    const matches = new Set();
    for (const selector of selectors) {
      for (const element of queryAllDeep(document, selector)) {
        if (isVisible(element)) {
          matches.add(element);
        }
      }
    }
    return Array.from(matches);
  };

  const codeInputs = queryVisibleInputs(payload.codeSelectors);
  return {
    found: codeInputs.length > 0,
    allFilled: codeInputs.length > 0 && codeInputs.every((input) => normalizeText(input.value).length > 0)
  };
}

function injectedPrepareManualCodeSubmit(payload) {
  const isVisible = (element) => {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
  };
  const collectQueryRoots = (root) => {
    const roots = [];
    const pending = [root];
    const seen = new Set();

    while (pending.length) {
      const current = pending.shift();
      if (!current || seen.has(current)) {
        continue;
      }

      seen.add(current);
      roots.push(current);

      if (typeof current.querySelectorAll !== 'function') {
        continue;
      }

      for (const element of Array.from(current.querySelectorAll('*'))) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) {
          pending.push(element.shadowRoot);
        }
      }
    }

    return roots;
  };
  const queryAllDeep = (root, selector) => {
    const matches = [];
    for (const searchRoot of collectQueryRoots(root)) {
      try {
        matches.push(...Array.from(searchRoot.querySelectorAll(selector)));
      } catch (error) {
        // Ignore invalid selectors for this search root.
      }
    }
    return matches;
  };
  const queryVisibleInputs = (selectorList) => {
    const selectors = (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean);
    const matches = new Set();
    for (const selector of selectors) {
      for (const element of queryAllDeep(document, selector)) {
        if (isVisible(element)) {
          matches.add(element);
        }
      }
    }
    return Array.from(matches);
  };
  const queryFirstVisible = (selectorList) => {
    for (const selector of (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const elements = queryAllDeep(document, selector);
      const visibleMatch = elements.find((element) => isVisible(element));
      if (visibleMatch) {
        return visibleMatch;
      }
    }
    return null;
  };

  const codeInputs = queryVisibleInputs(payload.codeSelectors);
  for (const input of codeInputs) {
    input.blur?.();
  }

  const submitButton = queryFirstVisible(payload.submitSelectors);
  if (submitButton && payload.focusSubmitAfterCode !== false) {
    submitButton.focus?.();
  } else {
    document.body?.focus?.();
  }

  return {
    found: codeInputs.length > 0,
    submitFocused: Boolean(submitButton && payload.focusSubmitAfterCode !== false)
  };
}

function injectedCheckDocumentState(payload = {}) {
  const isVisible = (element) => {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
  };

  const overlayElement = payload.overlayHiddenSelector
    ? document.querySelector(payload.overlayHiddenSelector)
    : null;

  return {
    url: location.href,
    title: document.title,
    overlayHidden: payload.overlayHiddenSelector
      ? !overlayElement || !isVisible(overlayElement)
      : true
  };
}

function injectedAdvancePostChallengePage(payload = {}) {
  const normalizeText = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const getElementText = (element) => normalizeText(
    element?.innerText
    || element?.textContent
    || element?.value
    || element?.getAttribute?.('aria-label')
    || element?.getAttribute?.('value')
    || ''
  );
  const isVisible = (element) => {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
  };
  const queryFirstVisible = (selectorList) => {
    for (const selector of (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const elements = Array.from(document.querySelectorAll(selector));
      const visibleMatch = elements.find((element) => isVisible(element));
      if (visibleMatch) {
        return visibleMatch;
      }
    }
    return null;
  };
  const queryByText = (selectorList, text, options = {}) => {
    const normalizedNeedle = normalizeText(text).toLowerCase();
    const mode = options.match === 'includes' ? 'includes' : 'exact';
    const candidates = Array.from(document.querySelectorAll(selectorList || 'a, button, [role="button"]'));
    return candidates.find((element) => {
      if (!isVisible(element)) {
        return false;
      }

      const haystack = getElementText(element).toLowerCase();
      if (!haystack) {
        return false;
      }

      return mode === 'includes'
        ? haystack.includes(normalizedNeedle)
        : haystack === normalizedNeedle;
    }) || null;
  };
  const clickElement = (element) => {
    if (!element) {
      return false;
    }

    element.focus?.();
    for (const eventName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      element.dispatchEvent(new MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      }));
    }

    element.click?.();
    return true;
  };
  const normalizeUrl = (value) => {
    if (!value) {
      return '';
    }

    try {
      const parsed = new URL(value, location.href);
      const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
      return `${parsed.origin}${normalizedPath}${parsed.search}`;
    } catch (error) {
      return String(value).replace(/\/+$/, '');
    }
  };
  const currentUrl = normalizeUrl(location.href);
  const matchedReadyUrl = (payload.readyUrls || []).some((readyUrl) => {
    const normalizedReadyUrl = normalizeUrl(readyUrl);
    return normalizedReadyUrl && (currentUrl === normalizedReadyUrl || currentUrl.startsWith(normalizedReadyUrl));
  });

  for (const action of payload.preActions || []) {
    if (action.type !== 'click') {
      continue;
    }

    const target = action.text
      ? queryByText(action.selector || 'a, button, [role="button"]', action.text, { match: action.textMatch })
      : queryFirstVisible(action.selector || 'a, button, [role="button"]');

    if (target) {
      clickElement(target);
      break;
    }
  }

  const readyElement = queryFirstVisible(payload.readySelectors);

  return {
    url: location.href,
    ready: Boolean(matchedReadyUrl || readyElement),
    matchedReadyUrl,
    readySelectorMatched: Boolean(readyElement)
  };
}

function injectedScrapePage(payload) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const normalizeText = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const getElementText = (element) => normalizeText(
    element?.innerText
    || element?.textContent
    || element?.value
    || element?.getAttribute?.('aria-label')
    || element?.getAttribute?.('value')
    || ''
  );
  const isVisible = (element) => {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
  };

  const queryFirst = (root, selectorList) => {
    for (const selector of (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const element = root.querySelector(selector);
      if (element) {
        return element;
      }
    }
    return null;
  };
  const queryFirstVisible = (root, selectorList) => {
    for (const selector of (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const elements = Array.from(root.querySelectorAll(selector));
      const visibleMatch = elements.find((element) => isVisible(element));
      if (visibleMatch) {
        return visibleMatch;
      }
    }
    return null;
  };
  const queryByText = (root, selectorList, text, options = {}) => {
    const normalizedNeedle = normalizeText(text).toLowerCase();
    const candidates = Array.from(root.querySelectorAll(selectorList || 'a, button, [role="button"]'));
    const matchMode = options.match === 'includes' ? 'includes' : 'exact';
    return candidates.find((element) => {
      if (options.visible !== false && !isVisible(element)) {
        return false;
      }

      const haystack = getElementText(element).toLowerCase();
      if (!haystack) {
        return false;
      }

      return matchMode === 'includes'
        ? haystack.includes(normalizedNeedle)
        : haystack === normalizedNeedle;
    }) || null;
  };

  const queryText = (root, selectorList) => normalizeText(queryFirst(root, selectorList)?.textContent || '');

  const queryAll = (root, selector) => Array.from(root.querySelectorAll(selector || '*'));
  const clickElement = (element) => {
    if (!element) {
      return false;
    }

    element.focus?.();
    for (const eventName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      element.dispatchEvent(new MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      }));
    }
    return true;
  };

  const parseCurrency = (rawValue) => {
    const normalized = normalizeText(rawValue).replace(/,/g, '');
    if (!normalized) {
      return null;
    }

    const match = normalized.match(/\$?([0-9]+(?:\.[0-9]{1,2})?)/);
    const isNegative = normalized.includes('-') || normalized.includes('(') || /\bCR\b/i.test(normalized);
    return match ? Number(match[1]) * (isNegative ? -1 : 1) : null;
  };

  const formatCurrency = (numberValue) => {
    if (typeof numberValue !== 'number' || Number.isNaN(numberValue)) {
      return null;
    }

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(numberValue);
  };

  const matchesText = (element, requiredStrings = []) => {
    const haystack = normalizeText(element.textContent).toLowerCase();
    return requiredStrings.every((value) => haystack.includes(String(value).toLowerCase()));
  };

  const waitForSelector = async (selector, timeoutMs = 15000, options = {}) => {
    if (!selector) {
      return true;
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const element = document.querySelector(selector);
      if (element && (!options.visible || isVisible(element))) {
        return true;
      }
      await sleep(250);
    }
    return false;
  };
  const waitForSelectorGone = async (selector, timeoutMs = 15000) => {
    if (!selector) {
      return true;
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const element = document.querySelector(selector);
      if (!element || !isVisible(element)) {
        return true;
      }
      await sleep(250);
    }
    return false;
  };
  const runPreActions = async (actions = []) => {
    for (const action of actions) {
      if (action.type !== 'click') {
        continue;
      }

      const selector = action.selector || 'a, button, [role="button"]';
      const target = action.text
        ? queryByText(document, selector, action.text, {
          match: action.textMatch,
          visible: action.visible
        })
        : (action.visible === false ? queryFirst(document, selector) : queryFirstVisible(document, selector));

      if (!target) {
        continue;
      }

      clickElement(target);

      if (action.waitFor) {
        await waitForSelector(action.waitFor, action.timeoutMs || 10000, {
          visible: action.waitForVisible === true
        });
      }

      if (action.waitForGone) {
        await waitForSelectorGone(action.waitForGone, action.timeoutMs || 10000);
      }

      await sleep(action.waitMs || 500);
    }
  };

  const parseDate = (rawValue) => {
    const normalized = normalizeText(rawValue);
    if (!normalized) {
      return null;
    }

    const parsedValue = Date.parse(normalized);
    if (!Number.isNaN(parsedValue)) {
      return new Date(parsedValue);
    }

    const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!slashMatch) {
      return null;
    }

    return new Date(Number(slashMatch[3]), Number(slashMatch[1]) - 1, Number(slashMatch[2]));
  };

  const inCurrentMonth = (dateValue) => {
    if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
      return false;
    }

    const currentDate = new Date();
    return dateValue.getFullYear() === currentDate.getFullYear()
      && dateValue.getMonth() === currentDate.getMonth();
  };

  const normalizeCategoryKey = (value) => normalizeText(value)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const CHASE_CATEGORY_LABELS = {
    automotive: 'Automotive',
    'bills and utilities': 'Bills & Utilities',
    education: 'Education',
    entertainment: 'Entertainment',
    'fees and adjustments': 'Fees & Adjustments',
    'food and drink': 'Food & Drink',
    gas: 'Gas',
    'gifts and donations': 'Gifts & Donations',
    groceries: 'Groceries',
    'health and wellness': 'Health & Wellness',
    home: 'Home',
    miscellaneous: 'Miscellaneous',
    personal: 'Personal',
    'professional services': 'Professional Services',
    shopping: 'Shopping',
    travel: 'Travel'
  };

  const inferChaseCategory = (description) => {
    const haystack = normalizeText(description).toLowerCase();
    const inferredCategory = [
      { label: 'Groceries', tokens: ['grocery', 'whole foods', 'trader joe', 'costco', 'instacart'] },
      { label: 'Food & Drink', tokens: ['restaurant', 'coffee', 'cafe', 'pizza', 'doordash', 'ubereats'] },
      { label: 'Entertainment', tokens: ['netflix', 'spotify', 'hulu', 'movie', 'ticketmaster', 'suno', 'apple digital services'] },
      { label: 'Travel', tokens: ['airlines', 'hotel', 'uber', 'lyft', 'delta', 'southwest', 'marriott'] },
      { label: 'Shopping', tokens: ['amazon', 'target', 'apple', 'best buy', 'shop'] },
      { label: 'Gas', tokens: ['shell', 'chevron', 'exxon', 'gas', 'fuel'] },
      { label: 'Bills & Utilities', tokens: ['electric', 'water', 'utility', 'internet', 'cell', 'verizon', 'at&t'] },
      { label: 'Home', tokens: ['home depot', 'ikea', 'lowes'] },
      { label: 'Health & Wellness', tokens: ['pharmacy', 'cvs', 'walgreens', 'doctor', 'medical'] }
    ].find((candidate) => candidate.tokens.some((token) => haystack.includes(token)));

    return inferredCategory?.label || 'Miscellaneous';
  };

  const shouldSkipChaseTransaction = (description, amountValue, category) => {
    if (typeof amountValue !== 'number' || Number.isNaN(amountValue) || amountValue <= 0) {
      return true;
    }

    const haystack = normalizeText(`${description} ${category}`).toLowerCase();
    return [
      'payment thank you',
      'automatic payment',
      'autopay',
      'online payment',
      'payment received',
      'returned payment',
      'credit balance refund'
    ].some((token) => haystack.includes(token));
  };

  let chaseTransactionSummaryCache = null;
  const getChaseTransactionSummary = () => {
    if (chaseTransactionSummaryCache) {
      return chaseTransactionSummaryCache;
    }

    const transactionRows = [];
    const collectRows = (tableSelector, source) => {
      const table = queryFirst(document, tableSelector);
      const rows = table ? queryAll(table, 'tbody > tr') : [];
      for (const row of rows) {
        if (!isVisible(row)) {
          continue;
        }

        const cells = Array.from(row.querySelectorAll(':scope > td'));
        const amountCell = cells.length >= 2 ? cells[cells.length - 2] : null;
        const dateText = queryText(row, ':scope > th .mds-activity-table__row-value--text, :scope > th');
        const description = queryText(
          cells[0] || row,
          '.accessible-text[data-testid="rich-text-accessible-text"], .accessible-text, .mds-activity-table__row-value--text'
        );
        const amountText = amountCell
          ? queryText(amountCell, '.mds-activity-table__row-value--text') || normalizeText(amountCell.textContent)
          : '';
        const rawCategory = source === 'posted'
          ? queryText(row, 'button[name="transactionCategory"] span, button[name="transactionCategory"]')
          : '';
        const dateValue = parseDate(dateText);
        const amountValue = parseCurrency(amountText);
        if (!inCurrentMonth(dateValue) || shouldSkipChaseTransaction(description, amountValue, rawCategory)) {
          continue;
        }

        const categoryLabel = CHASE_CATEGORY_LABELS[normalizeCategoryKey(rawCategory)] || inferChaseCategory(description);
        transactionRows.push({
          description,
          amountValue,
          categoryLabel
        });
      }
    };

    collectRows('#ACTIVITY-dataTableId-mds-diy-data-table', 'posted');
    collectRows('#PENDING-dataTableId-mds-diy-data-table', 'pending');

    const breakdownMap = new Map();
    let total = 0;
    let transactionCount = 0;
    for (const row of transactionRows) {
      total += row.amountValue;
      transactionCount += 1;
      const existing = breakdownMap.get(row.categoryLabel) || {
        category: row.categoryLabel,
        amountValue: 0,
        count: 0
      };
      existing.amountValue += row.amountValue;
      existing.count += 1;
      breakdownMap.set(row.categoryLabel, existing);
    }

    chaseTransactionSummaryCache = {
      total,
      transactionCount,
      items: Array.from(breakdownMap.values())
        .sort((left, right) => right.amountValue - left.amountValue)
        .map((item) => ({
          category: item.category,
          amount: formatCurrency(item.amountValue),
          detail: `Chase • ${item.count} ${item.count === 1 ? 'transaction' : 'transactions'}`,
          amountValue: item.amountValue
        }))
    };

    return chaseTransactionSummaryCache;
  };

  const buildMeta = (row, metaConfig = {}) => {
    const meta = {};
    for (const [key, selector] of Object.entries(metaConfig)) {
      meta[key] = queryText(row, selector);
    }
    return meta;
  };

  return (async () => {
    await runPreActions(payload.preActions || []);

    if (payload.waitFor?.selector) {
      const found = await waitForSelector(payload.waitFor.selector, payload.waitFor.timeoutMs || 15000, {
        visible: payload.waitFor.visible === true
      });
      if (!found) {
        return {
          ok: false,
          pageTitle: document.title,
          error: `Timed out waiting for selector: ${payload.waitFor.selector}`
        };
      }
    }

    if (payload.waitFor?.settleMs) {
      await sleep(payload.waitFor.settleMs);
    }

    const values = {};

    for (const extractor of payload.extractors) {
      try {
        if (extractor.kind === 'text') {
          const text = queryText(document, extractor.selector);
          values[extractor.id] = {
            type: 'text',
            label: extractor.label,
            text
          };
          continue;
        }

        if (extractor.kind === 'attribute') {
          const element = queryFirst(document, extractor.selector);
          values[extractor.id] = {
            type: 'text',
            label: extractor.label,
            text: element ? normalizeText(element.getAttribute(extractor.attribute) || '') : ''
          };
          continue;
        }

        if (extractor.kind === 'itemValue') {
          const item = queryFirst(document, extractor.itemSelector);
          const valueText = item ? queryText(item, extractor.valueSelector) : '';
          values[extractor.id] = {
            type: 'currency',
            label: extractor.label,
            valueText,
            valueNumber: parseCurrency(valueText),
            meta: item ? buildMeta(item, extractor.meta) : {}
          };
          continue;
        }

        if (extractor.kind === 'labeledCardValue') {
          const candidates = queryAll(document, extractor.itemSelector);
          const item = extractor.labelMatch
            ? candidates.find((candidate) => {
              const labelText = queryText(candidate, extractor.labelSelector);
              return labelText.toLowerCase() === String(extractor.labelMatch).toLowerCase();
            })
            : candidates[0];
          const valueText = item ? queryText(item, extractor.valueSelector) : '';
          values[extractor.id] = {
            type: 'currency',
            label: item ? queryText(item, extractor.labelSelector) || extractor.labelFallback || extractor.label : extractor.labelFallback || extractor.label,
            valueText,
            valueNumber: parseCurrency(valueText)
          };
          continue;
        }

        if (extractor.kind === 'listItemByTextValue') {
          const root = extractor.rootSelector ? queryFirst(document, extractor.rootSelector) : document;
          const candidates = root ? queryAll(root, extractor.itemSelector) : [];
          const item = candidates.find((candidate) => matchesText(candidate, extractor.textIncludes || []));
          const valueText = item ? queryText(item, extractor.valueSelector) : '';
          values[extractor.id] = {
            type: 'currency',
            label: extractor.label,
            valueText,
            valueNumber: parseCurrency(valueText),
            meta: {
              title: item ? queryText(item, extractor.titleSelector) : ''
            }
          };
          continue;
        }

        if (extractor.kind === 'tableRowValue') {
          const table = queryFirst(document, extractor.tableSelector);
          const rows = table ? queryAll(table, extractor.rowSelector || 'tbody tr') : [];
          const row = rows.find((candidate) => matchesText(candidate, extractor.rowMatch?.textIncludes || []));
          const valueText = row ? queryText(row, extractor.valueSelector) : '';
          values[extractor.id] = {
            type: 'currency',
            label: extractor.label,
            valueText,
            valueNumber: parseCurrency(valueText),
            meta: row ? buildMeta(row, extractor.meta) : {}
          };
          continue;
        }

        if (extractor.kind === 'tableRowsList') {
          const table = queryFirst(document, extractor.tableSelector);
          const rows = table ? queryAll(table, extractor.rowSelector || 'tbody tr') : [];
          const matchedRows = rows.filter((candidate) => matchesText(candidate, extractor.rowMatch?.textIncludes || []));
          const items = matchedRows.map((row) => {
            const item = {};
            for (const [key, selector] of Object.entries(extractor.fields || {})) {
              item[key] = queryText(row, selector);
            }
            return item;
          });
          values[extractor.id] = {
            type: 'list',
            label: extractor.label,
            items
          };
          continue;
        }

        if (extractor.kind === 'tableRowsSum') {
          const table = queryFirst(document, extractor.tableSelector);
          const rows = table ? queryAll(table, extractor.rowSelector || 'tbody tr') : [];
          const matchedRows = rows.filter((candidate) => matchesText(candidate, extractor.rowMatch?.textIncludes || []));
          const numbers = matchedRows
            .map((row) => parseCurrency(queryText(row, extractor.valueSelector)))
            .filter((value) => typeof value === 'number' && !Number.isNaN(value));
          const valueNumber = numbers.reduce((sum, value) => sum + value, 0);
          values[extractor.id] = {
            type: 'currency',
            label: extractor.label,
            valueText: formatCurrency(valueNumber),
            valueNumber,
            meta: {
              itemCount: matchedRows.length
            }
          };
          continue;
        }

        if (extractor.kind === 'cardList') {
          const items = queryAll(document, extractor.itemSelector)
            .map((card) => {
              const item = {};
              for (const [key, selector] of Object.entries(extractor.fields || {})) {
                item[key] = queryText(card, selector);
              }
              return item;
            })
            .filter((item) => Object.values(item).some(Boolean));

          values[extractor.id] = {
            type: 'list',
            label: extractor.label,
            items
          };
          continue;
        }

        if (extractor.kind === 'chaseTransactionsMonthlyTotal') {
          const summary = getChaseTransactionSummary();
          values[extractor.id] = {
            type: 'currency',
            label: extractor.label,
            valueText: formatCurrency(summary.total),
            valueNumber: summary.total,
            meta: {
              itemCount: summary.transactionCount
            }
          };
          continue;
        }

        if (extractor.kind === 'chaseTransactionsMonthlyBreakdown') {
          const summary = getChaseTransactionSummary();
          values[extractor.id] = {
            type: 'list',
            label: extractor.label,
            items: summary.items.map(({ amountValue, ...item }) => item)
          };
          continue;
        }

        values[extractor.id] = {
          type: 'error',
          label: extractor.label,
          error: `Unsupported extractor kind: ${extractor.kind}`
        };
      } catch (error) {
        values[extractor.id] = {
          type: 'error',
          label: extractor.label,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    return {
      ok: true,
      pageTitle: document.title,
      values
    };
  })();
}

export async function runModule(module, moduleState, options = {}) {
  if (!moduleState?.enabled) {
    return {
      ok: false,
      moduleId: module.id,
      displayName: module.displayName,
      lastRunAt: new Date().toISOString(),
      error: 'Module is disabled in options.'
    };
  }

  const username = moduleState.credentials?.username || '';
  const password = moduleState.credentials?.password || '';
  const requiresUsername = module.login?.usernameOptional !== true;
  if ((requiresUsername && !username) || !password) {
    return {
      ok: false,
      moduleId: module.id,
      displayName: module.displayName,
      lastRunAt: new Date().toISOString(),
      error: requiresUsername
        ? 'Missing username or password in options.'
        : 'Missing password in options.'
    };
  }

  let tab;
  const pageRuns = [];
  const mergedValues = {};
  const startedAt = new Date().toISOString();
  const preserveTabOnFailure = options.preserveTabOnFailure === true;
  let finalResult = null;
  let authPreviousActiveTabId = null;
  let authWindowId = null;
  let authTabShouldStayActive = Boolean(module.login?.keepActiveUntilReady);
  const runInteraction = async (work, pageId = null) => {
    const durationMs = module.foregroundInteractionDurationMs || 250;
    const foregroundPages = Array.isArray(module.foregroundInteractionPageIds)
      ? module.foregroundInteractionPageIds
      : null;
    const shouldForeground = Boolean(module.foregroundInteractions)
      && (!foregroundPages || (pageId && foregroundPages.includes(pageId)));

    if (!shouldForeground || !tab?.id || !tab?.windowId) {
      return work();
    }

    return temporarilyActivateTab(tab.id, tab.windowId, work, durationMs);
  };

  try {
    if (module.closeTabsBeforeRun?.length) {
      await closeTabsMatching(module.closeTabsBeforeRun);
    }

    if (authTabShouldStayActive) {
      const [previousActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      authPreviousActiveTabId = previousActiveTab?.id || null;
      authWindowId = previousActiveTab?.windowId || null;
    }

    tab = await chrome.tabs.create({
      url: module.login?.startUrl || module.pages[0]?.url,
      active: authTabShouldStayActive
    });

    authWindowId = tab.windowId || authWindowId;

    await waitForTabComplete(tab.id);

    const restoreAuthTabFocus = async () => {
      if (!authTabShouldStayActive || !authPreviousActiveTabId || !authWindowId || authPreviousActiveTabId === tab.id) {
        authTabShouldStayActive = false;
        return;
      }

      try {
        const [activeTab] = await chrome.tabs.query({ active: true, windowId: authWindowId });
        if (activeTab?.id === tab.id) {
          await chrome.tabs.update(authPreviousActiveTabId, { active: true });
        }
      } catch (error) {
        console.warn('Could not restore previously active tab after auth flow.', error);
      } finally {
        authTabShouldStayActive = false;
      }
    };

    const isChallengeComplete = (documentState, completionConfig = {}) => {
      if (!completionConfig || !Object.keys(completionConfig).length) {
        return true;
      }

      if (completionConfig.overlayHiddenSelector) {
        return documentState?.overlayHidden === true;
      }

      return false;
    };

    const waitForManualChallengeCompletion = async (challengeConfig) => {
      const completionTimeoutMs = challengeConfig.completionTimeoutMs || 120000;
      const startedAtMs = Date.now();
      while (Date.now() - startedAtMs < completionTimeoutMs) {
        const currentTab = await chrome.tabs.get(tab.id);
        const loadError = getTabLoadError(currentTab);
        if (loadError) {
          throw new Error(loadError);
        }

        const documentState = await executeInTab(tab.id, injectedCheckDocumentState, [challengeConfig.completion || {}]);
        if (isChallengeComplete(documentState, challengeConfig.completion)) {
          return documentState;
        }

        await sleep(300);
      }

      throw new Error(`${module.displayName} verification timed out while waiting for the code entry step to finish.`);
    };

    const waitForPostChallengeReady = async (challengeConfig) => {
      const readyConfig = challengeConfig.postCompletionReady;
      if (!readyConfig) {
        return null;
      }

      const readyTimeoutMs = readyConfig.timeoutMs || 30000;
      const startedAtMs = Date.now();
      while (Date.now() - startedAtMs < readyTimeoutMs) {
        const currentTab = await chrome.tabs.get(tab.id);
        const loadError = getTabLoadError(currentTab);
        if (loadError) {
          throw new Error(loadError);
        }

        const readyState = await executeInTab(tab.id, injectedAdvancePostChallengePage, [readyConfig]);
        if (readyState?.ready) {
          if (readyConfig.settleMs) {
            await sleep(readyConfig.settleMs);
          }
          return readyState;
        }

        await sleep(readyConfig.pollMs || 300);
      }

      throw new Error(`${module.displayName} did not reach the post-verification dashboard state in time.`);
    };

    const runManualChallenge = async (challengeConfig, pageId = 'verification', pageLabel = 'Verification') => {
      const currentTab = await chrome.tabs.get(tab.id);
      const priorState = await executeInTab(tab.id, injectedCheckDocumentState, [challengeConfig.completion || {}]);
      if (isChallengeComplete(priorState, challengeConfig.completion)) {
        return priorState;
      }

      const waitForChallengeUi = async () => {
        const renderTimeoutMs = challengeConfig.renderTimeoutMs || Math.min(challengeConfig.timeoutMs || 15000, 12000);
        const startedAtMs = Date.now();
        while (Date.now() - startedAtMs < renderTimeoutMs) {
          const renderChecks = await executeInTab(tab.id, injectedDetectManualChallengeUi, [challengeConfig], {
            allFrames: challengeConfig.allFrames === true
          });
          const normalizedChecks = Array.isArray(renderChecks) ? renderChecks : [renderChecks];
          if (normalizedChecks.some((result) => result?.found)) {
            return true;
          }
          await sleep(challengeConfig.renderPollMs || 250);
        }
        return false;
      };

      const waitForManualCodeEntry = async () => {
        const timeoutMs = challengeConfig.codeEntryTimeoutMs || challengeConfig.completionTimeoutMs || 120000;
        const startedAtMs = Date.now();
        while (Date.now() - startedAtMs < timeoutMs) {
          const currentTabState = await chrome.tabs.get(tab.id);
          const loadError = getTabLoadError(currentTabState);
          if (loadError) {
            throw new Error(loadError);
          }

          const codeChecks = await executeInTab(tab.id, injectedCheckManualCodeEntry, [challengeConfig], {
            allFrames: challengeConfig.allFrames === true
          });
          const normalizedChecks = Array.isArray(codeChecks) ? codeChecks : [codeChecks];
          if (normalizedChecks.some((result) => result?.allFilled)) {
            return true;
          }

          const documentState = await executeInTab(tab.id, injectedCheckDocumentState, [challengeConfig.completion || {}]);
          if (isChallengeComplete(documentState, challengeConfig.completion)) {
            return false;
          }

          await sleep(challengeConfig.codeEntryPollMs || 250);
        }

        throw new Error(`${module.displayName} verification timed out while waiting for the code to be entered.`);
      };

      const warmAndWaitForChallengeUi = async () => {
        const attempts = Math.max(1, challengeConfig.renderWarmupAttempts || 1);
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (challengeConfig.preRenderActivationMs && currentTab.windowId) {
            await brieflyActivateTab(tab.id, currentTab.windowId, challengeConfig.preRenderActivationMs);
            if (challengeConfig.postPreRenderActivationWaitMs) {
              await sleep(challengeConfig.postPreRenderActivationWaitMs);
            }
          }

          const ready = await waitForChallengeUi();
          if (ready) {
            return true;
          }
        }

        return false;
      };

      await warmAndWaitForChallengeUi();

      let nativePreparationResult = null;
      try {
        nativePreparationResult = await runNativeManualChallengePreparation(tab, challengeConfig);
        if (nativePreparationResult?.ok && challengeConfig.nativePrepare?.postPrepareWaitMs) {
          await sleep(challengeConfig.nativePrepare.postPrepareWaitMs);
        }
      } catch (error) {
        console.warn('Trusted verification preparation failed, falling back to DOM helper.', error);
      }

      let challengeResult;
      if (
        nativePreparationResult?.ok
        && nativePreparationResult?.prepared
        && nativePreparationResult?.stage === 'code'
        && challengeConfig.preferNativePreparation === true
      ) {
        challengeResult = {
          ok: true,
          prepared: true,
          awaitingUser: true,
          message: nativePreparationResult.message || 'Verification code entry is ready.'
        };
      } else {
        const assistResults = await withTimeout(
          executeInTab(tab.id, injectedAssistManualChallenge, [{
            ...challengeConfig,
            password
          }], { allFrames: challengeConfig.allFrames === true }),
          challengeConfig.timeoutMs || 15000,
          `${module.displayName} ${pageLabel.toLowerCase()}`
        );

        challengeResult = chooseChallengeResult(assistResults);
      }

      pageRuns.push({
        pageId,
        pageLabel,
        ...challengeResult
      });

      const refreshedState = await executeInTab(tab.id, injectedCheckDocumentState, [challengeConfig.completion || {}]);
      if (isChallengeComplete(refreshedState, challengeConfig.completion)) {
        return refreshedState;
      }

      if (!challengeResult.awaitingUser) {
        throw new Error(challengeResult.message || `${module.displayName} verification step could not be prepared.`);
      }

      let previousActiveTabId = null;
      if (challengeConfig.activationRequired && currentTab.windowId) {
        const [previousActiveTab] = await chrome.tabs.query({ active: true, windowId: currentTab.windowId });
        previousActiveTabId = previousActiveTab?.id || null;
        await chrome.tabs.update(tab.id, { active: true });
      }

      try {
        if (challengeConfig.nativeSubmitAfterCode?.enabled) {
          const shouldSubmit = await waitForManualCodeEntry();
          if (shouldSubmit) {
            await executeInTab(tab.id, injectedPrepareManualCodeSubmit, [challengeConfig], {
              allFrames: challengeConfig.allFrames === true
            });

            if (challengeConfig.nativeSubmitAfterCode.blurSettleMs) {
              await sleep(challengeConfig.nativeSubmitAfterCode.blurSettleMs);
            }

            const submitResult = await runNativeManualChallengeSubmit(tab, challengeConfig);
            if (!submitResult?.ok) {
              throw new Error(submitResult?.message || `${module.displayName} could not submit the verification code.`);
            }
          }
        }

        const completionState = await waitForManualChallengeCompletion(challengeConfig);
        if (challengeConfig.postCompletionWaitMs) {
          await sleep(challengeConfig.postCompletionWaitMs);
        }
        if (challengeConfig.postCompletionReady) {
          await waitForPostChallengeReady(challengeConfig);
        }
        await restoreAuthTabFocus();
        return completionState;
      } finally {
        if (previousActiveTabId && previousActiveTabId !== tab.id) {
          try {
            const [activeTab] = await chrome.tabs.query({ active: true, windowId: currentTab.windowId });
            if (activeTab?.id === tab.id) {
              await chrome.tabs.update(previousActiveTabId, { active: true });
            }
          } catch (error) {
            console.warn('Could not restore previously active tab after verification.', error);
          }
        }
      }
    };

    const expectedPageUrls = module.pages.map((page) => page.url).filter(Boolean);
    const runLoginAttempt = async (loginConfig, pageId = 'login', pageLabel = 'Login') => {
      const runConfiguredLogin = async () => {
        if (loginConfig.nativeLoginFlow?.enabled) {
          return runNativeLoginFlow(tab, loginConfig, username, password);
        }

        return runInteraction(() => executeInTab(tab.id, injectedLogin, [{
          login: loginConfig,
          username,
          password
        }], { allFrames: loginConfig?.allFrames === true }), pageId);
      };

      const loginPromise = withTimeout(
        runConfiguredLogin(),
        loginConfig.executionTimeoutMs || 12000,
        `${module.displayName} ${pageLabel.toLowerCase()}`
      ).catch((error) => [{
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }]);
      const shouldRaceExpectedPage = !loginConfig.skipExpectedPageRace && expectedPageUrls.length;
      const racedLoginResult = shouldRaceExpectedPage
        ? await Promise.race([
          loginPromise.then((results) => ({
            kind: 'loginResults',
            loginResult: chooseLoginResult(results)
          })),
          waitForTabUrlMatch(
            tab.id,
            expectedPageUrls,
            loginConfig.navigationTimeoutMs || 5000
          ).then((matchedTab) => matchedTab ? {
            kind: 'pageReached',
            loginResult: {
              ok: true,
              foundForm: true,
              message: `Reached expected page after login: ${matchedTab.url}`
            }
          } : null)
        ])
        : null;

      let loginResult = racedLoginResult?.loginResult || chooseLoginResult(await loginPromise);
      const shouldTryNativeSubmitFallback = !loginResult.ok
        && Boolean(loginConfig.nativeSubmitFallback?.enabled)
        && (
          loginResult.foundForm
          || /submit|advance|sign in|login/i.test(loginResult.message || '')
        );

      if (shouldTryNativeSubmitFallback) {
        const nativeSubmitResult = await runNativeLoginSubmitFallback(tab, loginConfig);
        if (nativeSubmitResult?.ok) {
          loginResult = nativeSubmitResult;
        } else if (nativeSubmitResult?.message) {
          loginResult = {
            ...loginResult,
            message: `${loginResult.message} ${nativeSubmitResult.message}`.trim()
          };
        }
      }

      pageRuns.push({
        pageId,
        pageLabel,
        ...loginResult
      });

      if (racedLoginResult?.kind !== 'pageReached') {
        await sleep(loginConfig.postSubmitWaitMs || 3500);
      }

      return loginResult;
    };

    if (module.login) {
      await runLoginAttempt(module.login, 'login', 'Login');

      for (const [index, followupLogin] of (module.login.followupAttempts || []).entries()) {
        const currentTab = await chrome.tabs.get(tab.id);
        if (!urlMatchesAnyTarget(currentTab.url, followupLogin.matchUrls || [])) {
          continue;
        }

        await runLoginAttempt(
          {
            ...module.login,
            ...followupLogin,
            preActions: followupLogin.preActions || []
          },
          followupLogin.pageId || `loginFollowup${index + 1}`,
          followupLogin.pageLabel || `Login Follow-up ${index + 1}`
        );
      }
    }

    if (module.login?.manualChallenge) {
      await runManualChallenge(module.login.manualChallenge);
    }

    if (authTabShouldStayActive) {
      await restoreAuthTabFocus();
    }

    for (const page of module.pages) {
      const enabledExtractors = page.extractors.filter((extractor) => moduleState.extractorConfig?.[extractor.id]?.enabled !== false);
      if (!enabledExtractors.length) {
        continue;
      }

      await ensurePageUrl(tab.id, page.url);
      await warmPageIfNeeded(tab, page);

      const pageTimeoutMs = page.executionTimeoutMs
        || ((page.nativeScrape?.timeoutMs || page.waitFor?.timeoutMs || 15000) + 5000);

      const scrapeResult = await withTimeout(runInteraction(async () => {
        if (page.nativeScrape?.enabled) {
          return scrapePageNatively(tab.id, page, enabledExtractors);
        }

        return executeInTab(tab.id, injectedScrapePage, [{
          preActions: page.preActions || [],
          waitFor: page.waitFor,
          extractors: enabledExtractors
        }]);
      }, page.id), pageTimeoutMs, `${module.displayName} ${page.label}`);

      pageRuns.push({
        pageId: page.id,
        pageLabel: page.label,
        ...scrapeResult
      });

      if (scrapeResult?.values) {
        Object.assign(mergedValues, scrapeResult.values);
      }
    }

    const scrapePageIds = new Set(module.pages.map((page) => page.id));
    const ok = pageRuns.some((run) => scrapePageIds.has(run.pageId) && run.ok);

    finalResult = {
      ok,
      moduleId: module.id,
      displayName: module.displayName,
      startedAt,
      lastRunAt: new Date().toISOString(),
      pages: pageRuns,
      values: mergedValues
    };
    return finalResult;
  } catch (error) {
    finalResult = {
      ok: false,
      moduleId: module.id,
      displayName: module.displayName,
      startedAt,
      lastRunAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      pages: pageRuns,
      values: mergedValues
    };
    return finalResult;
  } finally {
    const keepTabOpen = preserveTabOnFailure && tab?.id && finalResult?.ok === false;
    if (keepTabOpen) {
      finalResult.debugTabKeptOpen = true;
      finalResult.debugTabId = tab.id;
    } else if (tab?.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (error) {
        console.warn('Could not close runner tab', error);
      }
    }
  }
}
