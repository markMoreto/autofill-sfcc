// Phone generation on top of the vendored libphonenumber-js UMD bundle
// (globalThis.libphonenumber). Numbers are derived from the library's own
// example metadata: the example's trailing digits are re-rolled so every fill
// gets a different number, and each candidate is re-validated with the
// library, so isValid() is true by construction for every shipped country.
(() => {
  const g = globalThis;
  g.SFCCAF = g.SFCCAF || {};

  const ATTEMPTS = 8;

  // Re-roll the last `width` national digits. Leading digits (area code,
  // mobile prefix) are what libphonenumber's patterns constrain, so trailing
  // variation keeps validity; we still validate and fall back to the example.
  function vary(lib, example, countryCode, random) {
    const national = String(example.nationalNumber);
    // NANP fictional block (555-01XX): keep it — only the last two digits vary.
    const width = /55501\d\d$/.test(national) ? 2 : Math.min(4, national.length - 3);
    if (width <= 0) return example;
    for (let i = 0; i < ATTEMPTS; i++) {
      let suffix = '';
      for (let j = 0; j < width; j++) suffix += String(Math.floor(random() * 10));
      const candidate = national.slice(0, national.length - width) + suffix;
      const parsed = lib.parsePhoneNumberFromString(candidate, countryCode);
      if (
        parsed &&
        parsed.isValid() &&
        parsed.countryCallingCode === example.countryCallingCode &&
        String(parsed.nationalNumber).length === national.length
      ) {
        return parsed;
      }
    }
    return example;
  }

  // examples: the trimmed examples.mobile.json object (country -> national number)
  // opts.vary: false returns the bare example (deterministic); opts.random: injectable RNG.
  g.SFCCAF.phone = {
    generate(countryCode, examples, opts = {}) {
      const lib = g.libphonenumber;
      if (!lib) throw new Error('libphonenumber bundle not loaded');
      const example = lib.getExampleNumber(countryCode, examples);
      if (!example) throw new Error(`No example phone number for ${countryCode}`);
      if (!example.isValid()) throw new Error(`Example number for ${countryCode} is not valid`);
      const number = opts.vary === false ? example : vary(lib, example, countryCode, opts.random || Math.random);
      const national = number.format('NATIONAL');
      return {
        e164: number.number, // E.164, e.g. +14085551234
        national,
        // Digits-only national form for inputs with numeric masks / short maxlength.
        // SFRA's default phone regex is US-centric, so compact national is the
        // safest cross-country default.
        nationalCompact: national.replace(/[^\d]/g, ''),
      };
    },
    isValid(number, countryCode) {
      const lib = g.libphonenumber;
      const parsed = lib.parsePhoneNumberFromString(number, countryCode);
      return !!parsed && parsed.isValid();
    },
  };
})();
