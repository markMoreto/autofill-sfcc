// Loads the unpacked extension in Chromium and exercises a real fill against
// the fixtures — including the SFRA fixture's async country->state reload
// script, which the jsdom unit tests only replicate with mocks.
//
// Fixtures are served over HTTP because Chrome does not run content scripts
// on file:// URLs without a per-user opt-in.
import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let context;
let background;
let server;
let baseUrl;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    try {
      const file = join(root, 'test', 'fixtures', req.url.replace(/^\/+/, ''));
      res.setHeader('content-type', extname(file) === '.html' ? 'text/html' : 'text/plain');
      res.end(readFileSync(file));
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'sfccaf-')), {
    channel: 'chromium', // full Chromium (new headless) — extensions don't run in headless shell
    headless: true,
    args: [
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
    ],
  });
  background = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
});

test.afterAll(async () => {
  await context?.close();
  server?.close();
});

async function fillActiveTab(page, scope) {
  // Drive the background's doFill exactly like the popup does.
  await page.bringToFront();
  return background.evaluate(async (scope) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // eslint-disable-next-line no-undef
    return doFill(tab.id, { scope });
  }, scope);
}

test('SFRA checkout: fill everything, state options load after country change', async () => {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/sfra-checkout.html`);

  const result = await fillActiveTab(page, 'all');
  expect(result.error).toBeUndefined();
  expect(result.platform).toBe('sfra');
  expect(result.unresolved).toEqual([]);

  await expect(page.locator('#shippingCountry')).toHaveValue('US');
  await expect(page.locator('#shippingState')).toHaveValue('CA');
  await expect(page.locator('#shippingZipCode')).toHaveValue('95014');
  await expect(page.locator('#cardNumber')).toHaveValue('4111111111111111');
  await expect(page.locator('#securityCode')).toHaveValue('737');
  const email = await page.locator('#email').inputValue();
  expect(email).toMatch(/^qa\+.+@example\.com$/);

  // Perf budget: <150ms fill plus the mocked state-reload waits (2 x 80ms AJAX).
  expect(result.durationMs).toBeLessThan(150 + 400);
  await page.close();
});

test('SFRA registration fill', async () => {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/sfra-register.html`);

  const result = await fillActiveTab(page, 'registration');
  expect(result.unresolved).toEqual([]);
  await expect(page.locator('#registration-form-fname')).not.toHaveValue('');
  const pw = await page.locator('#registration-form-password').inputValue();
  expect(pw).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{8,}$/);
  await expect(page.locator('#registration-form-password-confirm')).toHaveValue(pw);
  await page.close();
});

test('SiteGenesis checkout fill', async () => {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/sg-checkout.html`);

  const result = await fillActiveTab(page, 'all');
  expect(result.platform).toBe('sitegenesis');
  await expect(page.locator('[name="dwfrm_singleshipping_shippingAddress_addressFields_postal"]')).toHaveValue('95014');
  await expect(page.locator('[name="dwfrm_billing_paymentMethods_creditCard_number"]')).toHaveValue('4111111111111111');
  await expect(page.locator('[name="dwfrm_billing_paymentMethods_creditCard_type"]')).toHaveValue('Visa');
  await page.close();
});

test('Generic (unknown platform) checkout via heuristics', async () => {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/generic-checkout.html`);

  const result = await fillActiveTab(page, 'all');
  expect(result.platform).toBe('unknown');
  await expect(page.locator('[name="street"]')).toHaveValue('1 Apple Park Way');
  await expect(page.locator('[name="pan"]')).toHaveValue('4111111111111111');
  await expect(page.locator('[name="billzip"]')).toHaveValue('95014');
  await page.close();
});
