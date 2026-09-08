# SFCC QA Autofill

A browser extension that fills Salesforce B2C Commerce (SFCC) storefront forms in one click
with realistic, validator-safe test data. Registration, login, address book, checkout
shipping, billing, and payment forms are all covered.

- **Works on** SFRA, SiteGenesis, PWA Kit / Composable Storefront, and unknown storefronts
  (via heuristics).
- **Generates** unique emails, policy-safe passwords, names in 14 scripts, valid phone
  numbers for 23 countries, 187 real public addresses, and 155 payment-vendor test cards.
- **No build step, no accounts, no network calls.** Everything is bundled. You load the
  folder straight into your browser.

> This tool is for **sandbox and development storefronts only**. Never run it against a
> production site or with real customer data.

---

## Table of contents

1. [Quick start](#quick-start)
2. [How to use it](#how-to-use-it)
3. [What gets filled](#what-gets-filled)
4. [Payment cards and hosted fields](#payment-cards-and-hosted-fields)
5. [Configuration (Options page)](#configuration-options-page)
6. [Troubleshooting](#troubleshooting)
7. [Development](#development)
8. [Project layout](#project-layout)
9. [Known limitations](#known-limitations)
10. [Tested on](#tested-on)

---

## Quick start

### 1. Get the code

```bash
git clone https://github.com/markMoreto/autofill-sfcc.git
```

Or download the repository as a ZIP and unzip it. You do **not** need Node.js or `npm`
to use the extension. They are only needed to run the tests (see [Development](#development)).

### 2. Load the extension

**Chrome, Edge, Brave, or any Chromium browser**

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the repository folder. It is the one that contains `manifest.json`.
5. Pin the extension to your toolbar so the icon is always visible.

**Firefox (desktop)**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` inside the repository folder.

Firefox removes temporary add-ons when it restarts. Repeat the steps above after each
restart.

**Firefox for Android**

Follow Mozilla's guide to
[running an extension on Firefox for Android](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/)
with `web-ext` and `adb`, then run:

```bash
npx web-ext run -t firefox-android
```

### 3. Fill your first form

1. Open a registration or checkout page on your sandbox storefront.
2. Click the extension icon in the toolbar.
3. Click **Fill everything**.

The form fills in, the toolbar badge shows how many fields were filled, and the popup lists
exactly what happened.

---

## How to use it

### Three ways to trigger a fill

| Trigger | How | Best for |
|---|---|---|
| **Toolbar popup** | Click the extension icon | Choosing country, address, card, and seeing results |
| **Right-click menu** | Right-click the page → **SFCC Autofill** | Filling one section quickly (address by country, card by vendor, registration, login) |
| **Keyboard shortcut** | `Ctrl+Shift+F` (Mac: `Cmd+Shift+F`) fills everything, `Ctrl+Shift+K` (Mac: `Cmd+Shift+K`) fills the card | Repeating a fill without touching the mouse |

All three share the same settings. Change shortcuts at `chrome://extensions/shortcuts`.

### The popup

The popup has three parts:

**Settings (top).** Pick the **country**, an **address** for that country, a **card
vendor**, and a **card**. Choose a **profile** (registered or guest), a **phone format**
(national or E.164), and whether **billing is the same as shipping**. Turn on
**stress-test names** to get names like O'Brien, Müller, or Jean-Luc.

**Actions (middle).**

| Button | What it fills |
|---|---|
| **Fill everything** | Every field the extension can find on the page |
| **Address** | Shipping address only, or billing too if "same as shipping" is off |
| **Card** | Card number, expiry, CVV, and cardholder name |
| **Registration** | Name, email, phone, and password. The credentials are saved. |
| **Login** | The email and password from the most recent **Registration** fill |

**Results (bottom).** After a fill, the popup lists every field that was **filled**,
**skipped**, or **unresolved**, together with the CSS selector it used. Filled card
details appear with **Copy** buttons. When the email uses the default Mailinator domain,
an **Inbox ↗** button opens the public inbox so you can read the storefront's
registration or order emails.

### Reading the badge

- A **green number** is the count of fields that were filled.
- A **red `!`** means expected fields could not be found. Open the popup to see which
  ones, then add a [per-site override](#per-site-selector-overrides) if needed.

### A typical registration-then-login test

1. Go to the registration page and click **Registration**. Note the email in the popup.
2. Submit the form. Click **Inbox ↗** to see the welcome email if your sandbox sends one.
3. Log out, go to the login page, and click **Login**. The same credentials are replayed.

---

## What gets filled

| Data | How it is generated |
|---|---|
| **Names** | Random pick from a bundled pool. 14 ASCII-safe pools (Latin, Japanese, Korean, Arabic, Spanish, Portuguese, German, French, Italian, Dutch, Indian, Chinese, Hebrew, Nigerian) plus a stress pool. |
| **Email** | Always unique. Default is `qa-YYYYMMDD-HHMMSSmmm@mailinator.com`. The prefix can be the generated name or a random word (see [Options](#configuration-options-page)). |
| **Password** | A new policy-safe password each fill, or a fixed one you set in Options. |
| **Phone** | A valid number for the selected country, derived from libphonenumber's example metadata and re-validated on every fill. US numbers stay in the fictional 555-01XX block. Available in national or E.164 format. |
| **Address** | Real, public, deliverable places such as museums, landmarks, and government buildings. Never private residences. 23 countries, 187 addresses, at least 5 per country and 25 in the US spread across 20 states. |
| **State / province** | Full lists for the US, Canada, Australia, and Germany. After selecting a country in checkout the extension waits up to 1.5 seconds for the state list to reload before selecting a state. |
| **Card** | Public test cards from payment vendors' documentation. See the next section. |

### Countries

United States, Canada, Mexico, Brazil, Argentina, United Kingdom, Germany, France, Italy,
Spain, Netherlands, Australia, New Zealand, Japan, South Korea, Singapore, India, United
Arab Emirates, Saudi Arabia, Qatar, Israel, South Africa, Nigeria.

### Address verification status

Addresses ship as **candidates** (`verified: null`) until someone runs the procedure in
[scripts/verify-addresses.md](scripts/verify-addresses.md) against AvaTax and the Google
Address Validation API and records the result. Verified addresses show a ✓ in the popup.
The extension itself never calls those APIs.

### Emails and privacy

The default Mailinator domain gives you **public inboxes**. Anyone can read them, so use
them for sandbox data only. If your team has a private catch-all domain, set it in Options.

---

## Payment cards and hosted fields

### Bundled test cards

[src/data/cards.json](src/data/cards.json) bundles 155 cards taken from each vendor's
public test documentation. Every entry carries the documentation URL and the date it was
last checked.

| Vendor | Cards |
|---|---|
| Adyen | 39 |
| Stripe | 36 |
| Braintree / PayPal | 24 |
| Worldpay | 23 |
| Authorize.net | 16 |
| Cybersource | 15 |
| Checkout.com | 2 |

Cards cover every brand the vendor documents (Visa, Mastercard, Amex, Discover, Diners,
JCB, UnionPay, Maestro, and regional schemes such as Cartes Bancaires, Elo, and Dankort),
plus **declined**, **expired**, **3DS challenge**, and **3DS frictionless** variants for
testing error states. The popup groups each vendor's cards by expected outcome.

Worldpay triggers refusals through a magic cardholder name such as `REFUSED` or
`REFUSED51`. The extension fills that name automatically when you pick one of those cards.

### Hosted payment fields (iframes)

Adyen Drop-in, Stripe Elements, Braintree Hosted Fields, Cybersource Flex, and Checkout.com
Frames render card inputs inside cross-origin iframes. The extension runs inside those
frames too and fills them on a best-effort basis, simulating per-character typing where a
vendor rejects synthetic events.

If a hardened frame still refuses the fill, use the **Copy** buttons in the popup. The card
details are always shown there after a fill.

### Apple Pay, Google Pay, Klarna

These use native payment sheets or external widgets that cannot be filled from a browser
extension. The popup shows the vendor's sandbox instructions instead. Contact and shipping
fields are still filled.

---

## Configuration (Options page)

Open the Options page from the ⚙ button in the popup, or from the browser's extension
management page.

### Defaults

- **Email prefix**, **email domain**, and **email style** (fixed prefix, generated name, or
  a random word from a bundled pool). A timestamp is always appended so emails never
  collide.
- **Fixed password**. Leave empty to generate a new one on every fill.
- **Name pool**. Which script the generated names come from.

### Per-site selector overrides

When a project renames its form fields, the extension may not find them. Map the field
once and the override is saved for that hostname.

The easy way, from the popup:

1. Open the storefront page with the field that was not found.
2. In the popup, choose the field's logical name from **Map a field…**.
3. Click **Pick on page**, then click the input on the page.

The override is stored automatically. You can also edit the overrides as JSON on the
Options page, keyed by hostname, then logical field, then a list of selectors.

### Custom addresses

Add project-specific addresses that already passed your validator. Provide JSON keyed by
ISO country code. Each record needs `id`, `label`, `address1`, `city`, `postalCode`, and
`state` where the country uses one. Custom addresses appear first in the popup's address
list.

### Share settings with your team

**Export JSON** downloads the whole settings object. Teammates use **Import JSON…** to load
it. This is the simplest way to distribute overrides and custom addresses.

---

## Troubleshooting

**The badge shows a red `!`.**
Open the popup and expand the **unresolved** list. It names the fields the extension
expected but could not find. Use **Map a field…** to point the extension at the right
input.

**Card fields inside an iframe stay empty.**
The vendor hardened its frame. Use the **Copy** buttons in the popup and paste the values
by hand. If this is a permanent change, see the maintenance guide on
[patching a hosted iframe](docs/MAINTENANCE.md#when-a-payment-vendor-changes-its-hosted-iframe).

**The state or province did not get selected.**
The extension waits 1.5 seconds for the state list to reload after choosing a country.
On a very slow sandbox, run **Address** a second time.

**Phone validation fails on a non-US site.**
SFRA's default phone validation is US-centric. The extension defaults to a compact national
format that passes the default regex. Projects with custom validation can switch the
**phone format** in the popup.

**Nothing happens on Firefox after a restart.**
Temporary add-ons are removed on restart. Load it again from `about:debugging`.

**I only want the extension active on my sandbox domains.**
By default the content script is registered on every site, though it does no work until you
trigger a fill. To narrow it, edit `content_scripts[0].matches` and `host_permissions` in
[manifest.json](manifest.json), then click **Reload** on the extensions page.

---

## Development

### Prerequisites

- Node.js 18 or newer
- A Chromium browser download for the end-to-end tests (installed by Playwright below)

### Setup and tests

```bash
npm install                      # dev tooling only: vitest, playwright, react (for tests)
npm test                         # 139 unit tests (jsdom)
npx playwright install chromium  # one-time browser download
npm run test:e2e                 # 4 end-to-end tests with the real unpacked extension
```

The unit tests cover data schemas, the profile generator, phone numbers, field detection
for each platform, the fill engine, and a real React controlled-input test that proves the
PWA Kit path.

The end-to-end suite loads the real extension into Chromium and fills the static fixtures
in [test/fixtures/](test/fixtures/).

### Other scripts

```bash
npm run vendor:phone   # re-vendor libphonenumber-js after upgrading the dependency
npm run icons          # regenerate the extension icons
```

### Reloading after a change

There is no build step. Edit the files, then click **Reload** on the browser's extensions
page. On Firefox, reload the temporary add-on from `about:debugging`.

### Guides

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). How the pieces fit together, the message
  contract between popup, background, and content scripts, and the design decisions. Read
  this first before changing anything structural.
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md). Step-by-step recipes: add a country, add or
  verify an address, add or update a test card, patch selectors when a storefront or vendor
  changes, add a hosted-frame vendor, and the release checklist.
- [scripts/verify-addresses.md](scripts/verify-addresses.md). The address verification
  procedure using AvaTax and the Google Address Validation API.

### Contributing

1. Keep `npm test` green on every commit.
2. Prefer data changes over code changes. Selectors, addresses, cards, and names all live
   in JSON under [src/data/](src/data/).
3. When adding a test card, cite the vendor's public documentation URL and the date you
   checked it.
4. Never record an address as verified unless you actually ran the verification procedure.

---

## Project layout

```
manifest.json            Extension manifest (MV3, Chrome + Firefox)
src/
  background.js          Service worker: reads settings, generates the profile, sends FILL
  content/
    platform.js          Detects SFRA / SiteGenesis / PWA Kit / unknown
    detect.js            Maps logical fields to inputs on the page
    fill.js              Sets values safely (React-aware), handles selects and masks
    frames.js            Fills card inputs inside vendor iframes
    content.js           Message handling and result reporting
  lib/
    data.js              Default settings and data loading
    generator.js         Builds a profile: name, email, password, address, card
    phone.js             Phone numbers via the vendored libphonenumber
  data/
    countries.json       Country metadata and state/province lists
    addresses.json       Public addresses per country
    cards.json           Vendor test cards
    names.json           Name pools
    emails.json          Random email prefixes
    selectors/           Selector maps per platform and for hosted iframes
  popup/                 Toolbar popup
  options/               Options page
test/
  unit/                  Vitest suites
  e2e/                   Playwright suite
  fixtures/              Static storefront pages used by both suites
docs/                    Architecture and maintenance guides
scripts/                 Icon and vendoring scripts, address verification procedure
```

---

## Known limitations

- Hosted payment iframes are best-effort. Vendors harden them regularly. The Copy-button
  fallback always works. Patch [src/data/selectors/hosted.json](src/data/selectors/hosted.json)
  when a vendor changes.
- Apple Pay, Google Pay, and Klarna cannot be automated from a content script.
- SFRA's default phone validation is US-centric. See [Troubleshooting](#troubleshooting).
- Address `verified` statuses are only as fresh as the last run of the verification
  procedure. Re-verify yearly.
- Firefox loads the background as an event page while Chrome uses a service worker. Both
  run the same files, so keep [src/background.js](src/background.js) stateless.
- The extension is not published to any store. Distribution is "Load unpacked" only.

---

## Tested on

| Page | SFRA fixture | SiteGenesis fixture | PWA Kit fixture | Real sandbox |
|---|---|---|---|---|
| Registration | ✅ unit + e2e | ✅ unit | — | ☐ |
| Login | ✅ unit | ✅ unit | — | ☐ |
| Address book | ✅ unit | ✅ unit | — | ☐ |
| Checkout shipping | ✅ unit + e2e | ✅ unit + e2e | ✅ unit | ☐ |
| Checkout billing (same-as / distinct) | ✅ unit | ✅ unit | ✅ unit | ☐ |
| Payment (native card form) | ✅ unit + e2e | ✅ unit | ✅ unit | ☐ |
| Unknown platform (heuristics) | — | — | — | ✅ generic fixture e2e |

Record results in the "Real sandbox" column as you test against actual storefronts.
