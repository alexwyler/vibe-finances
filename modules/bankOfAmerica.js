export default {
  id: 'bankOfAmerica',
  displayName: 'Bank of America',
  requiresDebugger: true,
  login: {
    startUrl: 'https://secure.bankofamerica.com/login/sign-in/signOnV2Screen.go',
    timeoutMs: 7000,
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
      progressTimeoutMs: 5000,
      focusPasswordBeforeEnter: true,
      methods: ['nativeClick', 'nativeEnter', 'nativeClick'],
      usernameSelectors: '#enterID-known-input, #onlineId1, input[name="dummy-onlineId"], input[name="onlineId1"], input[name="onlineId"]',
      passwordSelectors: '#tlpvt-passcode-input, #passcode1, input[name="dummy-passcode"], input[name="passcode1"], input[name="passcode"]',
      submitSelectors: '#signIn, #enter-online-id-submit, button[type="submit"], input[type="submit"]',
      progressSelectors: '.AccountItemLoan .AccountBalance .balanceValue, .AccountItem[data-accounttype="Liability"] .AccountBalance .balanceValue'
    },
    nativeSubmitFallback: {
      enabled: true,
      allFrames: true,
      activateTab: true,
      activationSettleMs: 250,
      postActionWaitMs: 300,
      progressTimeoutMs: 5000,
      focusPasswordBeforeEnter: true,
      methods: ['nativeClick', 'nativeEnter', 'nativeClick'],
      submitSelectors: '#signIn, #enter-online-id-submit, button[type="submit"], input[type="submit"]',
      passwordSelectors: '#tlpvt-passcode-input, #passcode1, input[name="dummy-passcode"], input[name="passcode1"], input[name="passcode"]'
    },
    selectors: {
      username: '#enterID-known-input, #onlineId1, input[name="dummy-onlineId"], input[name="onlineId1"], input[name="onlineId"]',
      hiddenUsername: '#onlineIdVal, input[name="onlineId"]',
      password: '#tlpvt-passcode-input, #passcode1, input[name="dummy-passcode"], input[name="passcode1"], input[name="passcode"]',
      hiddenPassword: '#passcodeVal, input[name="passcode"]',
      submit: '#enter-online-id-submit, #signIn, button[type="submit"], input[type="submit"]'
    },
    submitProgressSelectors: '.AccountItemLoan .AccountBalance .balanceValue, .AccountItem[data-accounttype="Liability"] .AccountBalance .balanceValue',
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
