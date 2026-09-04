// Success criterion #3: a valid phone number for every country, in both
// E.164 and national formats, validated by libphonenumber itself.
import { describe, it, expect } from 'vitest';
import { readJSON } from './helpers.js';
import * as libphonenumber from '../../src/lib/libphonenumber.min.js';
import '../../src/lib/phone.js';

// In the browser the UMD bundle attaches to globalThis; under Vite's CJS
// interop it lands on module exports instead, so mirror it manually.
if (!globalThis.libphonenumber) globalThis.libphonenumber = libphonenumber;

const phone = globalThis.SFCCAF.phone;
const { countries } = readJSON('src/data/countries.json');
const examples = readJSON('src/data/phone-examples.json');

describe('phone generation', () => {
  for (const c of countries) {
    it(`${c.code}: valid in E.164 and national formats`, () => {
      const p = phone.generate(c.code, examples);
      expect(p.e164.startsWith(c.dialCode)).toBe(true);
      expect(phone.isValid(p.e164)).toBe(true);
      expect(phone.isValid(p.national, c.code)).toBe(true);
      expect(p.nationalCompact).toMatch(/^\d+$/);
      expect(phone.isValid(p.nationalCompact, c.code)).toBe(true);
    });
  }

  it('throws for a country without example metadata', () => {
    expect(() => phone.generate('XX', examples)).toThrow();
  });
});

describe('phone variety', () => {
  for (const c of countries) {
    it(`${c.code}: 40 draws are all valid and yield ≥20 distinct numbers`, () => {
      const seen = new Set();
      for (let i = 0; i < 40; i++) {
        const p = phone.generate(c.code, examples);
        expect(phone.isValid(p.e164)).toBe(true);
        expect(phone.isValid(p.national, c.code)).toBe(true);
        expect(phone.isValid(p.nationalCompact, c.code)).toBe(true);
        seen.add(p.e164);
      }
      expect(seen.size, c.code).toBeGreaterThanOrEqual(20);
    });
  }

  it('vary:false returns the bare libphonenumber example (deterministic)', () => {
    const a = phone.generate('GB', examples, { vary: false });
    const b = phone.generate('GB', examples, { vary: false });
    expect(a.e164).toBe(b.e164);
    expect(a.e164).toBe(`+44${examples.GB}`);
  });

  it('US numbers stay inside the fictional 555-01XX block', () => {
    for (let i = 0; i < 30; i++) {
      expect(phone.generate('US', examples).e164).toMatch(/^\+120155501\d{2}$/);
    }
  });

  it('an injected RNG makes the variation reproducible', () => {
    const rng = () => 0.42;
    const a = phone.generate('DE', examples, { random: rng });
    const b = phone.generate('DE', examples, { random: rng });
    expect(a.e164).toBe(b.e164);
    expect(a.e164).not.toBe(`+49${examples.DE}`);
  });
});
