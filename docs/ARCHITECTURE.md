# Architecture

Read this before changing anything structural. The design goals, in order:
**zero-build load-unpacked**, **zero idle cost on pages**, **no runtime network**,
**easy to patch when storefronts/vendors change** (data over code).

## Component overview

```
                      ┌────────────────────────────────────────────┐
 popup / context menu │ background (service worker / event page)   │
 / keyboard command ──► doFill(tabId, {scope, ...})                │
                      │  1. read settings (chrome.storage.local)   │
                      │  2. load bundled JSON (fetch extension URL)│
                      │  3. generate Profile (lib/generator.js,    │
                      │     lib/phone.js + libphonenumber)         │
                      │  4. broadcast FILL to ALL frames of tab    │
                      │  5. aggregate FILL_RESULT msgs → badge,    │
                      │     popup result panel                     │
                      └───────────────┬────────────────────────────┘
                                      │ FILL {profile, maps, countryMeta, options}
              ┌───────────────────────┼──────────────────────────┐
              ▼                       ▼                          ▼
      top frame (storefront)   vendor iframe (adyen…)      other iframes
      platform.js  → sfra/sg/  frames.js matches host      no match → fill
      detect.js    → FieldMap  pattern → fill card         nothing, report
      fill.js      → apply     fields only (typing         nothing
      profile, report result   simulation), report
```

### Why generation lives in the background (deviation from the original plan)

The plan sketched data/generation inside the content script. Moving it to the
background means:

- Content scripts stay tiny (4 small files) and do **zero work at page load**
  beyond registering one `onMessage` listener. No JSON parsing, no libphonenumber
  (~176 KB) on every page of every site.
- One code path for popup, context menu and shortcuts.
- The FILL message is self-contained: profile + selector maps + country metadata.
  Every frame can act on it without further round trips.

### Why there is no bundler (deviation from the original plan)

The plan allowed an optional esbuild step with committed `dist/`. Instead:

- Content scripts are classic scripts listed in dependency order in
  `manifest.json` (`platform.js → detect.js → fill.js → frames.js → content.js`).
  Each attaches to `globalThis.SFCCAF`.
- The background is cross-browser without a bundle: Chrome runs
  `src/background.js` as a classic service worker which `importScripts()`s the
  libs; Firefox loads the whole `background.scripts` list as an event page
  (the `importScripts` call is skipped because the globals already exist).
- Bundled JSON is read with `fetch(chrome.runtime.getURL(...))` from extension
  contexts (background/popup/options) — allowed without `web_accessible_resources`,
  cached, and never a network request.

One source tree, loadable as-is. There is nothing to build, ever. The only
"generated" artifacts are `src/lib/libphonenumber.min.js` and
`src/data/phone-examples.json` (re-created by `npm run vendor:phone` after a
dependency upgrade) and the icons (`npm run icons`).

## Message contract

```ts
// background → all frames
interface FillMessage {
  type: 'FILL';
  fillId: string;                    // correlates FILL_RESULT messages
  scope: 'all'|'address'|'shipping'|'billing'|'card'|'registration'|'login'|'contact';
  options: { phoneFormat, billingSameAsShipping, profileMode };
  profile: Profile;                  // fully generated: identity, email, password,
                                     // phones (all formats), address, billing, card
  countryMeta: CountryMeta;          // entry from countries.json
  maps: { sfra, sitegenesis, pwakit, generic, hosted, override };
}

// each frame → background
interface FillResultMessage {
  type: 'FILL_RESULT';
  fillId: string;
  result: {
    platform: 'sfra'|'sitegenesis'|'pwakit'|'unknown'|`hosted:${vendor}`;
    isTop: boolean; frame: string;
    filled:  Array<{ field, selector, frame }>;
    skipped: Array<{ field, reason }>;
    unresolved: string[];            // expected-but-missing logical fields
    durationMs: number;
  };
}
```

The background collects `FILL_RESULT`s for a `fillId` (quiet-period 400 ms,
hard cap 4 s to cover the state-reload wait) and aggregates them for the popup
and badge. Frames that found nothing report empty `unresolved` so stray ad
iframes never poison the aggregate.

Other messages: `DO_FILL` (popup → background), `START_PICKER`
(popup → background → top frame), `SAVE_OVERRIDE` (picker → background).

## Field detection (src/content/detect.js)

All selector knowledge lives in **data**, not code: `src/data/selectors/*.json`.

Logical field vocabulary: top-level identity (`firstName`, `email`,
`password`, `loginEmail`…), `address.*` (account address book), `shipping.*`,
`billing.*` (+ `billing.sameAsShipping`, `billing.email`), `card.*`
(`expMonth`/`expYear` or combined `expiry`).

Resolution runs in **three passes** over the scope's field list so a fuzzy
match can never steal an element from an exact one:

1. per-host **override** map (from settings),
2. **platform** map (sfra/sitegenesis/pwakit),
3. **generic heuristics** — every `input/select/textarea` (capped at 500) is
   scored: `autocomplete` attribute = 1.0, name/id token = 0.8,
   label/placeholder/aria-label text = 0.6 (multilingual list); threshold 0.6.
   Shipping vs billing is disambiguated by the nearest ancestor whose
   class/id/data-* contains a container hint (`ship`, `bill`, `payment`,
   translations). An address block with no hint is treated as shipping.

Each element is claimed at most once. `unresolved` lists required fields
missing from a group that *is* on the page (respecting country rules: no state
expected for GB, no postal for QA/AE…).

## Fill engine (src/content/fill.js)

- `setNativeValue` uses the prototype value setter so React (PWA Kit)
  registers the change, then dispatches `input` + `change`; text fills wrap it
  with `focus`/`blur` so SFRA jQuery validation and SG validate.js run.
  Proven against real React 18 in `test/unit/fill.test.js`.
- Order: identity → email/password → per address group: country → **await
  state options** (poll ≤1.5 s for the select to repopulate, degrade to text
  input, or disappear) → state → lines/city/postal → phone → billing
  same-as-shipping → billing → card.
- Selects match by option value, then visible text, then alternates
  (state code ↔ name from `countryMeta.states`; `03` ↔ `3` for months).
- Combined expiry inputs are formatted from `placeholder`/`maxlength`
  (`MM/YY`, `MM / YYYY`, `MMYY`…).
- Card number is set as raw digits (input masks like SFRA's Cleave.js
  reformat on `input`); the hidden `#cardType` is set from the BIN.
- Phone falls back to compact national digits when the input has
  `inputmode="numeric"` or a short `maxlength`.
- Hidden/disabled/readonly fields are skipped with a reason — except
  collapsed sections listed under a platform map's `reveals`, which
  `content.js` clicks open before detection.

## Hosted payment iframes (src/content/frames.js)

`hosted.json` maps frame-host regexes → vendor → inner-frame selectors.
The content script runs in every frame (`all_frames: true`); a frame whose
hostname matches a vendor fills only card fields, using per-character
`KeyboardEvent` typing when `typingSimulation` is set. Failure is reported per
field and the popup always offers Copy buttons as the manual fallback.

## Performance budget

- Page load: register one message listener. Nothing else. No MutationObserver,
  no polling, ever.
- Fill: one `querySelectorAll` (≤500 elements) + map lookups; batched writes;
  the only awaits are the state reload and reveal expansion.
- Unit test guards the fill path; the e2e asserts the full checkout fill
  (including two mocked 80 ms state AJAX reloads) under 550 ms.

## Storage layout (chrome.storage.local)

One key, `settings` — defaults in `src/lib/data.js`. Notable members:
`overrides` (per-host selector maps), `customAddresses` (per-country),
`lastRegistered` (credentials replayed by scope `login`). The options page
exports/imports this object verbatim for team sharing.
