// Integration tests for the content-script orchestration (handleFill),
// especially reveal-click safety: the extension must never click anything
// unless the target section is actually collapsed, and never click a
// navigating link no matter what a theme's class names collide with.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadFixture, loadMaps, countryMeta, buildProfile } from './helpers.js';
import '../../src/lib/generator.js';
import '../../src/content/platform.js';
import '../../src/content/detect.js';
import '../../src/content/fill.js';
import '../../src/content/frames.js';

let onFillMessage;
const sentMessages = [];

beforeAll(async () => {
  // Minimal chrome stub so content.js can register its listener.
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => { onFillMessage = fn; } },
      sendMessage: (msg) => { sentMessages.push(msg); },
    },
  };
  await import('../../src/content/content.js');
});

function fillMessage(scope, patch = {}) {
  return {
    type: 'FILL',
    fillId: `test-${Math.random()}`,
    scope,
    options: {
      billingSameAsShipping: patch.settings?.billingSameAsShipping ?? true,
      phoneFormat: 'national',
      profileMode: 'registered',
    },
    profile: buildProfile(patch),
    countryMeta: countryMeta('US'),
    maps: loadMaps(),
  };
}

async function dispatchFill(scope, patch) {
  sentMessages.length = 0;
  onFillMessage(fillMessage(scope, patch));
  await vi.waitFor(() => {
    if (!sentMessages.some((m) => m.type === 'FILL_RESULT')) throw new Error('no result yet');
  }, { timeout: 4000 });
  return sentMessages.find((m) => m.type === 'FILL_RESULT').result;
}

describe('reveal-click safety', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('does NOT click any reveal when the billing section is already visible', async () => {
    loadFixture('sfra-checkout.html');
    // Theme collision: a matching class deep in the footer.
    document.body.insertAdjacentHTML('beforeend', `
      <footer><div class="billing-address-block">
        <button type="button" class="btn-show-details" id="footer-trap">Showroom</button>
      </div></footer>`);
    const trap = document.getElementById('footer-trap');
    const clicks = vi.fn();
    trap.addEventListener('click', clicks);

    const result = await dispatchFill('billing');
    expect(clicks).not.toHaveBeenCalled();
    expect(result.filled.some((f) => f.field.startsWith('reveal:'))).toBe(false);
    // billing contact still filled normally
    expect(document.getElementById('email').value).toMatch(/@example\.com$/);
  });

  it('clicks the reveal once when the billing section is collapsed, then fills it', async () => {
    loadFixture('sfra-checkout.html');
    const block = document.querySelector('fieldset.billing-address-block');
    block.setAttribute('style', 'display:none'); // SFRA collapsed billing form
    document.body.insertAdjacentHTML('beforeend', `
      <div class="billing-address-block">
        <button type="button" class="btn-show-details" id="reveal-btn">Edit billing address</button>
      </div>`);
    let clickCount = 0;
    document.getElementById('reveal-btn').addEventListener('click', () => {
      clickCount++;
      block.removeAttribute('style'); // the storefront expands the section
    });

    const result = await dispatchFill('billing', { settings: { billingSameAsShipping: false } });
    expect(clickCount).toBe(1);
    expect(result.filled.some((f) => f.field === 'reveal:billing')).toBe(true);
    expect(document.getElementById('billingAddressOne').value).not.toBe('');
  });

  it('never clicks an anchor with a real href, even if a reveal selector matches it', async () => {
    loadFixture('sfra-checkout.html');
    // Hide billing so a reveal is wanted, and make the only match a nav link.
    document.querySelector('fieldset.billing-address-block').setAttribute('style', 'display:none');
    document.body.insertAdjacentHTML('beforeend', `
      <div class="billing-address-block">
        <a class="btn-show-details" href="/locations" id="nav-link">Showroom Locations</a>
      </div>`);
    const nav = document.getElementById('nav-link');
    const clicks = vi.fn();
    nav.addEventListener('click', clicks);

    const result = await dispatchFill('billing');
    expect(clicks).not.toHaveBeenCalled();
    expect(result.filled.some((f) => f.field.startsWith('reveal:'))).toBe(false);
  });

  it('shipping/registration scopes never trigger reveal clicks at all', async () => {
    loadFixture('sfra-checkout.html');
    document.body.insertAdjacentHTML('beforeend',
      '<div class="billing-address-block"><button class="btn-show-details" id="b">x</button></div>');
    const clicks = vi.fn();
    document.getElementById('b').addEventListener('click', clicks);

    await dispatchFill('shipping');
    await dispatchFill('registration');
    expect(clicks).not.toHaveBeenCalled();
  });
});
