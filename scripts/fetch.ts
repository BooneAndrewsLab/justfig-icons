/**
 * `npm run fetch [source…]`: fetch every enabled git source (or the named
 * ones) at its pinned commit into raw/.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSources } from '../src/config.ts';
import { fetchSource } from '../src/fetch.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const only = new Set(process.argv.slice(2));
for (const s of loadSources(root)) {
  if (only.size > 0 ? !only.has(s.id) : !s.enabled) continue;
  if (s.fetch.method === 'git') fetchSource(root, s);
  else console.log(`${s.id}: ${s.fetch.method} source, nothing to fetch`);
}
