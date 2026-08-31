# Address verification procedure (owner-run)

Goal: every address in `src/data/addresses.json` should pass AvaTax address
resolution and the Google Address Validation API **without correction**, so
storefront address validation never blocks a QA flow. The extension itself
never calls these APIs — this is a manual, periodic procedure (re-verify
annually; `verifiedOn` records when).

Do not mark a record `pass` without actually running the checks below — the
test suite rejects a non-null status with no `verifiedOn` date, and fabricated
results defeat the point of the field.

## 1. AvaTax

Use an AvaTax **sandbox** account (or the Avalara SFCC cartridge's address
validation on a sandbox site).

```bash
curl -s -u "$AVATAX_ACCOUNT:$AVATAX_LICENSE" \
  "https://sandbox-rest.avatax.com/api/v2/addresses/resolve" \
  -H 'Content-Type: application/json' -d '{
    "line1": "1 Apple Park Way",
    "city": "Cupertino",
    "region": "CA",
    "postalCode": "95014",
    "country": "US"
  }'
```

Interpretation:

- `validatedAddresses[0]` equals the input (modulo case) → record `"avatax": "pass"`.
- It differs (ZIP+4 added, `Way` → `WAY`, etc.) → **replace the record's fields
  with the returned form**, note the original in `verified.notes`, re-run until
  it returns unchanged, then record `"pass"`.
- `messages` contains an error / unresolvable → `"fail"` — replace the address
  with a better candidate.

AvaTax fully validates US/CA; for other countries it may only standardize.
Record whatever it reports; Google is the stronger signal outside NA.

## 2. Google Address Validation API

Enable the Address Validation API on a Google Cloud project.

```bash
curl -s "https://addressvalidation.googleapis.com/v1:validateAddress?key=$GOOGLE_API_KEY" \
  -H 'Content-Type: application/json' -d '{
    "address": {
      "regionCode": "US",
      "locality": "Cupertino",
      "administrativeArea": "CA",
      "postalCode": "95014",
      "addressLines": ["1 Apple Park Way"]
    }
  }'
```

Required for `"googleAddressValidation": "pass"`:

- `result.verdict.addressComplete == true`
- `result.verdict.validationGranularity` is `PREMISE` or `SUB_PREMISE`
- no `hasReplacedComponents`, no unconfirmed components

If Google returns a normalized form, adopt it (same rule as AvaTax) and record
`"corrected"` → then `"pass"` once it round-trips cleanly.

Note: the API does not support every country (e.g. Qatar at last check). When
unsupported, leave the field `null` and note it — AvaTax result stands alone.

## 3. Record the result

For each checked record set:

```json
"verified": {
  "avatax": "pass",
  "googleAddressValidation": "pass",
  "verifiedOn": "2026-09-15",
  "notes": "normalized to ZIP+4 by AvaTax (was 95014)"
}
```

Then `npm test` (the data suite validates the shape) and commit. The popup
shows ✓ next to verified addresses.

## Country-specific expectations

- **AE / QA**: no postal codes exist. The extension fills `00000` only when a
  form requires the field — confirm your storefront and validator accept that,
  note the outcome in `verified.notes`.
- **SA**: 5-digit code, optionally `NNNNN-NNNN` — record what the validator returns.
- **AR**: prefer the full CPA (`C1064AAB`) if the validator accepts it; plain
  4-digit legacy codes otherwise.
- **JP/KR**: verify the Latin-script form (that's what storefronts are usually
  configured for); the `unicode` variant is informational.
