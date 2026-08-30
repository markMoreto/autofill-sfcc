# SFCC QA Autofill — Browser Extension Project Plan

**Audience:** Claude Code (implementer) and the project owner.
**Status:** Planning — ready to execute.
**Last updated:** 2026-08-30

---

## 1. Purpose

A locally-installed browser extension that lets developers and QA testers fill Salesforce B2C Commerce (SFCC) storefront forms in one action with realistic, validator-safe test data: names, complete addresses, phone numbers, emails, passwords, and payment-vendor test cards.

Target storefront architectures, in priority order:

1. **SFRA** (Storefront Reference Architecture) — primary
2. **SiteGenesis** (controllers and pipelines) — secondary
3. **PWA Kit / Composable Storefront** (React, headless) — best-effort

Target pages: registration / sign-up, login, my account (profile, address book, payment instruments), cart, checkout (shipping, billing, payment), guest checkout, and any custom form using the same field conventions.

### Non-goals

- Publishing to any extension store. Distribution is "Load unpacked" from a local folder.
- Automating Apple Pay / Google Pay / PayPal wallet flows (impossible from a content script — documented as manual steps instead).
- Generating data that bypasses fraud or 3DS. Only vendor-documented test cards.
- Any network calls at runtime. All data is bundled.

---

## 2. Success Criteria

| # | Requirement | Acceptance test |
|---|---|---|
| 1 | Fill first / last name | Registration + shipping + billing forms populated with plausible names |
| 2 | Complete, validator-safe address | Address passes AvaTax address validation and Google Address Validation API with no correction or "unverified" status |
| 3 | Valid phone, with or without country code | Number passes `libphonenumber` `isValid()` for the chosen country; toggle switches E.164 vs national format |
| 4 | Country selectable | Popup and context menu expose a country picker; selection persists between sessions |
| 5 | Curated country list | ~25 countries across Americas, Europe, APAC, Middle East, Africa (see §7) |
| 6 | Works on account / cart / checkout / sign-up / guest checkout | Manual test matrix in §12 passes on SFRA reference site and one SiteGenesis site |
| 7 | Vendor test cards | Adyen, Authorize.net, Stripe, Braintree/PayPal, Cybersource, Worldpay, Checkout.com, Klarna presets; Apple Pay / Google Pay documented |
| 8 | No lag | Fill completes in < 150 ms on a checkout page (excluding SFRA state-dropdown reload wait); no runtime fetches; content script idle cost ~0 |
| 9 | Triggers | Toolbar popup, right-click context menu, keyboard shortcut |
| 10 | Mobile view | Works identically under DevTools device emulation; works in Firefox for Android when loaded as a temporary add-on |
| 11 | Local install | `chrome://extensions` → Developer mode → Load unpacked; Firefox `about:debugging` → Load Temporary Add-on |

---

## 3. Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Manifest | MV3 | Required by Chrome; Firefox 109+ supports MV3 |
| Language | Vanilla ES2022 JavaScript, no framework | Zero build step, fastest load, easiest for load-unpacked |
| Build | None required. Optional `npm run bundle` (esbuild) only to vendor `libphonenumber-js` into a single file | Keep it copy-and-load |
| Storage | `chrome.storage.local` for settings; bundled JSON for data | No runtime network |
| Phone validation | `libphonenumber-js` (min metadata bundle, ~90 KB) | Generates and validates numbers per country |
| Browsers | Chrome, Edge, Brave (identical); Firefox (same code + `browser_specific_settings`) | "Universal" requirement |
| Tests | Vitest for unit tests (fill engine, data validators); Playwright for an HTML fixture suite mimicking SFRA/SG/PWA markup | Deterministic regression coverage without needing a live sandbox |

---

## 4. Repository Layout

```
sfcc-qa-autofill/
├── manifest.json
├── README.md                     # install + usage + adding a site override
├── package.json                  # dev deps only (vitest, playwright, esbuild)
├── src/
│   ├── background.js             # service worker: context menus, commands, message routing
│   ├── content/
│   │   ├── content.js            # entry: listens for fill messages, orchestrates
│   │   ├── detect.js             # field detection (selector maps + heuristics)
│   │   ├── fill.js               # value setting + event dispatch + async sequencing
│   │   ├── frames.js             # iframe (hosted payment fields) handling
│   │   └── platform.js           # SFRA / SiteGenesis / PWA Kit detection
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── options/
│   │   ├── options.html          # per-site selector overrides, defaults, data editor
│   │   └── options.js
│   ├── data/
│   │   ├── countries.json        # country metadata + address format rules
│   │   ├── addresses.json        # curated validator-safe addresses per country
│   │   ├── names.json            # first/last name pools (locale-aware)
│   │   ├── cards.json            # vendor test cards
│   │   └── selectors/
│   │       ├── sfra.json
│   │       ├── sitegenesis.json
│   │       ├── pwakit.json
│   │       └── generic.json      # autocomplete/label heuristics
│   ├── lib/
│   │   ├── generator.js          # names, emails, passwords, phones
│   │   ├── phone.js              # libphonenumber wrapper
│   │   └── libphonenumber.min.js # vendored
│   └── icons/
├── test/
│   ├── unit/
│   ├── fixtures/                 # static HTML replicas of SFRA/SG/PWA forms
│   └── e2e/
└── scripts/
    └── verify-addresses.md       # manual procedure for validating addresses.json
```

---

## 5. Architecture

### 5.1 Components

**Background service worker (`background.js`)**
- Registers context menus on install: root "SFCC Autofill" with children:
  - Fill everything (last-used settings)
  - Fill address only ▸ [country submenu]
  - Fill card only ▸ [vendor submenu]
  - Fill registration (new unique email)
  - Fill login (last registered credentials)
- Registers keyboard commands: `fill-all` (Ctrl/Cmd+Shift+F), `fill-card` (Ctrl/Cmd+Shift+K).
- On trigger: reads settings from storage, sends `{type:'FILL', scope, country, vendor, options}` to the active tab (all frames).
- Handles the "Fill login" memory: after a registration fill, stores `{email, password}` for reuse.

**Content script (`content/*.js`)**
- Declared with `"all_frames": true`, `"run_at": "document_idle"`, matched on `<all_urls>` (the user can narrow this in manifest if desired).
- Zero work at load time except registering a message listener. No MutationObservers by default (they cost CPU on busy checkouts). Detection is done on demand, at fill time.
- On `FILL`:
  1. `platform.js` sniffs SFRA / SiteGenesis / PWA Kit (see §6.1).
  2. `detect.js` builds a `FieldMap` for the requested scope.
  3. `generator.js` + data files produce a `Profile`.
  4. `fill.js` applies values in dependency order with correct events.
  5. Reports back `{filled: [...], skipped: [...], unresolved: [...]}` so the popup can show what happened.

**Popup**
- Country select (grouped by region), profile mode (Registered / Guest), card vendor select, "Phone format" toggle (E.164 / national), "Same as shipping" checkbox, "Fill" button, and a result panel listing filled/skipped fields.
- Reads/writes `chrome.storage.local`. Sends the same `FILL` message as the background.

**Options page**
- Per-host selector overrides (JSON editor with validation): lets a project map its renamed fields without editing source.
- Default country / vendor / email domain / password.
- Custom addresses: add a project-specific verified address per country.
- Export/import settings JSON so the whole team shares one config.

### 5.2 Message contract

```ts
type FillScope = 'all' | 'address' | 'shipping' | 'billing' | 'card' | 'registration' | 'login' | 'contact';

interface FillRequest {
  type: 'FILL';
  scope: FillScope;
  country: string;           // ISO 3166-1 alpha-2
  vendor?: string;           // 'adyen' | 'authorizenet' | ...
  profileMode: 'registered' | 'guest';
  phoneFormat: 'e164' | 'national';
  billingSameAsShipping: boolean;
}

interface FillResult {
  platform: 'sfra' | 'sitegenesis' | 'pwakit' | 'unknown';
  filled: Array<{ field: string; selector: string; frame: string }>;
  skipped: Array<{ field: string; reason: string }>;
  unresolved: string[];      // logical fields we looked for but did not find
  durationMs: number;
}
```

---

## 6. Field Detection

### 6.1 Platform detection (`platform.js`)

Cheap checks, in order; first hit wins:

- **SFRA:** `document.querySelector('form.registration, form.checkout-shipping-form, .checkout-billing, [data-action-url], .veil')`, or `window.jQuery && document.querySelector('.page[data-action]')`, or `<meta name="generator">` absent but `#maincontent` + `.header-banner` present.
- **SiteGenesis:** any `input[name^="dwfrm_"]` outside SFRA markup, `#wrapper.pt_checkout`, `.pt_account`, `window.app && window.app.constants`.
- **PWA Kit:** `#root` with `[data-testid^="sf-"]` elements, `window.__PRELOADED_STATE__` or `__CONFIG__` with `app.commerceAPI`, Chakra UI class prefixes (`chakra-input`).
- Otherwise `unknown` → generic heuristics only.

### 6.2 Logical field vocabulary

Every selector map resolves to these logical names:

```
email, password, passwordConfirm, firstName, lastName, phone,
shipping.firstName, shipping.lastName, shipping.address1, shipping.address2,
shipping.city, shipping.state, shipping.postalCode, shipping.country, shipping.phone,
billing.firstName, billing.lastName, billing.address1, billing.address2,
billing.city, billing.state, billing.postalCode, billing.country, billing.phone,
billing.email, billing.sameAsShipping,
card.holder, card.number, card.expMonth, card.expYear, card.expiry (MM/YY combined), card.cvv, card.type,
account.addressId, account.setDefault, terms, newsletter
```

### 6.3 SFRA selectors (`selectors/sfra.json`)

Known IDs from the reference `app_storefront_base` cartridge. Each logical field maps to an ordered list of CSS selectors; first match in the current scope wins.

| Logical | Selectors |
|---|---|
| email | `#registration-form-email`, `#email-guest`, `#login-form-email`, `input[name$="_email"]`, `input[name$="_emailAddress"]` |
| password | `#registration-form-password`, `#login-form-password`, `input[name$="_password"]` |
| passwordConfirm | `#registration-form-password-confirm` |
| firstName | `#registration-form-fname`, `input[name$="_firstname"]` |
| lastName | `#registration-form-lname`, `input[name$="_lastname"]` |
| phone | `#registration-form-phone`, `input[name$="_phone"]` |
| shipping.firstName | `#shippingFirstName`, `input[name$="shippingAddress_addressFields_firstName"]` |
| shipping.lastName | `#shippingLastName` |
| shipping.address1 | `#shippingAddressOne` |
| shipping.address2 | `#shippingAddressTwo` |
| shipping.country | `#shippingCountry` |
| shipping.state | `#shippingState` |
| shipping.city | `#shippingAddressCity` |
| shipping.postalCode | `#shippingZipCode` |
| shipping.phone | `#shippingPhoneNumber` |
| billing.* | `#billingFirstName`, `#billingLastName`, `#billingAddressOne`, `#billingAddressTwo`, `#billingCountry`, `#billingState`, `#billingAddressCity`, `#billingZipCode`, `#phoneNumber`, `#email` |
| billing.sameAsShipping | `#shippingAsBilling` (SFRA 6+), `input[name$="_shippingAddressUseAsBillingAddress"]` |
| card.number | `#cardNumber`, `input[name$="_cardNumber"]` |
| card.expMonth / expYear | `#expirationMonth`, `#expirationYear` |
| card.cvv | `#securityCode` |
| card.type | `#cardType`, `input[name$="_cardType"]` (hidden) |
| card.holder | `#cardOwner` |
| account address book | `#addressId`, `#firstName`, `#lastName`, `#address1`, `#address2`, `#country`, `#state`, `#city`, `#zipCode`, `#phone` |

Multi-shipment: SFRA checkout can render one shipping form per shipment (`.shipping-form[data-shipment-uuid]`). Detection must scope to each `form` and fill all visible ones.

### 6.4 SiteGenesis selectors (`selectors/sitegenesis.json`)

SG uses generated IDs with random suffixes, so match on `name`:

- `input[name="dwfrm_profile_customer_firstname"]`, `_lastname`, `_email`, `_emailconfirm`, `_phone`
- `input[name="dwfrm_profile_login_password"]`, `_passwordconfirm`
- `input[name="dwfrm_login_username"]`, `dwfrm_login_password`
- Shipping: `dwfrm_singleshipping_shippingAddress_addressFields_firstName`, `_lastName`, `_address1`, `_address2`, `_city`, `_postal`, `_phone`, `dwfrm_singleshipping_shippingAddress_addressFields_states_state`, `..._country`
- Billing: `dwfrm_billing_billingAddress_addressFields_*`, `dwfrm_billing_billingAddress_email_emailAddress`
- Card: `dwfrm_billing_paymentMethods_creditCard_owner`, `_number`, `_expiration_month`, `_expiration_year`, `_cvn`, `_type`
- Guest checkout: `dwfrm_login_unregistered`
- Address book: `dwfrm_profile_address_addressid`, `dwfrm_profile_address_firstname`, etc.

Use `[name$="..."]` suffix matching so cartridge-renamed prefixes still hit.

### 6.5 PWA Kit selectors (`selectors/pwakit.json`)

React-controlled inputs. Match on `name` and `data-testid`:

- `input[name="email"]`, `input[name="password"]`, `input[name="firstName"]`, `input[name="lastName"]`, `input[name="phone"]`
- Address: `input[name="address1"]`, `input[name="address2"]`, `input[name="city"]`, `select[name="stateCode"]`, `input[name="postalCode"]`, `select[name="countryCode"]`
- Testids: `[data-testid="sf-checkout-shipping-address-form"]`, `sf-checkout-billing-address`, `sf-register-form`
- Credit card fields are typically `input[name="number"]`, `input[name="expiry"]` (MM/YY combined), `input[name="cvv"]`, `input[name="holder"]`
- **Critical:** React ignores `.value =` assignments. Use the native value setter trick (see §8.2).

### 6.6 Generic heuristics (`selectors/generic.json`) — fallback for all platforms

Scored matching over every `input, select, textarea` in the scope:

1. `autocomplete` attribute: `given-name`, `family-name`, `email`, `tel`, `address-line1/2`, `address-level1/2`, `postal-code`, `country`, `cc-number`, `cc-exp-month`, `cc-exp-year`, `cc-csc`, `cc-name`, `new-password`, `current-password`.
2. `name` / `id` token match (case-insensitive, split on `_-.[]`): `fname|firstname|first`, `lname|lastname|last`, `addr1|address1|street`, `zip|postal|postcode`, `cvv|cvc|cvn|securitycode`, etc.
3. `<label for>` text and `placeholder` text (English + a small multilingual list: DE/FR/ES/IT/NL/JA/KO/AR for "First name", "Postcode", etc.).
4. Shipping vs billing disambiguation: nearest ancestor with class/id/`data-*` containing `ship`, `bill`, `payment`.

Threshold: score ≥ 0.6 to fill; below that, list in `unresolved`.

### 6.7 Per-site overrides

`chrome.storage.local.overrides[hostname]` = partial selector map in the same JSON shape. Merged on top of the platform map at fill time. Options page provides a "Pick element" mode: click a field on the page, choose the logical name, and the override is saved.

---

## 7. Data

### 7.1 Country list (~25)

Group in the UI by region. Each entry in `countries.json` includes ISO code, dial code, address format, whether `state` is required, postal code regex, state code list (for SFRA/SG state dropdowns), and phone example strategy.

| Region | Countries |
|---|---|
| North America | US, CA, MX |
| South America | BR, AR |
| Europe | GB, DE, FR, IT, ES, NL |
| APAC | AU, NZ, JP, KR, SG, IN |
| Middle East | AE, SA, QA, IL |
| Africa | ZA, NG |

Address-format notes to encode:
- **US/CA/AU/IN/BR/MX:** state/province code required; SFRA loads `#shippingState` options after country change.
- **GB:** no state; postcode with space (`SW1A 2AA`); SFRA GB forms often hide state.
- **DE/FR/IT/ES/NL:** 5-digit (NL: `1234 AB`); no state, but SFRA may show a text input.
- **JP:** postal `123-4567`, prefecture as state, address order is reversed in native forms — supply Latin-script addresses since storefronts are usually configured that way.
- **KR:** 5-digit postal code; province/city.
- **AE/QA/SA:** postal code optional or absent — fill with a known-valid value where the validator expects one (SA uses 5-digit + 4 additional; UAE has none — use `00000` only if the form requires it and document that AvaTax accepts it).
- **SG:** 6-digit postal, no state.
- **IL:** 7-digit postal.

### 7.2 Addresses (`addresses.json`)

Each country gets 2–3 addresses. Rules:

- Use **real, deliverable, public addresses** — government buildings, universities, museums, central post offices, flagship retail stores, hotels. Never private residences.
- Every address record has a `verified` block: `{ avatax: 'pass'|'corrected'|'fail'|null, googleAddressValidation: 'pass'|'corrected'|'fail'|null, verifiedOn: 'YYYY-MM-DD', notes }`.
- Store both the input form and the validator-normalized form (e.g. AvaTax returns `ST` not `Street`, ZIP+4). Prefer filling the normalized form so the validator returns "no change".
- Address lines are ASCII where possible; include a `unicode` variant for JP/KR for projects that need it.

Starter candidates (all must be run through `scripts/verify-addresses.md` before being marked verified):

| Country | Candidate |
|---|---|
| US | 1 Apple Park Way, Cupertino, CA 95014 · 1600 Amphitheatre Pkwy, Mountain View, CA 94043 · 20 W 34th St, New York, NY 10001 |
| CA | 100 Queen St W, Toronto, ON M5H 2N2 |
| GB | 10 Downing St, London SW1A 2AA · Bennett's Hill, Birmingham B2 5RS |
| DE | Platz der Republik 1, 11011 Berlin |
| FR | 5 Avenue Anatole France, 75007 Paris |
| AU | Bennelong Point, Sydney NSW 2000 |
| JP | 1-1 Chiyoda, Chiyoda-ku, Tokyo 100-8111 |
| SG | 1 Fullerton Square, Singapore 049178 |

Claude Code should propose the remaining candidates and leave `verified: null` until the owner runs the verification procedure.

### 7.3 Verification procedure (`scripts/verify-addresses.md`)

1. **AvaTax:** use the AvaTax sandbox `POST /api/v2/addresses/resolve` (or the SFCC Avalara cartridge's address validation in a sandbox site). Record whether the response `validatedAddresses[0]` equals the input (pass) or differs (corrected → store the corrected version as canonical).
2. **Google Address Validation API:** `POST https://addressvalidation.googleapis.com/v1:validateAddress`. Require `verdict.addressComplete == true`, `verdict.validationGranularity` of `PREMISE` or `SUB_PREMISE`, no `hasReplacedComponents`.
3. Record results in `addresses.json`. Re-verify annually.

The extension never calls these APIs itself.

### 7.4 Names and identities (`names.json`, `generator.js`)

- 40 first names + 40 last names per script group (Latin default; optional JP/KO/AR pools). Names are ASCII-safe and free of apostrophes/hyphens by default (many SFCC regex validators reject them); a "stress mode" toggle adds `O'Brien`, `Smith-Jones`, `José`, `Müller` for validation testing.
- **Email:** `{prefix}+{yyyymmdd-hhmmss}@{domain}`; defaults `qa` / `example.com`, configurable. Guarantees uniqueness so registration never fails on duplicate account.
- **Password:** default `Test1234!` style generator satisfying SFRA defaults (min 8, upper, lower, digit, special). Configurable pattern.
- **Card holder:** `firstName lastName`.
- Identity is generated once per fill and reused across shipping/billing/card so the order looks coherent.

### 7.5 Phones (`phone.js`)

- Use `libphonenumber-js` `getExampleNumber(country, examples)` for a guaranteed-valid mobile number, then `format('E.164')` or `format('NATIONAL')` per the toggle.
- Strip formatting characters when the target input has `inputmode="numeric"` or a `maxlength` shorter than the formatted string.
- SFRA's default phone regex is US-centric; for non-US countries prefer national format without spaces. Expose a per-site override for "phone style".

### 7.6 Test cards (`cards.json`)

All entries are from vendor public test-card documentation. **Claude Code must re-verify each against the current vendor docs** and add the doc URL to each record. Include `brand`, `number`, `expiry` (month/year), `cvv`, `holder` default, `expectedResult` (approved / declined / 3DS challenge), and `notes`.

| Vendor | Starter cards | Notes |
|---|---|---|
| Adyen | Visa 4111 1111 1111 1111, MC 5555 4444 3333 1111, Amex 3700 0000 0000 002; exp 03/2030, CVC 737 (Amex 7373) | Drop-in/Components render secured fields in iframes — see §9 |
| Authorize.net | Visa 4007 0000 0000 0027, 4111 1111 1111 1111, MC 5424 0000 0000 0015, Amex 3700 0000 0000 0002, Discover 6011 0000 0000 0012; any future exp, any CVV | Sandbox only; ZIP 46282 triggers declines in some setups — document |
| Stripe | 4242 4242 4242 4242 (approve), 4000 0025 0000 3155 (3DS), 4000 0000 0000 0002 (decline) | Stripe Elements = iframes |
| Braintree / PayPal | 4111 1111 1111 1111, 5555 5555 5555 4444, 3782 822463 10005 | Hosted Fields = iframes |
| Cybersource | 4111 1111 1111 1111, 5555 5555 5555 4444, 3782 822463 10005 | Flex Microform = iframe |
| Worldpay | 4444 3333 2222 1111, 5555 5555 5555 4444 | |
| Checkout.com | 4242 4242 4242 4242, 4543 4740 0224 9996 (3DS) | Frames = iframes |
| Klarna | No card; documents sandbox test personas per country | Store as "instructions" type |
| Apple Pay | No fillable card. Requires Apple sandbox tester account + test cards in Wallet | Store as "instructions" type; extension fills contact/shipping only |
| Google Pay | Test mode returns dummy tokens; no fillable card | Same |

Also include: an "expired" card and a "declined" card per vendor where documented, so QA can test error states from the same menu.

---

## 8. Fill Engine (`fill.js`)

### 8.1 Ordering and async sequencing

1. Resolve all fields for scope.
2. Fill in this order: identity → email/password → **country** → *await state options* → state → address lines → city → postal → phone → billing "same as shipping" → billing (only if not same) → card.
3. **Country → state wait:** after setting country and dispatching `change`, poll (max 1500 ms, 50 ms interval) until `#shippingState`/`#billingState` has `options.length > 1` or the select is removed/hidden. SFRA fetches state options via `Checkout-UpdateStateOptions` (or re-renders from a country→states map). SiteGenesis reloads via `Address-GetStates`-style AJAX. PWA Kit re-renders synchronously.
4. If the state select never populates, fall back to typing the state code into a text input if one exists, else record `skipped`.

### 8.2 Setting values correctly

```js
function setNativeValue(el, value) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
              : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);            // bypasses React's tracked setter
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
```

- Focus the element before setting and dispatch `blur` after, so SFRA's jQuery validation (`.is-invalid` toggling on blur/change) and SG's `validate.js` run.
- Checkboxes/radios: set `checked` then dispatch `click` + `change` (SFRA's `#shippingAsBilling` handler listens to `change`; PWA Kit to `click`).
- `<select>` with the country: match by `value` first (ISO code), then by option text (some sites use names). Same for state: match `value` then text, then a code↔name map from `countries.json`.
- Combined expiry inputs (`MM/YY`, `MM / YYYY`): detect from `placeholder`/`maxlength` and format accordingly.
- Card number masking (SFRA's Cleave.js on `#cardNumber`): set raw digits, dispatch `input`; Cleave reformats. Verify the hidden `#cardType` updated; if not, set it from the BIN.
- Skip `disabled`, `readonly`, `type=hidden` (except `cardType`), and elements with `offsetParent === null` unless the scope explicitly targets a collapsed section — then click the section's toggle first (e.g. SFRA billing address "edit" button, guest-checkout "Checkout as guest" reveal).

### 8.3 Performance budget

- Content script at load: register one `chrome.runtime.onMessage` listener, nothing else.
- All selector maps and data are loaded via `import` of bundled JSON (static, cached by the browser).
- Detection: one `querySelectorAll('input,select,textarea')` per fill, cap at 500 elements, then map lookups. Target < 20 ms detection, < 50 ms fill on a checkout page.
- Batch DOM writes; no per-field `await` except the state reload.
- No MutationObserver, no polling when idle.
- `libphonenumber-js` is imported lazily on first phone fill and cached.

---

## 9. Hosted Payment Fields (iframes)

Adyen, Stripe, Braintree, Cybersource, and Checkout.com render card inputs inside cross-origin iframes.

Approach:

1. `all_frames: true` + host permissions for known vendor iframe origins (`*://*.adyen.com/*`, `*://checkoutshopper-*.adyen.com/*`, `*://js.stripe.com/*`, `*://*.braintreegateway.com/*`, `*://*.cardinalcommerce.com/*`, `*://flex.cybersource.com/*`, `*://*.checkout.com/*`). The content script then also runs inside those frames.
2. The background broadcasts `FILL` to all frames of the tab; each frame fills what it recognizes (the Adyen frame sees only a card-number input; it fills that). Use `chrome.tabs.sendMessage(tabId, msg)` without `frameId` so every frame receives it.
3. Selector map `hosted.json` covers each vendor's inner-frame inputs (e.g. Adyen `input[data-fieldtype="encryptedCardNumber"]`, Stripe `input[name="cardnumber"]`, Braintree `#credit-card-number`).
4. Some vendors (Adyen secured fields notably) validate keystroke-by-keystroke and reject synthetic `input` events. Fallback path: simulate typing with `KeyboardEvent`s per character; if still rejected, the popup shows the card details with a one-click **Copy** button per field and a "paste manually" note. This fallback must exist from phase 4 onward.
5. Frames report results back with their `frame` identifier so the popup shows "Card number: filled (Adyen frame)".

Document clearly in README that iframe filling is best-effort and vendor changes can break it.

---

## 10. Triggers and UX

- **Toolbar popup:** full control panel. Result panel after fill lists filled / skipped / unresolved with the selector used — this doubles as a debugging aid for creating overrides.
- **Context menu:** right-click anywhere → SFCC Autofill ▸ submenu. Uses last popup settings; country and vendor submenus allow one-off changes.
- **Keyboard shortcuts:** `commands` in manifest, user-remappable at `chrome://extensions/shortcuts`.
- **Badge:** after a fill, show a green badge with the count of filled fields for 3 s; red with `!` if unresolved > 0.
- **Notifications:** none by default (noisy); optional toggle.

---

## 11. Manifest (target)

```json
{
  "manifest_version": 3,
  "name": "SFCC QA Autofill",
  "version": "0.1.0",
  "description": "One-click test data for SFRA, SiteGenesis and PWA Kit storefront forms.",
  "permissions": ["contextMenus", "storage", "activeTab", "scripting"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "src/background.js", "type": "module" },
  "action": { "default_popup": "src/popup/popup.html", "default_icon": "src/icons/icon48.png" },
  "options_page": "src/options/options.html",
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["src/content/content.js"],
    "all_frames": true,
    "run_at": "document_idle"
  }],
  "commands": {
    "fill-all":  { "suggested_key": { "default": "Ctrl+Shift+F", "mac": "Command+Shift+F" }, "description": "Fill all fields" },
    "fill-card": { "suggested_key": { "default": "Ctrl+Shift+K", "mac": "Command+Shift+K" }, "description": "Fill card only" }
  },
  "browser_specific_settings": { "gecko": { "id": "sfcc-qa-autofill@local" } },
  "icons": { "16": "src/icons/icon16.png", "48": "src/icons/icon48.png", "128": "src/icons/icon128.png" }
}
```

Content scripts in MV3 cannot use ES `import` directly; either bundle `content/*.js` into one file with esbuild, or list the files in `js` in dependency order. Prefer the esbuild bundle step (`npm run bundle`) but keep committed bundled output in `dist/` so load-unpacked works without running anything. Users who prefer no build load `dist/`.

---

## 12. Testing

### 12.1 Unit (Vitest, jsdom)
- `detect.js`: each selector map resolves every logical field against its fixture; generic heuristics score fixtures correctly; shipping/billing disambiguation.
- `fill.js`: native setter fires React tracked-value updates (fixture with a React-like `_valueTracker`); event order; state-wait resolves and times out correctly; expiry formatting variants.
- `generator.js`: unique emails; passwords match policy; phones valid for all 25 countries in both formats.
- `data`: schema validation for all JSON; every country has ≥ 2 addresses; every card number passes Luhn.

### 12.2 Fixture E2E (Playwright, loads the unpacked extension)
Static HTML replicas in `test/fixtures/`:
- `sfra-register.html`, `sfra-login.html`, `sfra-checkout-shipping.html` (with a mock country→state script), `sfra-checkout-billing.html`, `sfra-address-book.html`, `sfra-payment-instruments.html`, `sfra-guest-checkout.html`
- `sg-register.html`, `sg-checkout-single-shipping.html`, `sg-billing.html`
- `pwa-register.html`, `pwa-checkout.html` (real React via CDN so the setter trick is genuinely tested)
- `hosted-adyen-like.html` with a same-origin iframe stand-in

Assertions: all fields filled, no `.is-invalid`, state select populated, `FillResult.unresolved` empty, fill duration under budget.

### 12.3 Manual matrix (owner, on real sandboxes)

| Page | SFRA | SiteGenesis | PWA Kit |
|---|---|---|---|
| Registration | | | |
| Login | | | |
| My Account → Add address | | | |
| My Account → Add payment | | | |
| Cart → Checkout as guest | | | |
| Checkout shipping (each of 5 sample countries) | | | |
| Checkout billing (same-as / different) | | | |
| Payment (each configured vendor) | | | |
| Mobile emulation (iPhone / Pixel presets) | | | |
| Firefox desktop | | | |

Record results in `README.md` "Tested on" section.

---

## 13. Implementation Phases

Each phase ends with passing tests and a load-unpacked-able `dist/`.

### Phase 0 — Scaffold (½ day)
- Repo layout, manifest, icons, esbuild bundle script, README with install steps.
- Popup with a static "Fill" button that sends a message; content script logs it. Context menu and shortcuts wired.
- **Done when:** extension loads in Chrome and Firefox, clicking Fill logs in the page console.

### Phase 1 — Fill engine + SFRA (2 days)
- `platform.js`, `detect.js` with `sfra.json`, `fill.js` with native setter, event dispatch, country→state wait, collapsed-section reveal.
- `generator.js` for names/email/password; `countries.json` and `addresses.json` for US, CA, GB, DE, AU (5 countries).
- Unit tests + SFRA fixtures.
- **Done when:** SFRA registration, address book, guest checkout shipping + billing fill cleanly with no validation errors on the fixtures.

### Phase 2 — Phones + full country set (1 day)
- Vendor `libphonenumber-js`, `phone.js`, format toggle.
- Remaining 20 countries in `countries.json` with address format rules; candidate addresses with `verified: null`.
- `scripts/verify-addresses.md`. Owner runs AvaTax + Google verification and marks records.
- **Done when:** every country produces a valid phone in both formats; owner has verified ≥ 1 address per country.

### Phase 3 — SiteGenesis + PWA Kit (1.5 days)
- `sitegenesis.json`, `pwakit.json`, fixtures for both, React fixture proving the setter trick.
- Generic heuristics + multilingual label list.
- **Done when:** all three platform fixture suites pass; unknown-platform fixture fills via heuristics.

### Phase 4 — Cards + hosted fields (1.5 days)
- `cards.json` with verified doc links; vendor picker in popup and context submenu; expired/declined variants.
- `frames.js`, `hosted.json`, host permissions, per-character typing fallback, Copy buttons fallback.
- Instruction-type entries for Apple Pay / Google Pay / Klarna rendered in popup.
- **Done when:** SFRA native card form + at least one same-origin iframe fixture fill; copy fallback works.

### Phase 5 — Options, overrides, polish (1 day)
- Options page: per-host overrides with "Pick element", defaults, custom addresses, import/export.
- Result panel, badge, stress-mode names, "Fill login with last registered".
- Performance check against budget on a heavy fixture; Firefox for Android temporary-add-on smoke test.
- **Done when:** manual matrix in §12.3 has been run on at least one SFRA sandbox and one SG sandbox.

Estimated total: ~7–8 working days for a first usable version.

---

## 14. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Storefront customizations rename fields | Suffix-matching selectors, generic heuristics, per-host overrides with element picker |
| Vendor iframe hardening breaks card fill | Typing fallback + Copy buttons; iframe selectors isolated in `hosted.json` for quick patching |
| Address validators change normalization | `verified` metadata with dates; annual re-verify; store validator-normalized form |
| SFRA phone regex rejects international formats | Per-site phone style override; national format default for non-US |
| Content script on `<all_urls>` feels heavy | Zero idle work; user can narrow `matches` to sandbox domains in manifest |
| Firefox MV3 differences (`scripting`, background as event page) | Keep background stateless; test in Firefox each phase |
| PWA Kit upgrades change testids | Prefer `name` attributes over testids; heuristics as safety net |

---

## 15. Open Items for the Owner

1. Confirm the email domain and password policy defaults to bake in.
2. Provide sandbox URLs (SFRA, SG, PWA Kit) for the manual matrix.
3. Confirm which payment cartridges are actually in use so Phase 4 prioritizes their iframe selectors.
4. Run the address verification procedure after Phase 2 and commit the results.
5. Decide whether the content script should match `<all_urls>` or a list of sandbox domains.

---

## 16. Instructions for Claude Code

- Work phase by phase in the order above; do not start Phase N+1 until Phase N's "Done when" is met and committed.
- Keep everything runnable with zero build: commit `dist/` output alongside `src/`.
- Do not fabricate address verification results — leave `verified: null` and list candidates for the owner.
- Cite the vendor documentation URL for every test card in `cards.json` and note the date checked.
- Write fixtures from your knowledge of the SFRA `app_storefront_base` templates (`registration.isml`, `shippingAddress.isml`, `billing.isml`, `creditCardForm.isml`, `addressForm.isml`), SiteGenesis `app_storefront_core` forms, and PWA Kit retail react app components; when unsure of an exact ID, add both plausible variants to the selector list rather than guessing one.
- Every commit must leave `npm test` green.
- Keep the README current: install, shortcuts, adding a per-site override, adding a country, adding a card, known limitations (Apple Pay, hosted iframes).
