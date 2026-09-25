const DASHBOARD_URL = 'https://workplaceservices.fidelity.com/mybenefits/navstation/navigation#/';

export default {
  id: 'fidelity',
  displayName: 'Fidelity 401(k)',
  requiresDebugger: true,
  closeTabsBeforeRun: [
    'https://nb.fidelity.com/*',
    'https://workplaceservices.fidelity.com/*'
  ],
  login: {
    startUrl: DASHBOARD_URL,
    // A username Fidelity remembers is preselected on the login page, so it's optional here.
    usernameOptional: true,
    timeoutMs: 10000,
    executionTimeoutMs: 30000,
    skipExpectedPageRace: true,
    alreadySignedIn: {
      urls: ['https://workplaceservices.fidelity.com/mybenefits/'],
      loginUrls: ['https://nb.fidelity.com/static/mybenefits/netbenefitslogin/'],
      checkMs: 8000,
      stableMs: 3000
    },
    nativeLoginFlow: {
      enabled: true,
      activateTab: true,
      activationSettleMs: 250,
      initialStateTimeoutMs: 15000,
      focusSettleMs: 120,
      selectionSettleMs: 60,
      typingSettleMs: 220,
      postActionWaitMs: 300,
      progressTimeoutMs: 5000,
      focusPasswordBeforeEnter: true,
      methods: ['nativeClick', 'nativeEnter', 'nativeClick'],
      usernameSelectors: '#dom-username-input, input[name="dom-username-input"]',
      passwordSelectors: '#dom-pswd-input, input[name="dom-pswd-input"], input[type="password"]',
      submitSelectors: '#dom-login-button, button[type="submit"]',
      progressSelectors: 'input[autocomplete="one-time-code"], input[inputmode="numeric"]'
    },
    selectors: {
      username: '#dom-username-input',
      password: '#dom-pswd-input',
      submit: '#dom-login-button'
    },
    postSubmitWaitMs: 1500,
    // Fidelity sends a 2FA code on a separate page; the user enters it in the tab.
    awaitUserVerification: {
      readyUrls: ['https://workplaceservices.fidelity.com/mybenefits/'],
      message: 'Enter the Fidelity security code in the opened tab.',
      initialCheckMs: 8000,
      pollMs: 500,
      timeoutMs: 300000,
      settleMs: 1500
    }
  },
  pages: [
    {
      id: 'home',
      label: 'Home',
      url: DASHBOARD_URL,
      // No stable balance selectors confirmed yet; the extractor waits for the balance text itself.
      waitFor: {
        selector: 'body',
        timeoutMs: 15000,
        settleMs: 1500
      },
      executionTimeoutMs: 50000,
      extractors: [
        {
          id: 'fidelity401kBalance',
          label: 'Fidelity 401(k) balance',
          kind: 'currencyNearText',
          // 'balance' only matches the balance-history chart (whose text starts with the
          // lowest Y-axis tick, e.g. $60,000); the real total lives on the PORTFOLIO TOTAL card.
          textIncludes: ['portfolio total'],
          timeoutMs: 40000
        }
      ]
    }
  ]
};
