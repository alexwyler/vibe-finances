export default {
  id: 'northwesternMutual',
  displayName: 'Northwestern Mutual',
  closeTabsBeforeRun: [
    'https://www.northwesternmutual.com/*',
    'https://login.northwesternmutual.com/*',
    'https://plan.northwesternmutual.com/*'
  ],
  login: {
    startUrl: 'https://login.northwesternmutual.com/',
    timeoutMs: 10000,
    executionTimeoutMs: 30000,
    submitStrategy: 'clickOnly',
    submitWithEnter: true,
    submitProgressTimeoutMs: 10000,
    nativeLoginFlow: {
      enabled: false,
      activateTab: true,
      activationSettleMs: 250,
      initialStateTimeoutMs: 12000,
      focusSettleMs: 120,
      selectionSettleMs: 60,
      typingSettleMs: 220,
      postActionWaitMs: 350,
      progressTimeoutMs: 5000,
      focusPasswordBeforeEnter: true,
      methods: ['nativeClick', 'nativeEnter'],
      usernameSelectors: '#username, input[name="username"]',
      passwordSelectors: '#password, input[name="password"], input[type="password"]',
      submitSelectors: '#login, button[type="submit"]'
    },
    nativeSubmitFallback: {
      enabled: true,
      activateTab: true,
      methods: ['nativeClick', 'nativeEnter']
    },
    selectors: {
      username: '#username, input[name="username"]',
      password: '#password, input[name="password"], input[type="password"]',
      submit: '#login, button[type="submit"]'
    },
    postSubmitWaitMs: 1500
  },
  pages: [
    {
      id: 'netWorth',
      label: 'Net Worth',
      url: 'https://plan.northwesternmutual.com/net-worth',
      scrapeRetries: 2,
      waitFor: {
        selector: 'table[data-test-id="product-table-investments"] td.text-right dt, table[data-test-id="product-table-life-insurance"] td.text-right dt, table[data-test-id="product-table-bank-accounts"] td.text-right dt',
        timeoutMs: 45000,
        settleMs: 3000
      },
      extractors: [
        {
          id: 'brokerageIndividual',
          label: 'Brokerage account value',
          kind: 'tableRowValue',
          tableSelector: 'table[data-test-id="product-table-investments"]',
          rowSelector: 'tbody tr',
          // 'Alex Wyler' keeps this on the NM-owned Individual brokerage; linked external
          // accounts (e.g., Facebook Schwab) also have 'Individual' as their type.
          rowMatch: { textIncludes: ['Individual', 'Alex Wyler'] },
          valueSelector: 'td.text-right dt',
          // History from 2026-09-24 until the 2026-09-25 fix captured the linked Schwab row.
          historyInvalidBetween: ['2026-09-24T00:00:00-05:00', '2026-09-25T10:01:34-05:00']
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
      scrapeRetries: 1,
      waitFor: {
        selector: 'button[data-test-id="month-selection-money-container"] h1, [data-test-id="month-selection-spending-container"] p.luna-type-header-55',
        timeoutMs: 30000,
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
