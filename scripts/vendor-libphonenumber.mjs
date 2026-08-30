// Re-vendors libphonenumber-js into the extension source tree.
// Run after `npm install` whenever the dependency is upgraded:
//   npm run vendor:phone
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

copyFileSync(
  join(root, 'node_modules/libphonenumber-js/bundle/libphonenumber-min.js'),
  join(root, 'src/lib/libphonenumber.min.js')
);

// Trim the example-numbers metadata to the countries the extension ships.
const countries = JSON.parse(
  readFileSync(join(root, 'src/data/countries.json'), 'utf8')
).countries.map((c) => c.code);
const all = JSON.parse(
  readFileSync(join(root, 'node_modules/libphonenumber-js/examples.mobile.json'), 'utf8')
);
const trimmed = {};
for (const code of countries) {
  if (!all[code]) throw new Error(`No example mobile number for ${code}`);
  trimmed[code] = all[code];
}
writeFileSync(
  join(root, 'src/data/phone-examples.json'),
  JSON.stringify(trimmed, null, 2) + '\n'
);
console.log(`Vendored libphonenumber bundle + ${Object.keys(trimmed).length} example numbers.`);
