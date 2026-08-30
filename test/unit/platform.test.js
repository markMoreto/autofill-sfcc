import { describe, it, expect, beforeEach } from 'vitest';
import { loadFixture } from './helpers.js';
import '../../src/content/platform.js';

const detectPlatform = globalThis.SFCCAF.detectPlatform;

describe('platform detection', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it.each([
    ['sfra-register.html', 'sfra'],
    ['sfra-checkout.html', 'sfra'],
    ['sfra-address-book.html', 'sfra'],
    ['sg-register.html', 'sitegenesis'],
    ['sg-checkout.html', 'sitegenesis'],
    ['pwa-checkout.html', 'pwakit'],
    ['generic-checkout.html', 'unknown'],
  ])('%s -> %s', (fixture, expected) => {
    loadFixture(fixture);
    expect(detectPlatform(document)).toBe(expected);
  });

  it('empty page -> unknown', () => {
    expect(detectPlatform(document)).toBe('unknown');
  });
});
