# Financial Institution Scraper

This is a Chrome Manifest V3 extension scaffold for logging into selected financial institutions,
scraping configured values, and rendering the results in a side panel.

## What is included

- A side panel UI to run scrapes and review the latest results.
- An options page for per-institution credentials and per-field enable/disable controls.
- A module registry so each institution can define its own login flow, target pages, and extractors.
- A declarative extraction system with these built-in extractor types:
  - `text`
  - `attribute`
  - `itemValue`
  - `listItemByTextValue`
  - `tableRowValue`
  - `tableRowsList`
  - `tableRowsSum`
  - `cardList`

## Supported institutions in this scaffold

### Northwestern Mutual

Pages:
- `https://plan.northwesternmutual.com/net-worth`
- `https://plan.northwesternmutual.com/cashflow`

Configured extracts:
- Brokerage account value from the Investments table.
- Adjustable CompLife policy values as a list.
- Adjustable CompLife policy total actual value.
- Wells Fargo checking account balance.
- Cash flow heading, selected mode, donut chart total label, and category cards.

The uploaded HTML this scaffold was mapped against included these concrete examples:
- Investments > Individual = `$232,826.86`
- Adjustable CompLife policies = `$101,607.69` and `$40,628.86`
- Wells Fargo checking = `$16,911.34`

### Wealthfront

Pages:
- `https://www.wealthfront.com/dashboard`

Configured extracts:
- Wealthfront brokerage account value.
- Schwab brokerage account value from the external account list.

The uploaded HTML this scaffold was mapped against included these concrete examples:
- My Personal Investment Account = `$124,841.78`
- Facebook Schwab - 1173 = `$376,244.30`

## Security note

For a quick scaffold, credentials are stored in extension local storage. The service worker restricts
`storage.local` access to trusted extension contexts when the browser supports that setting, but this is
still not a complete secret-management story.

Before using this for real accounts, add one of these:
- passphrase-based encryption for stored credentials
- native messaging to a local credential helper
- integration with a password manager via user copy/paste or manual unlock flow

## Loading the extension

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select this folder.
5. Open the extension side panel and then open Options to save your credentials.

## Where to customize

- Add new institutions in `modules/`.
- Update selector logic in the module objects.
- Add new extractor kinds in `lib/runner.js`.
- Improve the UI in `sidepanel.js` and `options.js`.

## Practical caveats

- Real financial sites may require MFA, CAPTCHA, or bot-detection handling.
- Some pages may change markup frequently, so keep selectors narrow and prefer `data-test-id` values when available.
- If a login flow becomes more complex than a simple username/password form, add a custom flow by extending `runModule` and `injectedLogin`.
