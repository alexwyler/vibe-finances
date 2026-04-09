function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const existing = await chrome.tabs.get(tabId);
  if (existing.status === 'complete') {
    return existing;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Timed out waiting for tab ${tabId} to finish loading.`));
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo, tab) => {
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

async function executeInTab(tabId, func, args) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });

  return result;
}

function injectedLogin(payload) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const normalizeText = (value) => (value || '').replace(/\s+/g, ' ').trim();

  const queryFirst = (selectorList) => {
    for (const selector of (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }
    return null;
  };

  const waitForSelector = async (selectorList, timeoutMs = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const element = queryFirst(selectorList);
      if (element) {
        return element;
      }
      await sleep(250);
    }
    return null;
  };

  const setNativeValue = (element, value) => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const { login, username, password } = payload;

  return (async () => {
    const usernameInput = await waitForSelector(login.selectors.username, login.timeoutMs || 15000);
    const passwordInput = await waitForSelector(login.selectors.password, login.timeoutMs || 15000);

    if (!usernameInput || !passwordInput) {
      return {
        ok: false,
        message: 'Login form not found. The site may already be logged in, may require a different flow, or may have changed.'
      };
    }

    usernameInput.focus();
    setNativeValue(usernameInput, username || '');
    await sleep(150);
    passwordInput.focus();
    setNativeValue(passwordInput, password || '');
    await sleep(150);

    const submitButton = queryFirst(login.selectors.submit);
    if (submitButton) {
      submitButton.click();
      return {
        ok: true,
        message: `Submitted login form using ${normalizeText(login.selectors.submit)}.`
      };
    }

    const form = usernameInput.closest('form') || passwordInput.closest('form');
    if (form) {
      form.requestSubmit();
      return {
        ok: true,
        message: 'Submitted login form using requestSubmit().'
      };
    }

    return {
      ok: false,
      message: 'Could not find a submit control for the login form.'
    };
  })();
}

function injectedScrapePage(payload) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const normalizeText = (value) => (value || '').replace(/\s+/g, ' ').trim();

  const queryFirst = (root, selectorList) => {
    for (const selector of (selectorList || '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const element = root.querySelector(selector);
      if (element) {
        return element;
      }
    }
    return null;
  };

  const queryText = (root, selectorList) => normalizeText(queryFirst(root, selectorList)?.textContent || '');

  const queryAll = (root, selector) => Array.from(root.querySelectorAll(selector || '*'));

  const parseCurrency = (rawValue) => {
    const normalized = normalizeText(rawValue).replace(/,/g, '');
    const match = normalized.match(/-?\$?([0-9]+(?:\.[0-9]{1,2})?)/);
    return match ? Number(match[1]) * (normalized.includes('-') ? -1 : 1) : null;
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

  const waitForSelector = async (selector, timeoutMs = 15000) => {
    if (!selector) {
      return true;
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (document.querySelector(selector)) {
        return true;
      }
      await sleep(250);
    }
    return false;
  };

  const buildMeta = (row, metaConfig = {}) => {
    const meta = {};
    for (const [key, selector] of Object.entries(metaConfig)) {
      meta[key] = queryText(row, selector);
    }
    return meta;
  };

  return (async () => {
    if (payload.waitFor?.selector) {
      const found = await waitForSelector(payload.waitFor.selector, payload.waitFor.timeoutMs || 15000);
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

export async function runModule(module, moduleState) {
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
  if (!username || !password) {
    return {
      ok: false,
      moduleId: module.id,
      displayName: module.displayName,
      lastRunAt: new Date().toISOString(),
      error: 'Missing username or password in options.'
    };
  }

  let tab;
  const pageRuns = [];
  const mergedValues = {};
  const startedAt = new Date().toISOString();

  try {
    tab = await chrome.tabs.create({
      url: module.login?.startUrl || module.pages[0]?.url,
      active: false
    });

    await waitForTabComplete(tab.id);

    if (module.login) {
      const loginResult = await executeInTab(tab.id, injectedLogin, [{
        login: module.login,
        username,
        password
      }]);
      pageRuns.push({
        pageId: 'login',
        pageLabel: 'Login',
        ...loginResult
      });
      await sleep(module.login.postSubmitWaitMs || 3500);
    }

    for (const page of module.pages) {
      const enabledExtractors = page.extractors.filter((extractor) => moduleState.extractorConfig?.[extractor.id]?.enabled !== false);
      if (!enabledExtractors.length) {
        continue;
      }

      await navigateTab(tab.id, page.url);
      await sleep(page.waitFor?.settleMs || 750);

      const scrapeResult = await executeInTab(tab.id, injectedScrapePage, [{
        waitFor: page.waitFor,
        extractors: enabledExtractors
      }]);

      pageRuns.push({
        pageId: page.id,
        pageLabel: page.label,
        ...scrapeResult
      });

      if (scrapeResult?.values) {
        Object.assign(mergedValues, scrapeResult.values);
      }
    }

    const ok = pageRuns.some((run) => run.pageId !== 'login' && run.ok);

    return {
      ok,
      moduleId: module.id,
      displayName: module.displayName,
      startedAt,
      lastRunAt: new Date().toISOString(),
      pages: pageRuns,
      values: mergedValues
    };
  } catch (error) {
    return {
      ok: false,
      moduleId: module.id,
      displayName: module.displayName,
      startedAt,
      lastRunAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      pages: pageRuns,
      values: mergedValues
    };
  } finally {
    if (tab?.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (error) {
        console.warn('Could not close runner tab', error);
      }
    }
  }
}
