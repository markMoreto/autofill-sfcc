// Profile generation: one coherent identity per fill (name reused across
// shipping / billing / card holder). Pure functions — no chrome.* usage — so
// the same file runs in the background worker and in unit tests.
(() => {
  const g = globalThis;
  g.SFCCAF = g.SFCCAF || {};

  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rand(arr.length)];

  function timestamp(now) {
    const d = now || new Date();
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return (
      `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
      `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`
    );
  }

  // Satisfies the SFRA default policy: min 8 chars, upper, lower, digit, special.
  function generatePassword() {
    const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digit = '23456789';
    const special = '!@#$%';
    let out = pick(upper) + pick(lower) + pick(digit) + pick(special);
    const all = upper + lower + digit;
    while (out.length < 10) out += pick(all);
    return out;
  }

  function makeIdentity(names, settings) {
    const pool = names[settings.namePool] || names.latin;
    let first = pick(pool.first);
    let last = pick(pool.last);
    if (settings.stressNames && names.stress) {
      // In stress mode, mix in validation-hostile names half the time each.
      if (Math.random() < 0.5) first = pick(names.stress.first);
      if (Math.random() < 0.5) last = pick(names.stress.last);
    }
    return { firstName: first, lastName: last };
  }

  function makeEmail(settings, now) {
    return `${settings.emailPrefix}+${timestamp(now)}@${settings.emailDomain}`;
  }

  function luhnValid(number) {
    const digits = number.replace(/\D/g, '');
    let sum = 0;
    let dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = +digits[i];
      if (dbl) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      dbl = !dbl;
    }
    return digits.length >= 12 && sum % 10 === 0;
  }

  function cardBrandFromNumber(number) {
    if (/^4/.test(number)) return 'Visa';
    if (/^(5[1-5]|2[2-7])/.test(number)) return 'Master Card';
    if (/^3[47]/.test(number)) return 'Amex';
    if (/^6(011|5)/.test(number)) return 'Discover';
    return '';
  }

  function resolveCard(cardsData, vendorId, cardId) {
    const vendor = cardsData.vendors.find((v) => v.id === vendorId);
    if (!vendor) return { vendor: null, card: null, instructions: null };
    if (vendor.type === 'instructions') {
      return { vendor, card: null, instructions: vendor.instructions };
    }
    const card =
      (cardId && vendor.cards.find((c) => c.id === cardId)) ||
      vendor.cards.find((c) => c.expectedResult === 'approved') ||
      vendor.cards[0];
    return { vendor, card, instructions: null };
  }

  // "Any future date" cards get a fixed far-future expiry.
  function cardExpiry(card, now) {
    const d = now || new Date();
    const month = card.expiry.month || '03';
    const year = card.expiry.year || String(d.getFullYear() + 4);
    return {
      month,
      year,
      yearShort: year.slice(-2),
      combined: `${month}/${year.slice(-2)}`, // MM/YY, reformatted per-input at fill time
    };
  }

  function buildAddress(record, identity, countryMeta, phone) {
    if (!record) return null;
    const postal =
      record.postalCode ||
      (countryMeta.postal.required ? countryMeta.postal.example : '');
    return {
      firstName: identity.firstName,
      lastName: identity.lastName,
      address1: record.address1,
      address2: record.address2 || '',
      city: record.city,
      state: record.state || '',
      stateName: countryMeta.states[record.state] || record.state || '',
      postalCode: postal,
      country: countryMeta.code,
      countryName: countryMeta.name,
      phone,
    };
  }

  /**
   * Assemble the full fill profile.
   * @param {object} args
   *   countryMeta   entry from countries.json
   *   addressRecord chosen record from addresses.json / custom addresses
   *   billingRecord optional distinct billing address (used when billingSameAsShipping is off)
   *   names         names.json content
   *   cardsData     cards.json content
   *   phoneNumbers  { e164, national, nationalCompact } from SFCCAF.phone
   *   settings      resolved settings (see data.js defaults)
   *   now           Date, injectable for tests
   */
  g.SFCCAF.generator = {
    timestamp,
    generatePassword,
    luhnValid,
    cardBrandFromNumber,
    buildProfile(args) {
      const { countryMeta, addressRecord, billingRecord, names, cardsData, phoneNumbers, settings, now } = args;
      const identity = makeIdentity(names, settings);
      const phone =
        settings.phoneFormat === 'e164' ? phoneNumbers.e164 : phoneNumbers.national;

      let email = makeEmail(settings, now);
      let password = settings.password || generatePassword();
      if (args.scope === 'login' && settings.lastRegistered) {
        email = settings.lastRegistered.email;
        password = settings.lastRegistered.password;
      }

      const { vendor, card, instructions } = resolveCard(
        cardsData,
        settings.vendor,
        settings.cardId
      );

      const shipping = buildAddress(addressRecord, identity, countryMeta, phone);
      const billing = buildAddress(billingRecord || addressRecord, identity, countryMeta, phone);

      return {
        firstName: identity.firstName,
        lastName: identity.lastName,
        email,
        password,
        phone,
        phoneE164: phoneNumbers.e164,
        phoneNational: phoneNumbers.national,
        phoneNationalCompact: phoneNumbers.nationalCompact,
        address: shipping,
        billing,
        billingSameAsShipping: !!settings.billingSameAsShipping,
        card: card
          ? {
              holder: `${identity.firstName} ${identity.lastName}`,
              number: card.number,
              brand: card.brand,
              type: cardBrandFromNumber(card.number),
              cvv: card.cvv,
              ...cardExpiry(card, now),
              expectedResult: card.expectedResult,
              vendor: vendor.id,
              vendorName: vendor.name,
            }
          : null,
        cardInstructions: instructions,
      };
    },
  };
})();
