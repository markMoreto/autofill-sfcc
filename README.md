# SFCC QA Autofill

A locally-installed browser extension that fills Salesforce B2C Commerce (SFCC) storefront
forms in one action with realistic, validator-safe test data: names, complete addresses,
phone numbers, unique emails, policy-safe passwords, and payment-vendor test cards.

Supported storefront architectures, in priority order:

1. **SFRA** (Storefront Reference Architecture) — primary
2. **SiteGenesis** (controllers and pipelines) — secondary
3. **PWA Kit / Composable Storefront** (React, headless) — best-effort
4. Anything else — scored generic heuristics (autocomplete attributes, field names, labels)

No build step. No runtime network calls — all data is bundled. Not published to any store;
distribution is "Load unpacked" only.

## Install

**Chrome / Edge / Brave**

1. Clone or download this folder.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select this repository's root folder (the one with `manifest.json`).

**Firefox (desktop)**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `manifest.json`.
3. Temporary add-ons are removed on restart — reload after restarting Firefox.

**Firefox for Android**

Works as a temporary add-on via [web-ext and adb](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/):
`npx web-ext run -t firefox-android`.

> Tip: with `<all_urls>` the content script is registered on every site (it does zero work
> until you trigger a fill). If you prefer, narrow `content_scripts[0].matches` and
> `host_permissions` in `manifest.json` to your sandbox domains.

## Use

Three triggers, all sharing the same settings:

| Trigger | How |
|---|---|
| Toolbar popup | Click the extension icon — full control panel + result/debug panel |
| Context menu | Right-click the page → **SFCC Autofill** → Fill everything / address (per country) / card (per vendor) / registration / login |
| Keyboard | `Ctrl/Cmd+Shift+F` fill everything · `Ctrl/Cmd+Shift+K` fill card (remap at `chrome://extensions/shortcuts`) |

After a fill, the toolbar badge shows the filled-field count (green) or `!` (red) when
expected fields could not be found. The popup's result panel lists every filled, skipped
and unresolved field with the selector used — that panel is the debugging aid for building
per-site overrides.

Notes on behavior:

- **Emails are always unique** (`qa-YYYYMMDD-HHMMSSmmm@mailinator.com`, configurable in
  Options) so registration never collides. With the default Mailinator domain each address
  is a **public inbox** — the popup's result panel shows an **Inbox ↗** button that opens
  it, so you can read the storefront's registration/order emails. Public means anyone can
  read them: sandbox data only; switch the domain in Options if your team has a private
  catch-all.
- **Fill registration** stores the generated credentials; **Fill login** replays the last
  registered email/password.
- **Billing same as shipping** checks the storefront's checkbox and skips billing address
  fields (contact email/phone are still filled). Untick it to fill a distinct billing
  address (the country's second bundled address).
- Phone numbers come from libphonenumber's own example metadata, so they are valid for
  the selected country in both **national** and **E.164** formats.
- Selecting a country in checkout waits (up to 1.5 s) for SFRA/SiteGenesis to reload the
  state/province options before selecting the state.

## Payment cards

`src/data/cards.json` bundles cards from each vendor's **public test documentation**
(Adyen, Authorize.net, Stripe, Braintree/PayPal, Cybersource, Worldpay, Checkout.com),
including declined and 3DS-challenge variants for error-state testing. Each entry carries
the doc URL and the date it was last checked.

**Hosted payment fields (iframes)** — Adyen Drop-in, Stripe Elements, Braintree Hosted
Fields, Cybersource Flex, Checkout.com Frames render card inputs inside cross-origin
iframes. The extension's content script runs inside those frames too and fills them
best-effort (simulated per-character typing where vendors reject synthetic events). When
a hardened frame still refuses, use the **Copy** buttons in the popup — the card details
are always shown there after a fill.

**Apple Pay / Google Pay / Klarna** cannot be filled from a content script (native sheets
/ external widgets). The popup shows the vendor's sandbox instructions instead; the
extension still fills contact and shipping fields.

## Countries and addresses

23 countries across North & South America, Europe, APAC, Middle East and Africa
(`src/data/countries.json`). Each country ships ≥2 real, public, deliverable addresses
(landmarks, museums, government buildings — never private residences) in
`src/data/addresses.json`.

Addresses ship as **candidates** (`verified: null`) until someone runs the verification
procedure in [scripts/verify-addresses.md](scripts/verify-addresses.md) against AvaTax
and the Google Address Validation API and records the result. The popup marks verified
addresses with ✓. The extension itself never calls those APIs.

## Options (per-team configuration)

Open the extension's Options page for:

- **Defaults**: email prefix/domain, fixed password (or per-fill generation), name pool
  (Latin/JA/KO/AR romanized).
- **Per-site selector overrides**: when a project renames fields, map hostname →
  logical field → selector list. Easiest path: in the popup choose **Map a field**,
  pick the logical name, click the input on the page — the override is saved for that
  hostname automatically.
- **Custom addresses**: project-specific validator-approved addresses per country; they
  appear first in the popup.
- **Export / Import**: share the whole settings object (JSON file) with your team.

## Development

```bash
npm install          # dev tooling only (vitest, playwright, react for tests)
npm test             # 96 unit tests (jsdom): data schemas, generator, phones,
                     # detection per platform, fill engine, React setter proof
npx playwright install chromium
npm run test:e2e     # loads the real unpacked extension into Chromium against fixtures

npm run vendor:phone # re-vendor libphonenumber-js after upgrading the dependency
npm run icons        # regenerate icons
```

Maintenance guides:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit together, message
  contract, design decisions (read this first).
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md) — recipes: add a country, add/verify an
  address, add or update a test card, patch selectors when a storefront or payment
  vendor changes, add a hosted-frame vendor.
- [scripts/verify-addresses.md](scripts/verify-addresses.md) — the owner-run address
  verification procedure (AvaTax + Google Address Validation).

## Known limitations

- Hosted payment iframes are best-effort; vendors harden them regularly. The Copy-button
  fallback always works. Patch `src/data/selectors/hosted.json` when a vendor changes.
- Apple Pay / Google Pay flows cannot be automated from a content script (documented as
  manual steps in the popup).
- SFRA's default phone validation is US-centric; the extension defaults to compact
  national format for non-US numbers, which passes the default regex. Projects with
  custom phone validation can force a format via the popup toggle.
- Address `verified` statuses are only as fresh as the last run of the verification
  procedure (re-verify annually).
- Firefox loads MV3 background as an event page (`background.scripts`); Chrome uses the
  service worker. Both are driven by the same files — keep `src/background.js` stateless.

## Tested on

| Page | SFRA fixture | SG fixture | PWA fixture | Real sandbox |
|---|---|---|---|---|
| Registration | ✅ unit+e2e | ✅ unit | — | ☐ owner to run §12.3 matrix |
| Login | ✅ unit | ✅ unit | — | ☐ |
| Address book | ✅ unit | ✅ unit | — | ☐ |
| Checkout shipping | ✅ unit+e2e | ✅ unit+e2e | ✅ unit | ☐ |
| Checkout billing (same-as / distinct) | ✅ unit | ✅ unit | ✅ unit | ☐ |
| Payment (native card form) | ✅ unit+e2e | ✅ unit | ✅ unit | ☐ |
| Unknown platform (heuristics) | — | — | — | ✅ generic fixture e2e |

Record real-sandbox results here as the manual matrix (plan §12.3) is executed.
