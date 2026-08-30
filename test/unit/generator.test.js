import { describe, it, expect } from 'vitest';
import { buildProfile } from './helpers.js';
import '../../src/lib/generator.js';

const gen = globalThis.SFCCAF.generator;

describe('email generation', () => {
  it('is unique per fill (timestamped to the millisecond)', () => {
    const a = buildProfile({ now: new Date(2026, 7, 31, 10, 0, 0, 1) });
    const b = buildProfile({ now: new Date(2026, 7, 31, 10, 0, 0, 2) });
    expect(a.email).not.toBe(b.email);
    expect(a.email).toMatch(/^qa\+\d{8}-\d{9}@example\.com$/);
  });
});

describe('password generation', () => {
  it('satisfies the SFRA default policy', () => {
    for (let i = 0; i < 50; i++) {
      const pw = gen.generatePassword();
      expect(pw.length).toBeGreaterThanOrEqual(8);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/\d/);
      expect(pw).toMatch(/[!@#$%]/);
    }
  });

  it('uses the configured fixed password when set', () => {
    const p = buildProfile({ settings: { password: 'Fixed123!' } });
    expect(p.password).toBe('Fixed123!');
  });
});

describe('profile coherence', () => {
  it('reuses one identity across shipping, billing and card holder', () => {
    const p = buildProfile();
    expect(p.card.holder).toBe(`${p.firstName} ${p.lastName}`);
    expect(p.address.firstName).toBe(p.firstName);
    expect(p.billing.lastName).toBe(p.lastName);
  });

  it('fills address fields from the chosen record + country metadata', () => {
    const p = buildProfile();
    expect(p.address.address1).toBe('1 Apple Park Way');
    expect(p.address.state).toBe('CA');
    expect(p.address.stateName).toBe('California');
    expect(p.address.country).toBe('US');
    expect(p.address.countryName).toBe('United States');
  });

  it('default names are ASCII-safe', () => {
    for (let i = 0; i < 30; i++) {
      const p = buildProfile();
      expect(p.firstName).toMatch(/^[A-Za-z]+$/);
      expect(p.lastName).toMatch(/^[A-Za-z]+$/);
    }
  });
});

describe('login scope', () => {
  it('reuses the last registered credentials', () => {
    const p = buildProfile({
      scope: 'login',
      settings: { lastRegistered: { email: 'qa+123@example.com', password: 'Xy12345!' } },
    });
    expect(p.email).toBe('qa+123@example.com');
    expect(p.password).toBe('Xy12345!');
  });
});

describe('cards', () => {
  it('selects the first approved card of the vendor by default', () => {
    const p = buildProfile({ settings: { vendor: 'stripe' } });
    expect(p.card.number).toBe('4242424242424242');
    expect(p.card.vendorName).toBe('Stripe');
    expect(p.cardInstructions).toBeNull();
  });

  it('honors an explicit card choice (e.g. a decline card)', () => {
    const p = buildProfile({ settings: { vendor: 'stripe', cardId: 'stripe-decline' } });
    expect(p.card.number).toBe('4000000000000002');
    expect(p.card.expectedResult).toBe('declined');
  });

  it('"any future expiry" cards get a far-future date', () => {
    const p = buildProfile({ settings: { vendor: 'stripe' }, now: new Date(2026, 0, 1) });
    expect(+p.card.year).toBeGreaterThan(2026);
    expect(p.card.combined).toBe(`${p.card.month}/${p.card.yearShort}`);
  });

  it('instruction-only vendors produce no card but carry instructions', () => {
    const p = buildProfile({ settings: { vendor: 'applepay' } });
    expect(p.card).toBeNull();
    expect(p.cardInstructions).toMatch(/sandbox/i);
  });

  it('derives the SFCC card type from the BIN', () => {
    expect(gen.cardBrandFromNumber('4111111111111111')).toBe('Visa');
    expect(gen.cardBrandFromNumber('5555555555554444')).toBe('Master Card');
    expect(gen.cardBrandFromNumber('378282246310005')).toBe('Amex');
    expect(gen.cardBrandFromNumber('6011000000000012')).toBe('Discover');
  });
});

describe('luhnValid', () => {
  it('accepts valid numbers and rejects invalid ones', () => {
    expect(gen.luhnValid('4242424242424242')).toBe(true);
    expect(gen.luhnValid('4007000000027')).toBe(true); // 13-digit Visa
    expect(gen.luhnValid('4242424242424241')).toBe(false);
    expect(gen.luhnValid('1234')).toBe(false);
  });
});

describe('distinct billing address', () => {
  it('uses the provided billing record when same-as-shipping is off', () => {
    const p = buildProfile({
      settings: { billingSameAsShipping: false },
      billingRecord: { id: 'x', label: 'x', address1: '20 W 34th St', city: 'New York', state: 'NY', postalCode: '10001' },
    });
    expect(p.billing.address1).toBe('20 W 34th St');
    expect(p.address.address1).toBe('1 Apple Park Way');
  });
});
