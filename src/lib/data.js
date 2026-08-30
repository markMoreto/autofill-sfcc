// Bundled-data loader shared by the background worker, popup and options page.
// Classic script (no modules) so the same file works as a Chrome service-worker
// import and a Firefox event-page script. Everything hangs off globalThis.SFCCAF.
// All reads are chrome-extension:// fetches of files in src/data/ — the
// extension performs no network requests at runtime.
(() => {
  const g = globalThis;
  g.SFCCAF = g.SFCCAF || {};

  const cache = new Map();
  function loadJSON(path) {
    if (!cache.has(path)) {
      cache.set(
        path,
        fetch(chrome.runtime.getURL(path)).then((r) => {
          if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
          return r.json();
        })
      );
    }
    return cache.get(path);
  }

  g.SFCCAF.data = {
    countries: () => loadJSON('src/data/countries.json'),
    addresses: () => loadJSON('src/data/addresses.json'),
    names: () => loadJSON('src/data/names.json'),
    cards: () => loadJSON('src/data/cards.json'),
    phoneExamples: () => loadJSON('src/data/phone-examples.json'),
    selectors: async () => ({
      sfra: await loadJSON('src/data/selectors/sfra.json'),
      sitegenesis: await loadJSON('src/data/selectors/sitegenesis.json'),
      pwakit: await loadJSON('src/data/selectors/pwakit.json'),
      generic: await loadJSON('src/data/selectors/generic.json'),
      hosted: await loadJSON('src/data/selectors/hosted.json'),
    }),
  };

  // Settings live in chrome.storage.local. Everything has a default so the
  // extension works on first run with zero configuration.
  g.SFCCAF.defaultSettings = {
    country: 'US',
    vendor: 'adyen',
    cardId: '',              // specific card within the vendor; '' = first approved card
    profileMode: 'registered', // 'registered' | 'guest'
    phoneFormat: 'national',   // 'national' | 'e164'
    billingSameAsShipping: true,
    emailPrefix: 'qa',
    emailDomain: 'example.com',
    password: '',              // '' = generate one per fill (policy-safe)
    stressNames: false,
    namePool: 'latin',         // 'latin' | 'ja' | 'ko' | 'ar'
    addressId: '',             // preferred bundled/custom address id; '' = first for country
    overrides: {},             // { [hostname]: partial selector map }
    customAddresses: {},       // { [countryCode]: [address records] }
    lastRegistered: null,      // { email, password } — reused by scope 'login'
  };

  g.SFCCAF.getSettings = async function getSettings() {
    const stored = await chrome.storage.local.get('settings');
    return Object.assign({}, g.SFCCAF.defaultSettings, stored.settings || {});
  };

  g.SFCCAF.saveSettings = async function saveSettings(patch) {
    const current = await g.SFCCAF.getSettings();
    const next = Object.assign({}, current, patch);
    await chrome.storage.local.set({ settings: next });
    return next;
  };
})();
