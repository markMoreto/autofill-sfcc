// Background: builds the fill payload (data + generated profile) and
// broadcasts it to every frame of the active tab. Content scripts only
// detect + fill; all data and generation live here so page-side idle cost
// stays at zero.
//
// Cross-browser loading: Chrome runs this file alone as a classic service
// worker (importScripts pulls the libs); Firefox loads the whole
// background.scripts list from the manifest, so the libs are already present.
/* global SFCCAF, chrome */
if (typeof importScripts === 'function' && !(globalThis.SFCCAF && globalThis.SFCCAF.data)) {
  importScripts('lib/libphonenumber.min.js', 'lib/data.js', 'lib/phone.js', 'lib/generator.js');
}

const MENU_ROOT = 'sfcc-autofill';
const pendingFills = new Map(); // fillId -> { results, timer, resolve }

// ---------------------------------------------------------------- menus

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  const ctx = { contexts: ['page', 'editable', 'frame'] };
  chrome.contextMenus.create({ id: MENU_ROOT, title: 'SFCC Autofill', ...ctx });
  chrome.contextMenus.create({ id: 'fill-all', parentId: MENU_ROOT, title: 'Fill everything', ...ctx });
  chrome.contextMenus.create({ id: 'fill-registration', parentId: MENU_ROOT, title: 'Fill registration (new email)', ...ctx });
  chrome.contextMenus.create({ id: 'fill-login', parentId: MENU_ROOT, title: 'Fill login (last registered)', ...ctx });

  const addrParent = chrome.contextMenus.create({ id: 'fill-address', parentId: MENU_ROOT, title: 'Fill address only', ...ctx });
  const { countries } = await SFCCAF.data.countries();
  let region = null;
  for (const c of countries) {
    if (c.region !== region) {
      region = c.region;
      chrome.contextMenus.create({ id: `region-${region}`, parentId: addrParent, title: `— ${region} —`, enabled: false, ...ctx });
    }
    chrome.contextMenus.create({ id: `fill-address:${c.code}`, parentId: addrParent, title: c.name, ...ctx });
  }

  const cardParent = chrome.contextMenus.create({ id: 'fill-card', parentId: MENU_ROOT, title: 'Fill card only', ...ctx });
  const cardsData = await SFCCAF.data.cards();
  for (const v of cardsData.vendors) {
    chrome.contextMenus.create({ id: `fill-card:${v.id}`, parentId: cardParent, title: v.name, ...ctx });
  }
}

chrome.runtime.onInstalled.addListener(() => { buildMenus(); });
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(() => { buildMenus(); });

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id == null) return;
  const id = String(info.menuItemId);
  if (id === 'fill-all') doFill(tab.id, { scope: 'all' });
  else if (id === 'fill-registration') doFill(tab.id, { scope: 'registration' });
  else if (id === 'fill-login') doFill(tab.id, { scope: 'login' });
  else if (id.startsWith('fill-address:')) doFill(tab.id, { scope: 'address', country: id.split(':')[1] });
  else if (id.startsWith('fill-card:')) doFill(tab.id, { scope: 'card', vendor: id.split(':')[1] });
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  if (command === 'fill-all') doFill(tab.id, { scope: 'all' });
  if (command === 'fill-card') doFill(tab.id, { scope: 'card' });
});

// ---------------------------------------------------------------- fill

async function buildPayload(scope, settings, hostname) {
  const [countriesData, addressesData, names, cardsData, phoneExamples, maps] =
    await Promise.all([
      SFCCAF.data.countries(),
      SFCCAF.data.addresses(),
      SFCCAF.data.names(),
      SFCCAF.data.cards(),
      SFCCAF.data.phoneExamples(),
      SFCCAF.data.selectors(),
    ]);

  const countryMeta = countriesData.countries.find((c) => c.code === settings.country)
    || countriesData.countries[0];

  const pool = [
    ...(settings.customAddresses[countryMeta.code] || []),
    ...(addressesData.addresses[countryMeta.code] || []),
  ];
  if (!pool.length) throw new Error(`No addresses for country ${countryMeta.code}`);
  const addressRecord = pool.find((a) => a.id === settings.addressId) || pool[0];
  // Distinct billing address (when "same as shipping" is off) — second in pool if any.
  const billingRecord = settings.billingSameAsShipping ? null : (pool[1] || pool[0]);

  const phoneNumbers = SFCCAF.phone.generate(countryMeta.code, phoneExamples);
  const profile = SFCCAF.generator.buildProfile({
    scope, countryMeta, addressRecord, billingRecord, names, cardsData, phoneNumbers, settings,
  });

  return {
    type: 'FILL',
    fillId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scope,
    options: {
      phoneFormat: settings.phoneFormat,
      billingSameAsShipping: settings.billingSameAsShipping,
      profileMode: settings.profileMode,
    },
    profile,
    countryMeta,
    maps: {
      sfra: maps.sfra,
      sitegenesis: maps.sitegenesis,
      pwakit: maps.pwakit,
      generic: maps.generic,
      hosted: maps.hosted,
      override: (hostname && settings.overrides[hostname]) || null,
    },
  };
}

function collectResults(fillId) {
  return new Promise((resolve) => {
    const entry = { results: [], resolve, timer: null };
    pendingFills.set(fillId, entry);
    const finish = () => {
      pendingFills.delete(fillId);
      resolve(entry.results);
    };
    // Hard cap 4s (a state-options reload can take ~1.5s); once results start
    // arriving, resolve 400ms after the last one.
    entry.finish = finish;
    entry.timer = setTimeout(finish, 4000);
  });
}

function aggregate(payload, frameResults) {
  const top = frameResults.find((r) => r.isTop);
  const agg = {
    platform: top ? top.platform : (frameResults[0] && frameResults[0].platform) || 'unknown',
    filled: [], skipped: [], unresolved: [],
    durationMs: Math.max(0, ...frameResults.map((r) => r.durationMs || 0)),
    frames: frameResults.length,
    profileSummary: {
      email: payload.profile.email,
      password: payload.profile.password,
      phone: payload.profile.phone,
      card: payload.profile.card
        ? { vendorName: payload.profile.card.vendorName, brand: payload.profile.card.brand, number: payload.profile.card.number, combined: payload.profile.card.combined, cvv: payload.profile.card.cvv, holder: payload.profile.card.holder }
        : null,
      cardInstructions: payload.profile.cardInstructions,
    },
  };
  for (const r of frameResults) {
    agg.filled.push(...(r.filled || []));
    agg.skipped.push(...(r.skipped || []));
    agg.unresolved.push(...(r.unresolved || []));
  }
  return agg;
}

async function doFill(tabId, patch) {
  const settings = await SFCCAF.getSettings();
  if (patch.country) settings.country = patch.country;
  if (patch.vendor) settings.vendor = patch.vendor;
  Object.assign(settings, patch.settings || {});
  const scope = patch.scope || 'all';

  const tab = await chrome.tabs.get(tabId);
  let hostname = '';
  try { hostname = new URL(tab.url).hostname; } catch { /* chrome:// etc. */ }

  const payload = await buildPayload(scope, settings, hostname);
  const collected = collectResults(payload.fillId);

  try {
    await chrome.tabs.sendMessage(tabId, payload); // no frameId -> all frames
  } catch (e) {
    pendingFills.get(payload.fillId)?.finish?.();
    return { error: 'No content script in this tab (chrome:// page, or reload the page after installing).', detail: String(e) };
  }

  const frameResults = await collected;
  const result = aggregate(payload, frameResults);

  // Remember credentials so "Fill login" can reuse them.
  if ((scope === 'all' || scope === 'registration') &&
      result.filled.some((f) => f.field === 'password')) {
    await SFCCAF.saveSettings({
      lastRegistered: { email: payload.profile.email, password: payload.profile.password },
    });
  }

  setBadge(tabId, result);
  return result;
}

function setBadge(tabId, result) {
  const bad = result.unresolved.length > 0;
  chrome.action.setBadgeBackgroundColor({ tabId, color: bad ? '#c0392b' : '#1e8e3e' });
  chrome.action.setBadgeText({ tabId, text: bad ? '!' : String(result.filled.length) });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 3000);
}

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'DO_FILL') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || tab.id == null) return sendResponse({ error: 'No active tab' });
      sendResponse(await doFill(tab.id, msg));
    })();
    return true; // async response
  }

  if (msg && msg.type === 'FILL_RESULT') {
    const entry = pendingFills.get(msg.fillId);
    if (entry) {
      entry.results.push(msg.result);
      clearTimeout(entry.timer);
      entry.timer = setTimeout(entry.finish, 400);
    }
    return false;
  }

  if (msg && msg.type === 'SAVE_OVERRIDE' && sender.tab) {
    // From the element picker: { hostname, field, selector }
    (async () => {
      const settings = await SFCCAF.getSettings();
      const overrides = settings.overrides || {};
      const host = overrides[msg.hostname] || { fields: {} };
      host.fields[msg.field] = [msg.selector, ...(host.fields[msg.field] || [])];
      overrides[msg.hostname] = host;
      await SFCCAF.saveSettings({ overrides });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg && msg.type === 'START_PICKER') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || tab.id == null) return sendResponse({ error: 'No active tab' });
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'PICKER', field: msg.field });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ error: String(e) });
      }
    })();
    return true;
  }
  return false;
});
