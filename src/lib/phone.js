// Phone generation on top of the vendored libphonenumber-js UMD bundle
// (globalThis.libphonenumber). Numbers come from the library's own example
// metadata, so isValid() is true by construction for every shipped country.
(() => {
  const g = globalThis;
  g.SFCCAF = g.SFCCAF || {};

  // examples: the trimmed examples.mobile.json object (country -> national number)
  g.SFCCAF.phone = {
    generate(countryCode, examples) {
      const lib = g.libphonenumber;
      if (!lib) throw new Error('libphonenumber bundle not loaded');
      const example = lib.getExampleNumber(countryCode, examples);
      if (!example) throw new Error(`No example phone number for ${countryCode}`);
      if (!example.isValid()) throw new Error(`Example number for ${countryCode} is not valid`);
      const national = example.format('NATIONAL');
      return {
        e164: example.number, // E.164, e.g. +14085551234
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
