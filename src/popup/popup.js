// Popup: settings UI + fill trigger + result/debug panel. Settings persist in
// chrome.storage.local; the actual fill is orchestrated by the background so
// popup, context menu and keyboard shortcuts share one code path.
/* global chrome */
const $ = (id) => document.getElementById(id);

let countriesData, addressesData, cardsData, settings;

async function loadJSON(path) {
  const r = await fetch(chrome.runtime.getURL(path));
  return r.json();
}

async function init() {
  [countriesData, addressesData, cardsData] = await Promise.all([
    loadJSON('src/data/countries.json'),
    loadJSON('src/data/addresses.json'),
    loadJSON('src/data/cards.json'),
  ]);
  const stored = await chrome.storage.local.get('settings');
  settings = Object.assign(
    {
      country: 'US', vendor: 'adyen', cardId: '', profileMode: 'registered',
      phoneFormat: 'national', billingSameAsShipping: true, stressNames: false,
      addressId: '', overrides: {}, customAddresses: {},
    },
    stored.settings || {}
  );

  // Country select, grouped by region
  const countrySel = $('country');
  let group = null;
  for (const c of countriesData.countries) {
    if (!group || group.label !== c.region) {
      group = document.createElement('optgroup');
      group.label = c.region;
      countrySel.appendChild(group);
    }
    group.appendChild(new Option(c.name, c.code));
  }
  countrySel.value = settings.country;

  // Vendor select
  const vendorSel = $('vendor');
  for (const v of cardsData.vendors) vendorSel.appendChild(new Option(v.name, v.id));
  vendorSel.value = settings.vendor;

  $('profileMode').value = settings.profileMode;
  $('phoneFormat').value = settings.phoneFormat;
  $('billingSameAsShipping').checked = settings.billingSameAsShipping;
  $('stressNames').checked = settings.stressNames;

  refreshAddresses();
  refreshCards();
  refreshInstructions();

  // Picker field list
  const pickerSel = $('picker-field');
  const logicalFields = [
    'email', 'password', 'firstName', 'lastName', 'phone',
    'shipping.firstName', 'shipping.lastName', 'shipping.address1', 'shipping.address2',
    'shipping.city', 'shipping.state', 'shipping.postalCode', 'shipping.country', 'shipping.phone',
    'billing.firstName', 'billing.lastName', 'billing.address1', 'billing.city',
    'billing.state', 'billing.postalCode', 'billing.country', 'billing.phone', 'billing.email',
    'card.holder', 'card.number', 'card.expMonth', 'card.expYear', 'card.expiry', 'card.cvv',
  ];
  for (const f of logicalFields) pickerSel.appendChild(new Option(f, f));
}

function refreshAddresses() {
  const sel = $('address');
  sel.innerHTML = '';
  const pool = [
    ...((settings.customAddresses || {})[settings.country] || []),
    ...(addressesData.addresses[settings.country] || []),
  ];
  for (const a of pool) {
    const verified = a.verified && (a.verified.avatax === 'pass' || a.verified.googleAddressValidation === 'pass');
    sel.appendChild(new Option(`${a.label}${verified ? ' ✓' : ''}`, a.id));
  }
  if (settings.addressId && pool.some((a) => a.id === settings.addressId)) sel.value = settings.addressId;
  else settings.addressId = pool.length ? pool[0].id : '';
}

function refreshCards() {
  const sel = $('card');
  sel.innerHTML = '';
  const vendor = cardsData.vendors.find((v) => v.id === settings.vendor);
  if (!vendor || vendor.type === 'instructions') {
    sel.appendChild(new Option('— see instructions —', ''));
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const c of vendor.cards) {
    sel.appendChild(new Option(`${c.brand} ·${c.number.slice(-4)} (${c.expectedResult})`, c.id));
  }
  if (settings.cardId && vendor.cards.some((c) => c.id === settings.cardId)) sel.value = settings.cardId;
  else settings.cardId = vendor.cards[0].id;
}

function refreshInstructions() {
  const panel = $('instructions');
  const vendor = cardsData.vendors.find((v) => v.id === settings.vendor);
  if (vendor && vendor.type === 'instructions') {
    panel.hidden = false;
    panel.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = `${vendor.name}: ${vendor.instructions}`;
    const a = document.createElement('a');
    a.href = vendor.docUrl;
    a.target = '_blank';
    a.textContent = 'Vendor documentation';
    panel.append(p, a);
  } else {
    panel.hidden = true;
  }
}

async function save() {
  // Patch only popup-owned keys so Options-page edits (overrides, custom
  // addresses, defaults) made while the popup is open are never clobbered.
  const patch = {
    country: $('country').value,
    vendor: $('vendor').value,
    cardId: $('card').value,
    addressId: $('address').value,
    profileMode: $('profileMode').value,
    phoneFormat: $('phoneFormat').value,
    billingSameAsShipping: $('billingSameAsShipping').checked,
    stressNames: $('stressNames').checked,
  };
  Object.assign(settings, patch);
  const stored = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: Object.assign({}, stored.settings, patch) });
}

async function fill(scope) {
  await save();
  const result = await chrome.runtime.sendMessage({ type: 'DO_FILL', scope });
  showResult(result);
}

function showResult(result) {
  const panel = $('result');
  panel.hidden = false;
  const summary = $('result-summary');
  if (!result || result.error) {
    summary.innerHTML = `<span class="warn">${(result && result.error) || 'No response'}</span>`;
    return;
  }
  summary.innerHTML =
    `<span class="ok">${result.filled.length} filled</span> · ` +
    `${result.skipped.length} skipped · ` +
    `<span class="${result.unresolved.length ? 'warn' : ''}">${result.unresolved.length} unresolved</span>` +
    ` · ${result.platform} · ${result.durationMs} ms`;

  fillList('result-filled', `Filled (${result.filled.length})`,
    result.filled.map((f) => `${f.field} → ${f.selector}${f.frame !== 'top' ? ` [${f.frame}]` : ''}`));
  fillList('result-skipped', `Skipped (${result.skipped.length})`,
    result.skipped.map((s) => `${s.field}: ${s.reason}`));
  fillList('result-unresolved', `Unresolved (${result.unresolved.length})`, result.unresolved);

  showCardCopy(result.profileSummary);
}

function fillList(id, title, items) {
  const details = $(id);
  details.querySelector('summary').textContent = title;
  const ul = details.querySelector('ul');
  ul.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = item;
    li.appendChild(code);
    ul.appendChild(li);
  }
  details.open = id === 'result-unresolved' && items.length > 0;
}

// Copy buttons — the manual fallback for hardened hosted payment iframes.
function showCardCopy(profileSummary) {
  const panel = $('cardcopy');
  panel.innerHTML = '';
  if (!profileSummary) { panel.hidden = true; return; }
  const rows = [['Email', profileSummary.email], ['Password', profileSummary.password], ['Phone', profileSummary.phone]];
  if (profileSummary.card) {
    rows.push(
      [`Card (${profileSummary.card.vendorName} ${profileSummary.card.brand})`, profileSummary.card.number],
      ['Expiry', profileSummary.card.combined],
      ['CVV', profileSummary.card.cvv],
      ['Holder', profileSummary.card.holder],
    );
  }
  for (const [label, value] of rows) {
    if (!value) continue;
    const row = document.createElement('div');
    row.className = 'copyrow';
    const span = document.createElement('span');
    span.textContent = `${label}: ${value}`;
    const btn = document.createElement('button');
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(value);
      btn.textContent = '✓';
      setTimeout(() => (btn.textContent = 'Copy'), 1200);
    });
    row.append(span, btn);
    // Mailinator inboxes are public — link straight to the one this fill used,
    // so registration/order emails are one click away.
    const inboxUrl = mailinatorInboxUrl(value);
    if (label === 'Email' && inboxUrl) {
      const inbox = document.createElement('button');
      inbox.textContent = 'Inbox ↗';
      inbox.title = 'Open the public Mailinator inbox for this address';
      inbox.addEventListener('click', () => chrome.tabs.create({ url: inboxUrl }));
      row.appendChild(inbox);
    }
    panel.appendChild(row);
  }
  panel.hidden = rows.length === 0;
}

function mailinatorInboxUrl(email) {
  const m = /^([^@]+)@mailinator\.com$/i.exec(String(email || '').trim());
  return m ? `https://www.mailinator.com/v4/public/inboxes.jsp?to=${encodeURIComponent(m[1])}` : null;
}

// ---- wiring
$('country').addEventListener('change', () => { settings.country = $('country').value; settings.addressId = ''; refreshAddresses(); });
$('vendor').addEventListener('change', () => { settings.vendor = $('vendor').value; settings.cardId = ''; refreshCards(); refreshInstructions(); });
$('fill-all').addEventListener('click', () => fill('all'));
$('fill-address').addEventListener('click', () => fill('address'));
$('fill-card-btn').addEventListener('click', () => fill('card'));
$('fill-registration').addEventListener('click', () => fill('registration'));
$('fill-login').addEventListener('click', () => fill('login'));
$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('picker-field').addEventListener('change', () => { $('picker-start').disabled = !$('picker-field').value; });
$('picker-start').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'START_PICKER', field: $('picker-field').value });
  window.close(); // hand focus back to the page so the user can click the element
});

init();
