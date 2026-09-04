// Options page: defaults, per-host selector overrides, custom addresses,
// team export/import. Everything is stored under chrome.storage.local.settings.
/* global chrome */
const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  emailPrefix: 'qa', emailDomain: 'mailinator.com', emailStyle: 'prefix', password: '', namePool: 'latin',
  overrides: {}, customAddresses: {},
};

// Name pools come from names.json so adding a pool there is enough to list it here.
async function populateNamePools() {
  const sel = $('namePool');
  if (sel.options.length) return;
  const names = await (await fetch(chrome.runtime.getURL('src/data/names.json'))).json();
  for (const [key, pool] of Object.entries(names)) {
    if (key.startsWith('$') || key === 'stress' || !pool || !Array.isArray(pool.first)) continue;
    sel.appendChild(new Option(pool.label || key, key));
  }
}

async function load() {
  await populateNamePools();
  const stored = await chrome.storage.local.get('settings');
  const s = Object.assign({}, DEFAULTS, stored.settings || {});
  $('emailPrefix').value = s.emailPrefix;
  $('emailDomain').value = s.emailDomain;
  $('emailStyle').value = s.emailStyle;
  $('password').value = s.password;
  $('namePool').value = s.namePool;
  if (!$('namePool').value) $('namePool').value = 'latin';
  $('overrides').value = JSON.stringify(s.overrides, null, 2);
  $('customAddresses').value = JSON.stringify(s.customAddresses, null, 2);
}

function parseTextarea(id, errorId, validate) {
  $(errorId).textContent = '';
  try {
    const value = JSON.parse($(id).value || '{}');
    const problem = validate(value);
    if (problem) throw new Error(problem);
    return value;
  } catch (e) {
    $(errorId).textContent = String(e.message || e);
    return null;
  }
}

function validateOverrides(value) {
  if (typeof value !== 'object' || Array.isArray(value)) return 'Must be an object keyed by hostname';
  for (const [host, entry] of Object.entries(value)) {
    if (!entry || typeof entry.fields !== 'object') return `${host}: needs a "fields" object`;
    for (const [field, selectors] of Object.entries(entry.fields)) {
      if (!Array.isArray(selectors)) return `${host}.${field}: selectors must be an array`;
      for (const sel of selectors) {
        try { document.querySelector(sel); } catch { return `${host}.${field}: invalid selector "${sel}"`; }
      }
    }
  }
  return null;
}

function validateAddresses(value) {
  if (typeof value !== 'object' || Array.isArray(value)) return 'Must be an object keyed by country code';
  for (const [cc, list] of Object.entries(value)) {
    if (!Array.isArray(list)) return `${cc}: must be an array of address records`;
    for (const a of list) {
      for (const key of ['id', 'label', 'address1', 'city']) {
        if (!a[key]) return `${cc}: address missing "${key}"`;
      }
    }
  }
  return null;
}

async function save() {
  const overrides = parseTextarea('overrides', 'overrides-error', validateOverrides);
  const customAddresses = parseTextarea('customAddresses', 'custom-error', validateAddresses);
  if (overrides === null || customAddresses === null) return;
  const stored = await chrome.storage.local.get('settings');
  const settings = Object.assign({}, stored.settings, {
    emailPrefix: $('emailPrefix').value.trim() || 'qa',
    emailDomain: $('emailDomain').value.trim() || 'mailinator.com',
    emailStyle: $('emailStyle').value,
    password: $('password').value,
    namePool: $('namePool').value,
    overrides,
    customAddresses,
  });
  await chrome.storage.local.set({ settings });
  $('status').textContent = 'Saved';
  setTimeout(() => ($('status').textContent = ''), 1500);
}

$('save').addEventListener('click', save);

$('export').addEventListener('click', async () => {
  const stored = await chrome.storage.local.get('settings');
  const blob = new Blob([JSON.stringify(stored.settings || {}, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sfcc-qa-autofill-settings.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const settings = JSON.parse(await file.text());
    if (typeof settings !== 'object') throw new Error('Not a settings object');
    await chrome.storage.local.set({ settings });
    await load();
    $('status').textContent = 'Imported';
    setTimeout(() => ($('status').textContent = ''), 1500);
  } catch (err) {
    $('status').textContent = `Import failed: ${err.message}`;
  }
});

load();
