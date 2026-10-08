/**
 * `npm run build [-- --only house,healthicons] [--limit N] [--no-thumbs] [--out DIR]`
 *
 * A full build (no flags) writes dist/ and REPORT.md. Flags make quick or
 * partial builds (no REPORT.md), e.g. for a test fixture.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { build } from '../src/build.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    limit: { type: 'string' },
    'no-thumbs': { type: 'boolean' },
    out: { type: 'string' },
  },
});
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const partial = values.only !== undefined || values.limit !== undefined;
const t0 = Date.now();
await build(root, {
  version: pkg.version,
  ...(values.out === undefined ? {} : { out: resolve(values.out) }),
  ...(values.only === undefined ? {} : { only: values.only.split(',') }),
  ...(values.limit === undefined ? {} : { limit: Number(values.limit) }),
  thumbs: values['no-thumbs'] !== true,
  report: !partial && values.out === undefined,
});
console.log(`done in ${String(Math.round((Date.now() - t0) / 1000))} s`);
