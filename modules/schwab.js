export default {
  id: 'schwab',
  displayName: 'Schwab',
  requiresDebugger: true,
  login: {
    startUrl: 'https://sws-gateway-nr.schwab.com/ui/host/?clientid=schwab-secondary&redirecturi=https%3A%2F%2Fclient.schwab.com%2FAreas%2FAccess%2FSignOn%2FAuth&returnurl=%2Fapp%2Faccounts%2Fsummary%2F',
    allFrames: true,
    timeoutMs: 5000,
    nativeLoginFlow: {
      enabled: true,
      activateTab: true,
      activationSettleMs: 250,
      initialStateTimeoutMs: 12000,
      passwordStepTimeoutMs: 6000,
      focusSettleMs: 120,
      selectionSettleMs: 60,
      typingSettleMs: 220,
      postActionWaitMs: 300,
      progressTimeoutMs: 4000,
      focusPasswordBeforeEnter: true,
      methods: ['nativeClick', 'nativeEnter', 'nativeClick'],
      usernameSelectors: '#loginIdInput, input[name=\"loginId\"], input[autocomplete=\"username\"]',
      passwordSelectors: '#passwordInput, input[name=\"password\"], input[autocomplete=\"current-password\"], input[type=\"password\"]',
      submitSelectors: '#btnLogin, button[type=\"submit\"]',
      progressSelectors: '#totalValue sdps-number, #totalValue .sdps-display-value__value, #total-value-label'
    },
    nativeSubmitFallback: {
      enabled: true,
      allFrames: true,
      activateTab: true,
      activationSettleMs: 250,
      postActionWaitMs: 300,
      progressTimeoutMs: 4000,
      focusPasswordBeforeEnter: true,
      methods: ['nativeClick', 'nativeEnter', 'nativeClick'],
      submitSelectors: '#btnLogin, button[type=\"submit\"]',
      passwordSelectors: '#passwordInput, input[name=\"password\"], input[type=\"password\"]'
    },
    selectors: {
      username: '#loginIdInput',
      password: '#passwordInput',
      submit: '#btnLogin'
    },
    submitProgressSelectors: '#totalValue sdps-number, #totalValue .sdps-display-value__value, #total-value-label',
    postSubmitWaitMs: 750
  },
  pages: [
    {
      id: 'summary',
      label: 'Summary',
      url: 'https://client.schwab.com/app/accounts/summary/',
      activateBeforeScrapeMs: 1000,
      nativeScrape: {
        enabled: true,
        pollMs: 250,
        requiredExtractorIds: ['schwabTotalValue'],
        timeoutMs: 30000
      },
      waitFor: {
        selector: '#totalValue sdps-number, #totalValue .sdps-display-value__value, #litetotalValue sdps-number, #litetotalValue .sdps-display-value__value, [sdps-id="totalValue"] sdps-number, [sdps-id="totalValue"] .sdps-display-value__value, #total-value-label, #totalvalue-total-value-label',
        timeoutMs: 30000,
        settleMs: 1000
      },
      extractors: [
        {
          id: 'schwabTotalValue',
          label: 'Schwab brokerage account value',
          kind: 'itemValue',
          itemSelector: '#totalValue, #litetotalValue, [sdps-id="totalValue"]',
          valueSelector: 'sdps-number, .sdps-display-value__value, .sdps-text-headline',
          meta: {
            titleSelector: '#total-value-label, #totalvalue-total-value-label'
          }
        }
      ]
    }
  ]
};
