export default {
  id: 'chase',
  displayName: 'Chase',
  login: {
    startUrl: 'https://secure.chase.com/web/auth/dashboard#/dashboard/overview',
    keepActiveUntilReady: true,
    allFrames: true,
    timeoutMs: 10000,
    skipExpectedPageRace: true,
    submitWithEnter: false,
    allowUsernameOnlyStep: true,
    initialInputSettleMs: 450,
    submitReadyTimeoutMs: 900,
    initialSubmitReadyTimeoutMs: 1600,
    initialSubmitWaitMs: 650,
    enterSubmitWaitMs: 120,
    passwordStepTimeoutMs: 5000,
    passwordInputSettleMs: 300,
    submitImmediatelyAfterPassword: true,
    submitAttempts: 3,
    submitRetryDelayMs: 600,
    submitProgressTimeoutMs: 1400,
    submitProgressSelectors: '#header-simplerAuth-dropdownoptions-styledselect, #simplerAuth-dropdownoptions-styledselect .list-container.open, input[autocomplete="one-time-code"], #postponeUpdateContactInformationButton, [id$="-currentBalance-dataItem"], #ACTIVITY-dataTableId-mds-diy-data-table',
    submitMethods: ['click', 'requestSubmit', 'dispatchSubmit', 'enter'],
    submitMethodWaitMs: 200,
    nativeLoginFlow: {
      enabled: true,
      activateTab: true,
      activationSettleMs: 250,
      initialStateTimeoutMs: 12000,
      passwordStepTimeoutMs: 5000,
      focusSettleMs: 120,
      selectionSettleMs: 60,
      typingSettleMs: 220,
      postActionWaitMs: 300,
      progressTimeoutMs: 1600,
      focusPasswordBeforeEnter: true,
      methods: ['nativeClick', 'nativeEnter', 'nativeClick'],
      usernameSelectors: '#userId-input-field-input, input[name="username"], input[autocomplete="username"], input[autocomplete*="username" i]',
      passwordSelectors: '#password-input-field-input, input[name="password"], input[autocomplete="current-password"], input[type="password"]',
      submitSelectors: '#signin-button, button[data-testid="sign-in"], #loginForm button[type="submit"]',
      progressSelectors: '#header-simplerAuth-dropdownoptions-styledselect, #simplerAuth-dropdownoptions-styledselect .list-container.open, input[autocomplete="one-time-code"], #postponeUpdateContactInformationButton, [id$="-currentBalance-dataItem"], #ACTIVITY-dataTableId-mds-diy-data-table'
    },
    nativeSubmitFallback: {
      enabled: true,
      allFrames: true,
      activateTab: true,
      activationSettleMs: 250,
      postActionWaitMs: 300,
      progressTimeoutMs: 1600,
      focusPasswordBeforeEnter: true,
      methods: ['nativeClick', 'nativeEnter', 'nativeClick'],
      submitSelectors: '#signin-button, button[data-testid="sign-in"], #loginForm button[type="submit"]',
      passwordSelectors: '#password-input-field-input, input[name="password"], input[type="password"]'
    },
    selectors: {
      username: '#userId-input-field-input, input[name="username"], input[autocomplete="username"], input[autocomplete*="username" i], input[name*="user" i], input[id*="user" i], input[name*="login" i], input[id*="login" i], input[name*="customer" i], input[id*="customer" i]',
      password: '#password-input-field-input, input[name="password"], input[autocomplete="current-password"], input[name*="password" i], input[id*="password" i], input[type="password"]',
      submit: '#signin-button, button[data-testid="sign-in"], #loginForm button[type="submit"], button[type="submit"], input[type="submit"], button[id*="sign" i], button[name*="sign" i], button[id*="log" i], button[name*="log" i], [role="button"][id*="sign" i], [role="button"][name*="sign" i], button[id*="continue" i], button[name*="continue" i], [role="button"][id*="continue" i], [role="button"][name*="continue" i], button[id*="next" i], button[name*="next" i], [role="button"][id*="next" i], [role="button"][name*="next" i]'
    },
    postSubmitWaitMs: 250,
    manualChallenge: {
      allFrames: true,
      preferNativePreparation: true,
      timeoutMs: 30000,
      renderTimeoutMs: 18000,
      renderPollMs: 300,
      frameDiscoveryTimeoutMs: 15000,
      preRenderActivationMs: 1200,
      postPreRenderActivationWaitMs: 300,
      renderWarmupAttempts: 2,
      nativePrepare: {
        enabled: true,
        activateTab: true,
        activationSettleMs: 300,
        timeoutMs: 12000,
        pollMs: 250,
        optionMenuOpenWaitMs: 1100,
        optionPostClickWaitMs: 250,
        optionSelectedTimeoutMs: 7000,
        optionSelectionPollMs: 250,
        optionSettleMs: 900,
        continueDiscoveryTimeoutMs: 5000,
        beforeContinueWaitMs: 350,
        continueSettleMs: 2200,
        advanceTimeoutMs: 8000,
        postPrepareWaitMs: 250
      },
      activationRequired: true,
      activationReason: 'Enter the Chase text code. We will submit it after a short pause.',
      autoSubmitCode: false,
      manualSubmitSettleMs: 700,
      focusSubmitAfterCode: true,
      codeEntryPollMs: 250,
      nativeSubmitAfterCode: {
        enabled: true,
        activateTab: true,
        activationSettleMs: 250,
        blurSettleMs: 1100,
        focusSettleMs: 120,
        postActionWaitMs: 400,
        methods: ['nativeClick', 'nativeEnter']
      },
      optionPostClickWaitMs: 250,
      optionSettleMs: 1200,
      beforeContinueWaitMs: 350,
      continueSettleMs: 2200,
      passwordInputSettleMs: 200,
      submitAfterPassword: true,
      beforePasswordSubmitWaitMs: 450,
      passwordSubmitSettleMs: 1200,
      challengeShellSelectors: '#interstitial, #contentWrapper, #logonDialog, #logonbox, #applicationOverlay',
      challengeTexts: [
        'one-time code',
        'security code',
        'verification code',
        'send code',
        'get a text',
        'text me',
        'use a different way',
        'choose how',
        'choose one',
        'passkey',
        'recognized device'
      ],
      optionTriggerSelector: '#header-simplerAuth-dropdownoptions-styledselect, #iconButton-simplerAuth-dropdownoptions-styledselect',
      optionTriggerValueSelector: '#header-simplerAuth-dropdownoptions-styledselect',
      optionContainerSelector: '#simplerAuth-dropdownoptions-styledselect .list-container.open, #ul-list-container-simplerAuth-dropdownoptions-styledselect, [role="listbox"], [role="menu"], .list-container.open, ul.list, .list-item--navigational, .list-item__container',
      optionPreferredSelector: '.list-item__navigational[aria-label*="Get a text" i], .list-item__navigational[aria-label*="one-time code" i], #ul-list-container-simplerAuth-dropdownoptions-styledselect a.option[rel^="S"], [role="option"][rel^="S"], [role="option"][data-value*="sms" i], [role="option"][data-value*="text" i], [role="option"][aria-label*="text" i], [role="option"][aria-label*="sms" i]',
      optionPlaceholderTexts: ['Choose one', 'Tell us how: Choose one', 'Select one', 'Please choose', 'Choose an option'],
      optionMenuOpenWaitMs: 900,
      optionMenuPollMs: 300,
      optionSelectedTimeoutMs: 8000,
      optionSelectionPollMs: 250,
      optionSelectors: 'label, button, [role="button"], [role="radio"], [role="option"], input[type="radio"], span, div, a, li',
      optionText: 'Text me',
      optionTexts: ['Get a text', 'Text me', 'Text', 'text message', 'text code', 'send code by text', 'sms', 'mobile number'],
      optionTextMatch: 'includes',
      continuePreferredSelector: 'button[aria-labelledby="next-content-label"], button[aria-labelledby="next-button-label"], mds-button#next-content, mds-button#next-button, #next-content, #next-button',
      continueSelectors: '#next-content, #next-button, mds-button#next-content, mds-button#next-button, button, [role="button"], input[type="submit"]',
      continueTexts: ['Continue', 'Next', 'Submit', 'Send code', 'Send me a code', 'Get code', 'Text me'],
      passwordSelectors: 'input[autocomplete="current-password"], input[name*="password" i], input[id*="password" i], input[type="password"]',
      codeSelectors: 'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[maxlength="1"][inputmode="numeric"], input[name*="code" i], input[id*="code" i], input[name*="otp" i], input[id*="otp" i], input[name*="token" i], input[id*="token" i], input[name*="verification" i], input[id*="verification" i]',
      submitSelectors: 'button[aria-labelledby="next-content-label"], button[aria-labelledby="next-button-label"], mds-button#next-content, mds-button#next-button, #next-content, #next-button, button[type="submit"], input[type="submit"], button[id*="submit" i], button[name*="submit" i], button[id*="continue" i], button[name*="continue" i], button[id*="verify" i], button[name*="verify" i], button[id*="send" i], button[name*="send" i]',
      completion: {
        overlayHiddenSelector: '#logonDialog'
      },
      completionTimeoutMs: 180000,
      postCompletionWaitMs: 2000,
      postCompletionReady: {
        readyUrls: [
          'https://secure.chase.com/web/auth/dashboard#/dashboard/overview',
          'https://secure.chase.com/web/auth/dashboard#/dashboard/transactions/1243557494/CARD/BAC'
        ],
        readySelectors: '#postponeUpdateContactInformationButton, .account-blade__navigation, .ovd-custom-accordion__tile, [id$="-currentBalance-dataItem"], #ACTIVITY-dataTableId-mds-diy-data-table',
        preActions: [
          {
            type: 'click',
            selector: '#postponeUpdateContactInformationButton, button, [role="button"]',
            text: 'Ask me later',
            textMatch: 'includes'
          }
        ],
        pollMs: 300,
        timeoutMs: 45000,
        settleMs: 2500
      }
    }
  },
  pages: [
    {
      id: 'overview',
      label: 'Overview',
      url: 'https://secure.chase.com/web/auth/dashboard#/dashboard/overview',
      preActions: [
        {
          type: 'click',
          selector: '#postponeUpdateContactInformationButton, button, [role="button"]',
          text: 'Ask me later',
          textMatch: 'includes',
          waitMs: 1000
        }
      ],
      waitFor: {
        selector: '[id$="-currentBalance-dataItem"] [data-testid="dataItem-value"], [id$="-currentBalance-dataItem"] .primary-value',
        visible: true,
        timeoutMs: 30000,
        settleMs: 2000
      },
      extractors: [
        {
          id: 'chaseCreditCardBalance',
          label: 'Chase credit card balance',
          kind: 'itemValue',
          itemSelector: '[id$="-currentBalance-dataItem"]',
          valueSelector: '[data-testid="dataItem-value"], .primary-value',
          cashflowRole: 'discretionary',
          netWorthMultiplier: -1,
          meta: {
            titleSelector: '[data-testid="dataItem-label"], .text-label'
          }
        }
      ]
    },
    {
      id: 'transactions',
      label: 'Transactions',
      url: 'https://secure.chase.com/web/auth/dashboard#/dashboard/transactions/1243557494/CARD/BAC',
      preActions: [
        {
          type: 'click',
          selector: '#postponeUpdateContactInformationButton, button, [role="button"]',
          text: 'Ask me later',
          textMatch: 'includes',
          waitMs: 1000
        }
      ],
      waitFor: {
        selector: '#ACTIVITY-dataTableId-mds-diy-data-table, [data-testid="contentList.transactionSummaryMessages.items.endOfActivityMessage.value"]',
        visible: true,
        timeoutMs: 30000,
        settleMs: 1000
      },
      extractors: [
        {
          id: 'chaseDiscretionarySpend',
          label: 'Chase discretionary spend',
          kind: 'chaseTransactionsMonthlyTotal'
        },
        {
          id: 'chaseDiscretionaryBreakdown',
          label: 'Chase discretionary breakdown',
          kind: 'chaseTransactionsMonthlyBreakdown'
        }
      ]
    }
  ]
};
