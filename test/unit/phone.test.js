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
