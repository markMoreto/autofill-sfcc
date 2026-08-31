// Shared test utilities: fixture loading, data loading, source loading.
// The extension source files are classic IIFE scripts that attach to
// globalThis.SFCCAF — importing them in vitest executes them in the jsdom env.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd(); // vitest runs from the repo root

// jsdom lacks CSS.escape in some versions.
if (typeof globalThis.CSS === 'undefined') globalThis.CSS = {};
if (typeof globalThis.CSS.escape !== 'function') {
  globalThis.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

export function readJSON(relPath) {
  return JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'));
}

export function loadFixture(name) {
  const html = readFileSync(join(ROOT, 'test/fixtures', name), 'utf8');
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1]
    // Fixture <script> blocks are for the Playwright/browser path; jsdom tests
    // attach their own mocks explicitly.
    .replace(/<script>[\s\S]*?<\/script>/g, '');
  document.body.innerHTML = body;
}

export function loadMaps(override = null) {
  return {
    sfra: readJSON('src/data/selectors/sfra.json'),
    sitegenesis: readJSON('src/data/selectors/sitegenesis.json'),
    pwakit: readJSON('src/data/selectors/pwakit.json'),
    generic: readJSON('src/data/selectors/generic.json'),
    hosted: readJSON('src/data/selectors/hosted.json'),
    override,
  };
}

export function countryMeta(code) {
  const { countries } = readJSON('src/data/countries.json');
  return countries.find((c) => c.code === code);
}

export function addressFor(code, index = 0) {
  const { addresses } = readJSON('src/data/addresses.json');
  return addresses[code][index];
}

const baseSettings = {
  country: 'US', vendor: 'adyen', cardId: '', profileMode: 'registered',
  phoneFormat: 'national', billingSameAsShipping: true,
  emailPrefix: 'qa', emailDomain: 'mailinator.com', password: '',
  stressNames: false, namePool: 'latin', lastRegistered: null,
};

export function buildProfile(patch = {}) {
  const settings = { ...baseSettings, ...(patch.settings || {}) };
  const meta = countryMeta(settings.country);
  return globalThis.SFCCAF.generator.buildProfile({
    scope: patch.scope || 'all',
    countryMeta: meta,
    addressRecord: patch.addressRecord || addressFor(settings.country),
    billingRecord: patch.billingRecord || null,
    names: readJSON('src/data/names.json'),
    cardsData: readJSON('src/data/cards.json'),
    phoneNumbers: patch.phoneNumbers || { e164: '+14085551234', national: '(408) 555-1234', nationalCompact: '4085551234' },
    settings,
    now: patch.now,
  });
}
