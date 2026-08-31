# Maintenance recipes

Everything that changes routinely lives in `src/data/*.json` — most maintenance
is a data edit plus `npm test`. Keep [docs/ARCHITECTURE.md](ARCHITECTURE.md)
open for context. **Every recipe ends with `npm test` green; the data tests
enforce most of the rules below automatically.**

## Adding a country

1. Add an entry to `src/data/countries.json`:
   - `code` (ISO 3166-1 alpha-2), `name`, `region` (grouping in the UI —
     keep entries of one region adjacent), `dialCode`;
   - `postal`: `required`, `regex` (anchor it), `example` (must match the regex —
     tested);
   - `state`: `mode` (`code` when storefront selects expect `CA`/`NSW`,
     `name` when they expect `Maharashtra`, `none` when there is no state
     field), `required`;
   - `states`: code → name map for the codes used by this country's addresses
     (used to match select options by value *or* text).
2. Add **≥2 addresses** (tested) to `src/data/addresses.json` — see next recipe.
3. Run `npm run vendor:phone` — it regenerates `src/data/phone-examples.json`
   and fails loudly if libphonenumber has no example number for the new code.
4. `npm test`. The phone suite automatically validates the new country in both
   formats; the data suite validates postal/state consistency.

## Adding or verifying an address

Rules (enforced by tests where possible):

- Real, deliverable, **public** addresses only — government buildings,
  universities, museums, landmarks, hotels. Never private residences.
- Unique `id`, human `label`, `address1`, `city`; `state` when the country
  requires it; `postalCode` matching the country regex.
- New addresses ship with `verified: { avatax: null, googleAddressValidation:
  null, verifiedOn: null, notes: "candidate" }`. **Never** record a `pass`
  without actually running [scripts/verify-addresses.md](../scripts/verify-addresses.md)
  — the test suite requires a `verifiedOn` date on any non-null status.
- When a validator returns a corrected/normalized form (ZIP+4, `ST` for
  `Street`…), replace the record's fields with the normalized form and note the
  original in `notes` — re-validation should return "no change".
- JP/KR records may carry a `unicode` variant (native-script lines) for
  projects configured that way.

Per-project addresses that shouldn't live in the repo go into **Options →
Custom addresses** instead (and can be shared via settings export).

## Adding or updating a test card

`src/data/cards.json`. Rules:

- Numbers must come from the vendor's **public test documentation** — set
  `docUrl` and update `docCheckedOn` (both tested) whenever you touch a vendor.
- Every number must pass Luhn (tested). `expectedResult` ∈ `approved` /
  `declined` / `3ds-challenge` / `expired`; keep at least one `approved` card
  per vendor (tested). Add declined/3DS variants so QA can trigger error states
  from the same menu.
- Vendors without a fillable card (wallets, Klarna) use
  `"type": "instructions"` + an `instructions` string — the popup renders it.
- When a vendor changes its hosted-fields DOM, that is a *selector* problem,
  not a card problem → `src/data/selectors/hosted.json` (below).

## When a storefront renames fields (selector maps)

Priority order at fill time: per-host override → platform map → generic
heuristics.

- **One project only** → don't touch the repo. Use the popup: *Map a field* →
  pick the logical name → click the input. Or edit Options → Per-site selector
  overrides by hand. Export settings to share with the team.
- **A new SFRA/SG/PWA version changes markup for everyone** → edit
  `src/data/selectors/{sfra,sitegenesis,pwakit}.json`. Add the new selector to
  the *front* of the field's list, keep the old ones behind it (lists are
  ordered, first match wins). Prefer `[name$="…"]` suffix matching over ids —
  survives cartridge prefix renames and SG's random id suffixes.
- Update/extend the fixture in `test/fixtures/` to cover the new markup and
  assert it in `test/unit/detect.test.js`.
- The `reveals` block in a platform map lists selectors clicked to expand
  collapsed sections (e.g. SFRA billing "edit") before detection.

## When a payment vendor changes its hosted iframe

Everything lives in `src/data/selectors/hosted.json`:

- `hostPatterns`: regexes tested against the iframe's hostname (keep them
  anchored — `\.adyen\.com$` — so lookalike domains never match; tested).
- `fields`: selectors *inside* the frame, per logical card field.
- `typingSimulation: true` for vendors that reject synthetic `input` events.

If filling still fails after a patch, that's expected sometimes — the popup's
Copy buttons are the supported fallback. Update the README's Known limitations
if a vendor becomes permanently unfillable.

## Adding a name pool / stress names

`src/data/names.json`. Default pools must stay ASCII-safe with no
apostrophes/hyphens (tested) — many SFCC regex validators reject them; that's
what the `stress` pool is for (mixed in only when the popup toggle is on).

## Upgrading libphonenumber-js

```bash
npm install libphonenumber-js@latest
npm run vendor:phone   # refreshes src/lib/libphonenumber.min.js + phone-examples.json
npm test               # phone suite revalidates every country
```

## Upgrading @playwright/test

The version is pinned **exactly** because each Playwright release requires a
specific Chromium revision. After bumping it, run
`npx playwright install chromium` before `npm run test:e2e`.

## Release checklist

1. `npm test` — all green.
2. `npx playwright install chromium && npm run test:e2e` — real-browser pass.
3. Load unpacked in Chrome *and* temporary add-on in Firefox; run one manual
   fill on a storefront page (matrix in README "Tested on").
4. Bump `version` in `manifest.json`.
5. Commit; teammates just `git pull` and click **Reload** on the extensions page.
