// Schema/consistency validation for every bundled data file.
import { describe, it, expect } from 'vitest';
import { readJSON } from './helpers.js';
import '../../src/lib/generator.js';

const { luhnValid } = globalThis.SFCCAF.generator;

const countriesData = readJSON('src/data/countries.json');
const addressesData = readJSON('src/data/addresses.json');
const namesData = readJSON('src/data/names.json');
const cardsData = readJSON('src/data/cards.json');
const phoneExamples = readJSON('src/data/phone-examples.json');

describe('countries.json', () => {
  it('has the curated country set with unique ISO codes', () => {
    const codes = countriesData.countries.map((c) => c.code);
    expect(codes.length).toBeGreaterThanOrEqual(20);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it('covers every region from the plan', () => {
    const regions = new Set(countriesData.countries.map((c) => c.region));
    for (const r of ['North America', 'South America', 'Europe', 'APAC', 'Middle East', 'Africa']) {
      expect(regions).toContain(r);
    }
  });

  it('entries are structurally complete and self-consistent', () => {
    for (const c of countriesData.countries) {
      expect(c.name, c.code).toBeTruthy();
      expect(c.dialCode).toMatch(/^\+\d+$/);
      expect(typeof c.postal.required).toBe('boolean');
      expect(['code', 'name', 'none']).toContain(c.state.mode);
      expect(c.states).toBeTypeOf('object');
      // Each country's own postal example must match its own regex.
      expect(c.postal.example, `${c.code} postal example`).toMatch(new RegExp(c.postal.regex));
    }
  });
});

describe('addresses.json', () => {
  it('every country has at least 2 candidate addresses', () => {
    for (const c of countriesData.countries) {
      const list = addressesData.addresses[c.code];
      expect(list, `addresses for ${c.code}`).toBeDefined();
      expect(list.length, `addresses for ${c.code}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('records are complete, ids unique, postal codes match the country rule', () => {
    const ids = new Set();
    for (const c of countriesData.countries) {
      for (const a of addressesData.addresses[c.code]) {
        expect(a.id).toBeTruthy();
        expect(ids.has(a.id), `duplicate id ${a.id}`).toBe(false);
        ids.add(a.id);
        expect(a.label && a.address1 && a.city, a.id).toBeTruthy();
        if (c.postal.required) expect(a.postalCode, `${a.id} postalCode`).toBeTruthy();
        if (a.postalCode) expect(a.postalCode, `${a.id} postalCode`).toMatch(new RegExp(c.postal.regex));
        if (c.state.required) expect(a.state, `${a.id} state`).toBeTruthy();
      }
    }
  });

  it('no fabricated verification results: verified statuses are null or a known value', () => {
    for (const list of Object.values(addressesData.addresses)) {
      for (const a of list) {
        expect(a.verified, a.id).toBeDefined();
        for (const key of ['avatax', 'googleAddressValidation']) {
          expect([null, 'pass', 'corrected', 'fail'], `${a.id}.${key}`).toContain(a.verified[key]);
        }
        // A recorded status must carry a verification date.
        if (a.verified.avatax !== null || a.verified.googleAddressValidation !== null) {
          expect(a.verified.verifiedOn, `${a.id} verifiedOn`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    }
  });
});

describe('names.json', () => {
  it('default pool has 40 first and 40 last ASCII-safe names', () => {
    expect(namesData.latin.first.length).toBe(40);
    expect(namesData.latin.last.length).toBe(40);
    for (const n of [...namesData.latin.first, ...namesData.latin.last]) {
      expect(n, n).toMatch(/^[A-Za-z]+$/); // no apostrophes/hyphens/diacritics by default
    }
  });

  it('stress pool exists and contains validation-hostile names', () => {
    const all = [...namesData.stress.first, ...namesData.stress.last].join('');
    expect(/['\-]/.test(all) || /[^\x00-\x7F]/.test(all)).toBe(true);
  });
});

describe('cards.json', () => {
  it('covers all vendors from the plan', () => {
    const ids = cardsData.vendors.map((v) => v.id);
    for (const id of ['adyen', 'authorizenet', 'stripe', 'braintree', 'cybersource', 'worldpay', 'checkoutcom', 'klarna', 'applepay', 'googlepay']) {
      expect(ids).toContain(id);
    }
  });

  it('every vendor cites its documentation and check date', () => {
    for (const v of cardsData.vendors) {
      expect(v.docUrl, v.id).toMatch(/^https:\/\//);
      expect(v.docCheckedOn, v.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('every card number passes Luhn and has a CVV and expected result', () => {
    for (const v of cardsData.vendors) {
      if (v.type === 'instructions') {
        expect(v.instructions, v.id).toBeTruthy();
        continue;
      }
      expect(v.cards.length, v.id).toBeGreaterThan(0);
      expect(v.cards.some((c) => c.expectedResult === 'approved'), v.id).toBe(true);
      for (const c of v.cards) {
        expect(luhnValid(c.number), `${c.id} ${c.number}`).toBe(true);
        expect(c.cvv, c.id).toMatch(/^\d{3,4}$/);
        expect(['approved', 'declined', '3ds-challenge', 'expired'], c.id).toContain(c.expectedResult);
      }
    }
  });
});

describe('phone-examples.json', () => {
  it('has an example number for every shipped country', () => {
    for (const c of countriesData.countries) {
      expect(phoneExamples[c.code], c.code).toBeTruthy();
    }
  });
});

describe('selector maps', () => {
  it('all selectors are syntactically valid CSS', () => {
    for (const file of ['sfra', 'sitegenesis', 'pwakit']) {
      const map = readJSON(`src/data/selectors/${file}.json`);
      for (const [field, selectors] of Object.entries(map.fields)) {
        expect(Array.isArray(selectors), `${file}.${field}`).toBe(true);
        for (const sel of selectors) {
          expect(() => document.querySelector(sel), `${file}.${field}: ${sel}`).not.toThrow();
        }
      }
    }
    const hosted = readJSON('src/data/selectors/hosted.json');
    for (const v of hosted.vendors) {
      for (const p of v.hostPatterns) expect(() => new RegExp(p)).not.toThrow();
      for (const selectors of Object.values(v.fields)) {
        for (const sel of selectors) expect(() => document.querySelector(sel)).not.toThrow();
      }
    }
  });
});
