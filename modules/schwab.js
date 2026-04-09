export default {
  id: 'schwab',
  displayName: 'Schwab',
  login: {
    startUrl: 'https://sws-gateway-nr.schwab.com/ui/host/?clientid=schwab-secondary&redirecturi=https%3A%2F%2Fclient.schwab.com%2FAreas%2FAccess%2FSignOn%2FAuth&returnurl=%2Fapp%2Faccounts%2Fsummary%2F',
    selectors: {
      username: '#loginIdInput',
      password: '#passwordInput',
      submit: '#btnLogin'
    },
    postSubmitWaitMs: 8000
  },
  pages: [
    {
      id: 'summary',
      label: 'Summary',
      url: 'https://client.schwab.com/app/accounts/summary/',
      waitFor: {
        selector: '#totalValue, #total-value-label, sdps-display-value',
        timeoutMs: 30000,
        settleMs: 3000
      },
      extractors: [
        {
          id: 'schwabTotalValue',
          label: 'Schwab brokerage account value',
          kind: 'itemValue',
          itemSelector: '#totalValue',
          valueSelector: 'sdps-number, .sdps-display-value__value, .sdps-text-headline',
          meta: {
            titleSelector: '#total-value-label'
          }
        }
      ]
    }
  ]
};
