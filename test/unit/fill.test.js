import { describe, it, expect, beforeEach } from 'vitest';
import { loadFixture, loadMaps, countryMeta, buildProfile } from './helpers.js';
import '../../src/lib/generator.js';
import '../../src/content/detect.js';
import '../../src/content/fill.js';

const { buildFieldMap, applyProfile, fillUtil } = globalThis.SFCCAF;
const maps = loadMaps();

// Mirror of the fixture's stripped <script>: async country -> state reload.
function wireStates(countryId, stateId, states, delay = 60) {
  const country = document.getElementById(countryId);
  country.addEventListener('change', () => {
    const state = document.getElementById(stateId);
    setTimeout(() => {
      if (!states[country.value]) {
        state.closest('.form-group').setAttribute('style', 'display:none');
        state.innerHTML = '<option value=""></option>';
        return;
      }
      state.closest('.form-group').removeAttribute('style');
      state.innerHTML =
        '<option value="">Select...</option>' +
        Object.entries(states[country.value])
          .map(([code, name]) => `<option value="${code}">${name}</option>`)
          .join('');
    }, delay);
  });
}

const STATES = {
  US: { CA: 'California', NY: 'New York' },
  AU: { NSW: 'New South Wales', VIC: 'Victoria' },
};

describe('SFRA checkout end-to-end fill', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('fills shipping + contact + card, waits for the state reload, honors same-as-shipping', async () => {
    loadFixture('sfra-checkout.html');
    wireStates('shippingCountry', 'shippingState', STATES);
    wireStates('billingCountry', 'billingState', STATES);

    const US = countryMeta('US');
    const profile = buildProfile();
    const { fields, unresolved } = buildFieldMap('all', maps, 'sfra', US, document);
    expect(unresolved).toEqual([]);

    const result = await applyProfile({
      scope: 'all', fields, profile, countryMeta: US,
      options: { billingSameAsShipping: true }, frameLabel: 'top',
    });

    // shipping
    expect(document.getElementById('shippingFirstName').value).toBe(profile.firstName);
    expect(document.getElementById('shippingCountry').value).toBe('US');
    expect(document.getElementById('shippingState').value).toBe('CA');
    expect(document.getElementById('shippingAddressOne').value).toBe('1 Apple Park Way');
    expect(document.getElementById('shippingAddressCity').value).toBe('Cupertino');
    expect(document.getElementById('shippingZipCode').value).toBe('95014');
    expect(document.getElementById('shippingPhoneNumber').value).toBe(profile.phone);

    // billing: same as shipping -> address skipped, contact info still filled
    expect(document.getElementById('shippingAsBilling').checked).toBe(true);
    expect(document.getElementById('billingFirstName').value).toBe('');
    expect(document.getElementById('email').value).toBe(profile.email);
    expect(document.getElementById('phoneNumber').value).toBe(profile.phone);
    expect(result.skipped.some((s) => s.field === 'billing.firstName' && /same as shipping/.test(s.reason))).toBe(true);

    // card (Adyen defaults: 4111..., 03/2030, cvc 737)
    expect(document.getElementById('cardOwner').value).toBe(profile.card.holder);
    expect(document.getElementById('cardNumber').value).toBe('4111111111111111');
    expect(document.getElementById('expirationMonth').value).toBe('3'); // matched via alternates
    expect(document.getElementById('expirationYear').value).toBe('2030');
    expect(document.getElementById('securityCode').value).toBe('737');
    expect(document.getElementById('cardType').value).toBe('Visa'); // hidden input set from BIN

    const filledNames = result.filled.map((f) => f.field);
    expect(filledNames).toContain('shipping.state');
    expect(filledNames).toContain('card.number');
  });

  it('fills a distinct billing address when same-as-shipping is off', async () => {
    loadFixture('sfra-checkout.html');
    wireStates('shippingCountry', 'shippingState', STATES);
    wireStates('billingCountry', 'billingState', STATES);

    const US = countryMeta('US');
    const profile = buildProfile({
      settings: { billingSameAsShipping: false },
      billingRecord: { id: 'b', label: 'b', address1: '20 W 34th St', city: 'New York', state: 'NY', postalCode: '10001' },
    });
    const { fields } = buildFieldMap('all', maps, 'sfra', US, document);
    await applyProfile({
      scope: 'all', fields, profile, countryMeta: US,
      options: { billingSameAsShipping: false }, frameLabel: 'top',
    });

    expect(document.getElementById('shippingAsBilling').checked).toBe(false);
    expect(document.getElementById('billingAddressOne').value).toBe('20 W 34th St');
    expect(document.getElementById('billingState').value).toBe('NY');
    expect(document.getElementById('billingZipCode').value).toBe('10001');
  });

  it('GB: state select disappears after country change and is skipped cleanly', async () => {
    loadFixture('sfra-checkout.html');
    wireStates('shippingCountry', 'shippingState', STATES); // GB not in STATES -> hides select

    const GB = countryMeta('GB');
    const profile = buildProfile({ settings: { country: 'GB' } });
    const { fields } = buildFieldMap('shipping', maps, 'sfra', GB, document);
    const result = await applyProfile({
      scope: 'shipping', fields, profile, countryMeta: GB,
      options: { billingSameAsShipping: true }, frameLabel: 'top',
    });

    expect(document.getElementById('shippingCountry').value).toBe('GB');
    expect(document.getElementById('shippingZipCode').value).toBe('SW1A 2AA');
    expect(result.skipped.some((s) => s.field === 'shipping.state' && /removed|hidden|no states/.test(s.reason))).toBe(true);
  });

  it('state wait times out gracefully when options never load', async () => {
    loadFixture('sfra-checkout.html'); // no wireStates: options never populate

    const US = countryMeta('US');
    const profile = buildProfile();
    const { fields } = buildFieldMap('shipping', maps, 'sfra', US, document);
    const result = await applyProfile({
      scope: 'shipping', fields, profile, countryMeta: US,
      options: { billingSameAsShipping: true }, frameLabel: 'top', stateWaitMs: 120,
    });
    expect(result.skipped.some((s) => s.field === 'shipping.state' && /no option/.test(s.reason))).toBe(true);
    // everything else still filled
    expect(document.getElementById('shippingAddressCity').value).toBe('Cupertino');
  });

  it('fill (excluding the state wait) stays within the performance budget', async () => {
    loadFixture('sfra-register.html');
    const US = countryMeta('US');
    const profile = buildProfile();
    const { fields } = buildFieldMap('registration', maps, 'sfra', US, document);
    const t0 = performance.now();
    await applyProfile({
      scope: 'registration', fields, profile, countryMeta: US,
      options: { billingSameAsShipping: true }, frameLabel: 'top',
    });
    // Plan budget is <150ms in-browser; jsdom is slower, keep a guard rail.
    expect(performance.now() - t0).toBeLessThan(500);
    expect(document.getElementById('registration-form-email').value).toBe(profile.email);
    expect(document.getElementById('registration-form-password-confirm').value).toBe(profile.password);
  });
});

describe('value-setting primitives', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('dispatches input, change and blur in order', () => {
    document.body.innerHTML = '<input id="x" type="text">';
    const el = document.getElementById('x');
    const events = [];
    for (const type of ['input', 'change', 'blur']) {
      el.addEventListener(type, () => events.push(type));
    }
    fillUtil.fillText(el, 'hello');
    expect(el.value).toBe('hello');
    expect(events).toEqual(['input', 'change', 'blur']);
  });

  it('select matching falls back from value to option text', () => {
    document.body.innerHTML = `
      <select id="s">
        <option value="">--</option>
        <option value="opt-us">United States</option>
      </select>`;
    const el = document.getElementById('s');
    const ok = fillUtil.setSelectValue(el, { value: 'US', text: 'United States' });
    expect(ok).toBe(true);
    expect(el.value).toBe('opt-us');
  });

  it('typeInto types per character with key events', async () => {
    document.body.innerHTML = '<input id="t" type="text">';
    const el = document.getElementById('t');
    let keydowns = 0;
    let inputs = 0;
    el.addEventListener('keydown', () => keydowns++);
    el.addEventListener('input', () => inputs++);
    const ok = await fillUtil.typeInto(el, '4242');
    expect(ok).toBe(true);
    expect(el.value).toBe('4242');
    expect(keydowns).toBe(4);
    expect(inputs).toBe(4);
  });

  it.each([
    ['MM/YY', '5', '03/30'],
    ['MM / YY', '7', '03 / 30'],
    ['MM/YYYY', '7', '03/2030'],
    ['MM / YYYY', '9', '03 / 2030'],
    ['', '4', '0330'],
  ])('expiry formatting: placeholder %s maxlength %s -> %s', (placeholder, maxlength, expected) => {
    document.body.innerHTML = `<input id="e" placeholder="${placeholder}" maxlength="${maxlength}">`;
    const card = { month: '03', year: '2030', yearShort: '30' };
    expect(fillUtil.formatExpiry(document.getElementById('e'), card)).toBe(expected);
  });

  it('phone falls back to compact digits for constrained inputs', async () => {
    document.body.innerHTML = `
      <div class="registration">
        <input id="registration-form-phone" type="tel" maxlength="10">
      </div>`;
    // maxlength 10 < "(408) 555-1234".length -> nationalCompact
    const US = countryMeta('US');
    const profile = buildProfile();
    const fields = { phone: [document.getElementById('registration-form-phone')] };
    await applyProfile({
      scope: 'registration', fields, profile, countryMeta: US,
      options: {}, frameLabel: 'top',
    });
    expect(document.getElementById('registration-form-phone').value).toBe('4085551234');
  });
});

describe('React controlled inputs (PWA Kit)', () => {
  it('setNativeValue updates real React state where a plain .value write cannot', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const React = (await import('react')).default;
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');

    document.body.innerHTML = '<div id="root"></div>';
    let observed = '';
    function App() {
      const [value, setValue] = React.useState('');
      observed = value;
      return React.createElement('input', {
        id: 'controlled',
        value,
        onChange: (e) => setValue(e.target.value),
      });
    }
    const root = createRoot(document.getElementById('root'));
    await act(async () => { root.render(React.createElement(App)); });

    const input = document.getElementById('controlled');
    await act(async () => { fillUtil.setNativeValue(input, '4111111111111111'); });

    expect(observed).toBe('4111111111111111'); // React state actually updated
    expect(input.value).toBe('4111111111111111');
    await act(async () => { root.unmount(); });
  });
});
