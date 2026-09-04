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
const emailsData = readJSON('src/data/emails.json');

const namePools = Object.entries(namesData).filter(([k]) => !k.startsWith('$'));
const safePools = namePools.filter(([k]) => k !== 'stress');

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
  it('every country has at least 5 candidate addresses; the US (primary market) at least 20', () => {
    for (const c of countriesData.countries) {
      const list = addressesData.addresses[c.code];
      expect(list, `addresses for ${c.code}`).toBeDefined();
      expect(list.length, `addresses for ${c.code}`).toBeGreaterThanOrEqual(5);
    }
    expect(addressesData.addresses.US.length).toBeGreaterThanOrEqual(20);
    const total = Object.values(addressesData.addresses).reduce((n, l) => n + l.length, 0);
    expect(total).toBeGreaterThanOrEqual(150);
  });

  it('the first US address stays Apple Park (fixtures and e2e assert on it)', () => {
    expect(addressesData.addresses.US[0].address1).toBe('1 Apple Park Way');
  });

  it('every state on a record resolves through the country states map (code or name)', () => {
    for (const c of countriesData.countries) {
      const names = new Set(Object.values(c.states));
      for (const a of addressesData.addresses[c.code]) {
        if (!a.state) continue;
        expect(c.states[a.state] !== undefined || names.has(a.state), `${a.id} state "${a.state}" not in ${c.code} states map`).toBe(true);
      }
    }
  });

  it('records only use the documented fields (custom-address docs list the schema)', () => {
    const allowed = new Set(['id', 'label', 'address1', 'address2', 'city', 'state', 'postalCode', 'unicode', 'verified']);
    for (const list of Object.values(addressesData.addresses)) {
      for (const a of list) for (const key of Object.keys(a)) expect(allowed.has(key), `${a.id}.${key}`).toBe(true);
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
  it('default (latin) pool has at least 60 first and 60 last names', () => {
    expect(namesData.latin.first.length).toBeGreaterThanOrEqual(60);
    expect(namesData.latin.last.length).toBeGreaterThanOrEqual(60);
  });

  it('ships at least 14 selectable pools, each labelled with ≥20 unique ASCII-safe first/last names', () => {
    expect(safePools.length).toBeGreaterThanOrEqual(14);
    for (const [key, pool] of safePools) {
      expect(typeof pool.label, `${key}.label`).toBe('string');
      for (const part of ['first', 'last']) {
        expect(pool[part].length, `${key}.${part}`).toBeGreaterThanOrEqual(20);
        expect(new Set(pool[part]).size, `${key}.${part} duplicates`).toBe(pool[part].length);
        for (const n of pool[part]) expect(n, `${key}.${part}: ${n}`).toMatch(/^[A-Za-z]+$/); // no apostrophes/hyphens/diacritics/spaces
      }
    }
  });

  it('stress pool has ≥20 first/last names and contains validation-hostile ones', () => {
    expect(namesData.stress.first.length).toBeGreaterThanOrEqual(20);
    expect(namesData.stress.last.length).toBeGreaterThanOrEqual(20);
    const all = [...namesData.stress.first, ...namesData.stress.last];
    expect(all.some((n) => /['\-]/.test(n))).toBe(true);        // apostrophes / hyphens
    expect(all.some((n) => /[^\x00-\x7F]/.test(n))).toBe(true); // diacritics / non-Latin
    expect(all.some((n) => /\s/.test(n))).toBe(true);           // spaces
    expect(all.some((n) => n.length === 1)).toBe(true);         // single-letter
    expect(all.some((n) => n.length >= 30)).toBe(true);         // maxlength stress
  });
});

describe('emails.json', () => {
  it('has ≥20 unique lowercase alphanumeric prefixes (valid Mailinator inbox names)', () => {
    expect(emailsData.prefixes.length).toBeGreaterThanOrEqual(20);
    expect(new Set(emailsData.prefixes).size).toBe(emailsData.prefixes.length);
    for (const p of emailsData.prefixes) expect(p).toMatch(/^[a-z0-9]+$/);
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
    const ids = new Set();
    for (const v of cardsData.vendors) {
      if (v.type === 'instructions') {
        expect(v.instructions, v.id).toBeTruthy();
        continue;
      }
      expect(v.cards.length, v.id).toBeGreaterThan(0);
      expect(v.cards.some((c) => c.expectedResult === 'approved'), v.id).toBe(true);
      for (const c of v.cards) {
        expect(ids.has(c.id), `duplicate card id ${c.id}`).toBe(false);
        ids.add(c.id);
        expect(c.number, c.id).toMatch(/^\d{12,19}$/);
        expect(luhnValid(c.number), `${c.id} ${c.number}`).toBe(true);
        expect(c.cvv, c.id).toMatch(/^\d{3,4}$/);
        expect(['approved', 'declined', '3ds-challenge', '3ds-frictionless', 'expired'], c.id).toContain(c.expectedResult);
        expect(c.expiry && 'month' in c.expiry && 'year' in c.expiry, `${c.id} expiry`).toBe(true);
        if (c.holderName !== undefined) expect(c.holderName, `${c.id} holderName`).toMatch(/^[A-Z0-9_ ]+$/);
      }
    }
  });

  it('ships a broad choice of cards: ≥20 per major vendor, ≥150 overall, with error-state variants', () => {
    const fillable = cardsData.vendors.filter((v) => v.type !== 'instructions');
    const count = (id) => fillable.find((v) => v.id === id).cards.length;
    for (const id of ['adyen', 'stripe', 'braintree', 'worldpay']) expect(count(id), id).toBeGreaterThanOrEqual(20);
    expect(fillable.reduce((n, v) => n + v.cards.length, 0)).toBeGreaterThanOrEqual(150);
    for (const id of ['adyen', 'stripe', 'braintree', 'worldpay', 'authorizenet']) {
      const v = fillable.find((x) => x.id === id);
      expect(v.cards.some((c) => c.expectedResult === 'declined'), `${id} declined variant`).toBe(true);
    }
    for (const id of ['adyen', 'stripe']) {
      const v = fillable.find((x) => x.id === id);
      expect(v.cards.some((c) => c.expectedResult.startsWith('3ds')), `${id} 3DS variant`).toBe(true);
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
