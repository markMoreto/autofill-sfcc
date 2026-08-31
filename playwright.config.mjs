// E2E suite: loads the real unpacked extension into Chromium and fills the
// static fixtures. Not part of `npm test` (needs a browser download):
//   npx playwright install chromium && npm run test:e2e
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 30_000,
  use: { headless: true },
  reporter: [['list']],
});
