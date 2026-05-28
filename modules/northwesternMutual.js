export default {
  id: 'northwesternMutual',
  displayName: 'Northwestern Mutual',
  closeTabsBeforeRun: [
    'https://www.northwesternmutual.com/*',
    'https://login.northwesternmutual.com/*',
    'https://plan.northwesternmutual.com/*'
  ],
  login: {
    startUrl: 'https://www.northwesternmutual.com/',
    timeoutMs: 10000,
    preActions: [
      {
        type: 'click',
        selector: '#nmx-login-open-button, button[aria-label="Open login modal"]',
        waitFor: '#nmx-client-login-modal input[name="username"], #nmx-client-login-submit',
        waitForVisible: true,
        waitMs: 1000
      }
    ],
    submitStrategy: 'clickOnly',
    submitWithEnter: true,
    followupAttempts: [
      {
        matchUrls: ['https://login.northwesternmutual.com/login'],
        selectors: {
          username: '#username, input[name="username"]',
          password: '#password, input[name="password"]',
          submit: '#login, button[type="submit"]'
        },
        submitStrategy: 'auto',
        submitWithEnter: true,
        timeoutMs: 5000,
        postSubmitWaitMs: 2000,
        pageId: 'loginStandalone',
        pageLabel: 'Standalone Login'
      }
    ],
    selectors: {
      username: '#nmx-client-login-modal input[name="username"], input[name="username"]',
      password: '#nmx-client-login-modal input[name="password"], input[name="password"], input[type="password"]',
      submit: '#nmx-client-login-submit, #nmx-client-login-modal button[type="submit"], button[type="submit"]'
    },
    postSubmitWaitMs: 1500
  },
  pages: [
    {
      id: 'netWorth',
      label: 'Net Worth',
      url: 'https://plan.northwesternmutual.com/net-worth',
      waitFor: {
        selector: 'table[data-test-id="product-table-investments"] td.text-right dt, table[data-test-id="product-table-life-insurance"] td.text-right dt, table[data-test-id="product-table-bank-accounts"] td.text-right dt',
        timeoutMs: 20000,
        settleMs: 500
      },
      extractors: [
        {
          id: 'brokerageIndividual',
          label: 'Brokerage account value',
          kind: 'tableRowValue',
          tableSelector: 'table[data-test-id="product-table-investments"]',
          rowSelector: 'tbody tr',
          rowMatch: { textIncludes: ['Individual'] },
          valueSelector: 'td.text-right dt'
        },
        {
          id: 'adjustableComplifeTotal',
          label: 'Adjustable CompLife total actual value',
          kind: 'tableRowsSum',
          tableSelector: 'table[data-test-id="product-table-life-insurance"]',
          rowSelector: 'tbody tr',
          rowMatch: { textIncludes: ['ADJUSTABLE COMPLIFE'] },
          valueSelector: 'td.text-right dt'
        },
        {
          id: 'wellsFargoChecking',
          label: 'Wells Fargo checking account value',
          kind: 'tableRowValue',
          tableSelector: 'table[data-test-id="product-table-bank-accounts"]',
          rowSelector: 'tbody tr',
          rowMatch: { textIncludes: ['Wells Fargo', 'Checking'] },
          valueSelector: 'td.text-right dt'
        }
      ]
    },
    {
      id: 'cashflow',
      label: 'Cash Flow',
      url: 'https://plan.northwesternmutual.com/cashflow',
      waitFor: {
        selector: 'button[data-test-id="month-selection-money-container"] h1, [data-test-id="month-selection-spending-container"] p.luna-type-header-55',
        timeoutMs: 20000,
        settleMs: 500
      },
      extractors: [
        {
          id: 'cashflowIncome',
          label: 'Income',
          kind: 'labeledCardValue',
          itemSelector: 'button[data-test-id="month-selection-money-container"]',
          labelSelector: '.luna-tag--content',
          labelMatch: 'Income',
          valueSelector: 'h1'
        },
        {
          id: 'cashflowDiscretionary',
          label: 'Discretionary',
          kind: 'labeledCardValue',
          itemSelector: 'button[data-test-id="month-selection-money-container"]',
          labelSelector: '.luna-tag--content',
          labelMatch: 'Discretionary',
          valueSelector: 'h1'
        },
        {
          id: 'cashflowFixed',
          label: 'Fixed',
          kind: 'labeledCardValue',
          itemSelector: 'button[data-test-id="month-selection-money-container"]',
          labelSelector: '.luna-tag--content',
          labelMatch: 'Fixed',
          valueSelector: 'h1'
        },
        {
          id: 'cashflowNet',
          label: 'Net cash flow',
          kind: 'labeledCardValue',
          itemSelector: '[data-test-id="month-selection-spending-container"]',
          labelSelector: 'p.luna-type-header-10, p',
          valueSelector: 'p.luna-type-header-55, p',
          labelFallback: 'Net cash flow'
        },
        {
          id: 'cashflowBreakdown',
          label: 'Cashflow breakdown',
          kind: 'cardList',
          itemSelector: '[data-test-id^="card_container_"]',
          fields: {
            category: 'p.luna-responsive_type-header_sub_section, p.luna-type-spacing_reset.luna-responsive_type-header_sub_section, p.luna-type-spacing_reset:first-child',
            detail: 'p.luna-responsive_type-support_metadata, p.sc-fBWQee, p.luna-type-spacing_reset.luna-responsive_type-support_metadata',
            amount: 'p.luna-responsive_type-header_subhead_default, p.sc-bbSYpP, div:last-child > p:last-child'
          }
        }
      ]
    }
  ]
};
