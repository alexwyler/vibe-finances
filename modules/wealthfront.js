export default {
  id: 'wealthfront',
  displayName: 'Wealthfront',
  login: {
    startUrl: 'https://www.wealthfront.com/login',
    selectors: {
      username: '#login-username, input[name="email"]',
      password: '#login-password, input[name="password"]',
      submit: '[data-testid="pingdom-login-button"], button[type="submit"]'
    },
    postSubmitWaitMs: 5000
  },
  pages: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      url: 'https://www.wealthfront.com/dashboard',
      waitFor: {
        selector: '[data-testid="dashboard-account-balances"]',
        timeoutMs: 20000,
        settleMs: 1500
      },
      extractors: [
        {
          id: 'wealthfrontBrokerage',
          label: 'Wealthfront brokerage account value',
          kind: 'itemValue',
          itemSelector: 'button[data-testid="dashboard-account-list-account-item-My Personal Investment Account"]',
          valueSelector: '.tk-list-inner-content-right-column > div, [data-toolkit-component="Text"]',
          meta: {
            titleSelector: '[data-toolkit-component="Text"]'
          }
        },
        {
          id: 'schwabBrokerage',
          label: 'Schwab brokerage account value',
          kind: 'listItemByTextValue',
          rootSelector: '[data-testid="dashboard-account-balances"]',
          itemSelector: 'li.tk-list-item-wrapper, button',
          textIncludes: ['Schwab'],
          titleSelector: '[data-testid="external-account-title"]',
          valueSelector: '.tk-list-inner-content-right-column > div:first-child'
        }
      ]
    }
  ]
};
