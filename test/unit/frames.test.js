// Hosted payment-iframe handling: vendor matching by frame hostname and
// card-field filling inside the frame.
import { describe, it, expect, beforeEach } from 'vitest';
import { loadMaps, buildProfile } from './helpers.js';
import '../../src/lib/generator.js';
import '../../src/content/detect.js';
import '../../src/content/fill.js';
import '../../src/content/frames.js';

const { hostedVendorForFrame, fillHostedFrame } = globalThis.SFCCAF;
const hosted = loadMaps().hosted;

describe('hostedVendorForFrame', () => {
  it.each([
    ['checkoutshopper-live.adyen.com', 'adyen'],
    ['checkoutshopper-test.adyen.com', 'adyen'],
    ['js.stripe.com', 'stripe'],
    ['assets.braintreegateway.com', 'braintree'],
    ['flex.cybersource.com', 'cybersource'],
    ['pay.checkout.com', 'checkoutcom'],
  ])('%s -> %s', (host, vendorId) => {
    expect(hostedVendorForFrame(hosted, host).id).toBe(vendorId);
  });

  it('unrelated hosts match no vendor', () => {
    expect(hostedVendorForFrame(hosted, 'www.example.com')).toBeNull();
    expect(hostedVendorForFrame(hosted, 'adyen.com.evil.io')).toBeNull();
  });
});

describe('fillHostedFrame', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('fills an Adyen-style card-number frame via typing simulation', async () => {
    document.body.innerHTML = '<input data-fieldtype="encryptedCardNumber" type="text">';
    const vendor = hostedVendorForFrame(hosted, 'checkoutshopper-test.adyen.com');
    const profile = buildProfile(); // adyen 4111111111111111
    const { filled, skipped } = await fillHostedFrame(vendor, profile, 'frame:adyen');
    expect(skipped).toEqual([]);
    expect(filled.map((f) => f.field)).toEqual(['card.number']);
    expect(document.querySelector('input').value).toBe('4111111111111111');
    expect(filled[0].frame).toBe('frame:adyen');
  });

  it('fills a Stripe-style combined frame (number + expiry + cvc)', async () => {
    document.body.innerHTML = `
      <input name="cardnumber" type="text">
      <input name="exp-date" placeholder="MM / YY" type="text">
      <input name="cvc" type="text">`;
    const vendor = hostedVendorForFrame(hosted, 'js.stripe.com');
    const profile = buildProfile({ settings: { vendor: 'stripe' } });
    const { filled } = await fillHostedFrame(vendor, profile, 'frame:stripe');
    expect(document.querySelector('[name="cardnumber"]').value).toBe('4242424242424242');
    expect(document.querySelector('[name="exp-date"]').value).toMatch(/^\d{2} \/ \d{2}$/);
    expect(document.querySelector('[name="cvc"]').value).toBe('123');
    expect(filled.length).toBe(3);
  });

  it('does nothing when the profile has no card (instruction vendors)', async () => {
    document.body.innerHTML = '<input data-fieldtype="encryptedCardNumber" type="text">';
    const vendor = hostedVendorForFrame(hosted, 'checkoutshopper-test.adyen.com');
    const profile = buildProfile({ settings: { vendor: 'applepay' } });
    const { filled } = await fillHostedFrame(vendor, profile, 'frame:adyen');
    expect(filled).toEqual([]);
    expect(document.querySelector('input').value).toBe('');
  });
});
