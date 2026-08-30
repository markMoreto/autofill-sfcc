import { describe, it, expect, beforeEach } from 'vitest';
import { loadFixture, loadMaps, countryMeta } from './helpers.js';
import '../../src/content/detect.js';

const buildFieldMap = globalThis.SFCCAF.buildFieldMap;
const maps = loadMaps();
const US = countryMeta('US');
const GB = countryMeta('GB');

const idsOf = (fields, logical) => (fields[logical] || []).map((el) => el.id || el.name);

describe('SFRA detection', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('registration form resolves every logical field with no unresolved', () => {
    loadFixture('sfra-register.html');
    const { fields, unresolved } = buildFieldMap('registration', maps, 'sfra', US, document);
    expect(idsOf(fields, 'firstName')).toEqual(['registration-form-fname']);
    expect(idsOf(fields, 'lastName')).toEqual(['registration-form-lname']);
    expect(idsOf(fields, 'email')).toEqual(['registration-form-email']);
    expect(idsOf(fields, 'emailConfirm')).toEqual(['registration-form-email-confirm']);
    expect(idsOf(fields, 'phone')).toEqual(['registration-form-phone']);
    expect(idsOf(fields, 'password')).toEqual(['registration-form-password']);
    expect(idsOf(fields, 'passwordConfirm')).toEqual(['registration-form-password-confirm']);
    expect(unresolved).toEqual([]);
  });

  it('login scope resolves the login form, not the registration form', () => {
    loadFixture('sfra-register.html');
    const { fields } = buildFieldMap('login', maps, 'sfra', US, document);
    expect(idsOf(fields, 'loginEmail')).toEqual(['login-form-email']);
    expect(idsOf(fields, 'loginPassword')).toEqual(['login-form-password']);
  });

  it('checkout resolves shipping, billing, contact and card fields', () => {
    loadFixture('sfra-checkout.html');
    const { fields, unresolved } = buildFieldMap('all', maps, 'sfra', US, document);
    expect(idsOf(fields, 'shipping.firstName')).toEqual(['shippingFirstName']);
    expect(idsOf(fields, 'shipping.country')).toEqual(['shippingCountry']);
    expect(idsOf(fields, 'shipping.state')).toEqual(['shippingState']);
    expect(idsOf(fields, 'shipping.postalCode')).toEqual(['shippingZipCode']);
    expect(idsOf(fields, 'billing.address1')).toEqual(['billingAddressOne']);
    expect(idsOf(fields, 'billing.sameAsShipping')).toEqual(['shippingAsBilling']);
    expect(idsOf(fields, 'billing.email')).toEqual(['email']);
    expect(idsOf(fields, 'billing.phone')).toEqual(['phoneNumber']);
    expect(idsOf(fields, 'card.number')).toEqual(['cardNumber']);
    expect(idsOf(fields, 'card.expMonth')).toEqual(['expirationMonth']);
    expect(idsOf(fields, 'card.cvv')).toEqual(['securityCode']);
    expect(idsOf(fields, 'card.type')).toEqual(['cardType']); // hidden but allowed
    expect(unresolved).toEqual([]);
  });

  it('address book resolves the account address form', () => {
    loadFixture('sfra-address-book.html');
    const { fields, unresolved } = buildFieldMap('address', maps, 'sfra', US, document);
    expect(idsOf(fields, 'address.addressId')).toEqual(['addressId']);
    expect(idsOf(fields, 'address.firstName')).toEqual(['firstName']);
    expect(idsOf(fields, 'address.postalCode')).toEqual(['zipCode']);
    expect(idsOf(fields, 'account.setDefault')).toEqual(['setDefaultAddress']);
    expect(unresolved).toEqual([]);
  });
});

describe('SiteGenesis detection', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('registration resolves via dwfrm_* name suffixes despite random ids', () => {
    loadFixture('sg-register.html');
    const { fields, unresolved } = buildFieldMap('registration', maps, 'sitegenesis', US, document);
    expect(idsOf(fields, 'firstName')[0]).toMatch(/^dwfrm_profile_customer_firstname/);
    expect(idsOf(fields, 'email')[0]).toMatch(/^dwfrm_profile_customer_email_/);
    expect(idsOf(fields, 'emailConfirm')[0]).toMatch(/emailconfirm/);
    expect(idsOf(fields, 'password')[0]).toMatch(/login_password/);
    expect(unresolved).toEqual([]);
  });

  it('checkout resolves shipping, billing and card', () => {
    loadFixture('sg-checkout.html');
    const { fields, unresolved } = buildFieldMap('all', maps, 'sitegenesis', US, document);
    expect(idsOf(fields, 'shipping.address1')[0]).toMatch(/singleshipping.*address1/);
    expect(idsOf(fields, 'shipping.postalCode')[0]).toMatch(/postal/);
    expect(idsOf(fields, 'billing.email')[0]).toMatch(/email_emailAddress/);
    expect(idsOf(fields, 'billing.sameAsShipping')[0]).toMatch(/useAsBillingAddress/);
    expect(idsOf(fields, 'card.number')[0]).toMatch(/creditCard_number/);
    expect(idsOf(fields, 'card.type')[0]).toMatch(/creditCard_type/);
    expect(unresolved).toEqual([]);
  });
});

describe('PWA Kit detection', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('disambiguates shipping vs billing by testid containers', () => {
    loadFixture('pwa-checkout.html');
    const { fields } = buildFieldMap('shipping', maps, 'pwakit', US, document);
    const el = fields['shipping.firstName'][0];
    expect(el.closest('[data-testid="sf-checkout-shipping-address-form"]')).not.toBeNull();

    const billing = buildFieldMap('billing', maps, 'pwakit', US, document);
    const bEl = billing.fields['billing.firstName'][0];
    expect(bEl.closest('[data-testid="sf-checkout-billing-address"]')).not.toBeNull();
  });

  it('resolves the combined-expiry card form', () => {
    loadFixture('pwa-checkout.html');
    const { fields } = buildFieldMap('card', maps, 'pwakit', US, document);
    expect(fields['card.number'][0].name).toBe('number');
    expect(fields['card.expiry'][0].name).toBe('expiry');
    expect(fields['card.cvv'][0].name).toBe('securityCode');
    expect(fields['card.holder'][0].name).toBe('holder');
  });
});

describe('generic heuristics (unknown platform)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('resolves by autocomplete attributes, tokens and container hints', () => {
    loadFixture('generic-checkout.html');
    const { fields, unresolved } = buildFieldMap('all', maps, 'unknown', GB, document);
    expect(idsOf(fields, 'firstName')).toEqual(['fname']);
    expect(idsOf(fields, 'email')).toEqual(['contactemail']);
    expect(idsOf(fields, 'phone')).toEqual(['contactnum']);
    expect(idsOf(fields, 'shipping.address1')).toEqual(['street']);
    expect(idsOf(fields, 'shipping.postalCode')).toEqual(['pc']);
    expect(idsOf(fields, 'shipping.country')).toEqual(['nation']);
    // billing block disambiguated by the .billing-details container
    expect(idsOf(fields, 'billing.address1')).toEqual(['billstreet']);
    expect(idsOf(fields, 'billing.city')).toEqual(['billcity']);
    expect(idsOf(fields, 'billing.postalCode')).toEqual(['billzip']);
    // card via token matching (no autocomplete attributes present)
    expect(idsOf(fields, 'card.number')).toEqual(['pan']);
    expect(idsOf(fields, 'card.holder')).toEqual(['nameoncard']);
    expect(idsOf(fields, 'card.expiry')).toEqual(['ccexp']);
    expect(idsOf(fields, 'card.cvv')).toEqual(['cvc']);
    expect(unresolved).toEqual([]);
  });

  it('reports required-but-missing fields of a present group as unresolved', () => {
    document.body.innerHTML = `
      <div class="shipping-block">
        <input type="text" name="firstname">
        <input type="text" name="lastname">
        <input type="text" name="address1">
      </div>`;
    const { unresolved } = buildFieldMap('shipping', maps, 'unknown', US, document);
    expect(unresolved).toContain('shipping.city');
    expect(unresolved).toContain('shipping.postalCode');
    expect(unresolved).toContain('shipping.state');
  });

  it('per-host overrides win over the platform map', () => {
    loadFixture('sfra-checkout.html');
    document.body.insertAdjacentHTML('beforeend', '<input type="text" id="customZip">');
    const override = { fields: { 'shipping.postalCode': ['#customZip'] } };
    const { fields } = buildFieldMap('shipping', loadMaps(override), 'sfra', US, document);
    expect(idsOf(fields, 'shipping.postalCode')).toEqual(['customZip']);
  });

  it('skips disabled and readonly inputs', () => {
    document.body.innerHTML = `
      <input type="text" name="email" autocomplete="email" disabled>
      <input type="text" name="phone" autocomplete="tel" readonly>`;
    const { fields } = buildFieldMap('contact', maps, 'unknown', US, document);
    expect(fields.email).toBeUndefined();
    expect(fields.phone).toBeUndefined();
  });
});
