export default {
  id: 'bankOfAmerica',
  displayName: 'Bank of America',
  login: {
    startUrl: 'https://secure.bankofamerica.com/login/sign-in/signOnV2Screen.go',
    selectors: {
      username: '#enterID-known-input, #onlineId1, input[name="dummy-onlineId"], input[name="onlineId1"], input[name="onlineId"]',
      hiddenUsername: '#onlineIdVal, input[name="onlineId"]',
      password: '#tlpvt-passcode-input, #passcode1, input[name="dummy-passcode"], input[name="passcode1"], input[name="passcode"]',
      hiddenPassword: '#passcodeVal, input[name="passcode"]',
      submit: '#enter-online-id-submit, #signIn, button[type="submit"], input[type="submit"]'
    },
    postSubmitWaitMs: 7000
  },
  pages: [
    {
      id: 'accountsOverview',
      label: 'Accounts Overview',
      url: 'https://secure.bankofamerica.com/myaccounts/brain/redirect.go?target=accountsoverview&request_locale=en-us&source=overview&fsd=y',
      waitFor: {
        selector: '.AccountItemLoan .AccountBalance .balanceValue, .AccountItem[data-accounttype="Liability"] .AccountBalance .balanceValue',
        timeoutMs: 20000,
        settleMs: 1500
      },
      extractors: [
        {
          id: 'bofaAutoLoan',
          label: 'Bank of America auto loan balance',
          kind: 'itemValue',
          itemSelector: '.AccountItemLoan[data-accounttype="Liability"], .AccountItem.AccountItemLoan',
          valueSelector: '.AccountBalance .balanceValue',
          netWorthMultiplier: -1,
          meta: {
            titleSelector: '.AccountName'
          }
        }
      ]
    }
  ]
};
