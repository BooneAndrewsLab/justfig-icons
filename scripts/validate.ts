/** `npm run validate [-- DIR]`: check dist/ (or DIR); exits 1 on any error. */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadLicenses } from '../src/config.ts';
import { validateDist } from '../src/validate.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.argv[2] ? resolve(process.argv[2]) : join(root, 'dist');
const r = validateDist(dist, loadLicenses(root));
for (const e of r.licenseErrors.slice(0, 50)) console.error(`licence: ${e}`);
for (const e of r.errors.slice(0, 50)) console.error(`error: ${e}`);
console.log(
  `${String(r.icons)} icons; ${String(r.licenseErrors.length)} licence errors; ` +
    `${String(r.errors.length)} other errors; first payload ${String(Math.round(r.firstPayload / 1000))} kB; ` +
    `slowest search ${r.searchMs.toFixed(1)} ms`,
);
if (r.licenseErrors.length > 0 || r.errors.length > 0) process.exit(1);
