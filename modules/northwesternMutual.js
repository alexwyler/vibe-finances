export default {
  id: 'northwesternMutual',
  displayName: 'Northwestern Mutual',
  login: {
    startUrl: 'https://www.northwesternmutual.com/log-in/',
    selectors: {
      username: 'input[name="username"]',
      password: 'input[name="password"]',
      submit: '#nmx-client-login-submit, button[type="submit"]'
    },
    postSubmitWaitMs: 5000
  },
  pages: [
    {
      id: 'netWorth',
      label: 'Net Worth',
      url: 'https://plan.northwesternmutual.com/net-worth',
      waitFor: {
        selector: 'table[data-test-id="product-table-investments"], table[data-test-id="product-table-life-insurance"], table[data-test-id="product-table-bank-accounts"]',
        timeoutMs: 20000,
        settleMs: 1500
      },
      extractors: [
        {
          id: 'brokerageIndividual',
          label: 'Brokerage account value',
          kind: 'tableRowValue',
          tableSelector: 'table[data-test-id="product-table-investments"]',
          rowSelector: 'tbody tr',
          rowMatch: { textIncludes: ['Individual'] },
          valueSelector: 'td.text-right dt',
          meta: {
            titleSelector: 'dt.luna-type-data-20',
            accountSelector: 'dd.luna-type-data-10'
          }
        },
        {
          id: 'adjustableComplifePolicies',
          label: 'Adjustable CompLife actual values',
          kind: 'tableRowsList',
          tableSelector: 'table[data-test-id="product-table-life-insurance"]',
          rowSelector: 'tbody tr',
          rowMatch: { textIncludes: ['ADJUSTABLE COMPLIFE'] },
          fields: {
            policy: 'dt.luna-type-data-20',
            account: 'dd.luna-type-data-10',
            value: 'td.text-right dt',
            asOf: 'td.text-right dd'
          }
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
          valueSelector: 'td.text-right dt',
          meta: {
            titleSelector: 'dt.luna-type-data-20',
            accountSelector: 'dd.luna-type-data-10'
          }
        }
      ]
    },
    {
      id: 'cashflow',
      label: 'Cash Flow',
      url: 'https://plan.northwesternmutual.com/cashflow',
      waitFor: {
        selector: '[data-test-id="spending-categories-header"], [data-test-id="high-chart-donut-chart"], #Spending-selector',
        timeoutMs: 20000,
        settleMs: 1200
      },
      extractors: [
        {
          id: 'cashflowHeading',
          label: 'Cashflow heading',
          kind: 'text',
          selector: 'h2.luna-responsive_type-header_section, h2'
        },
        {
          id: 'cashflowMode',
          label: 'Cashflow selected mode',
          kind: 'text',
          selector: '#Spending-selector input:checked + label'
        },
        {
          id: 'cashflowTotalLabel',
          label: 'Cashflow total label',
          kind: 'attribute',
          selector: '[data-test-id="high-chart-donut-chart"] svg',
          attribute: 'aria-label'
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
