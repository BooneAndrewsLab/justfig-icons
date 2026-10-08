/**
 * `npm run build [-- --only house,healthicons] [--limit N] [--no-thumbs] [--out DIR] [--strict]`
 *
 * A full build (no flags) writes dist/ and REPORT.md. Flags make quick or
 * partial builds (no REPORT.md), e.g. for a test fixture. `--strict` exits 1
 * (after writing the output) when anything was rejected or skipped.
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
    strict: { type: 'boolean' },
  },
});
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const partial = values.only !== undefined || values.limit !== undefined;
const t0 = Date.now();
const { rejections } = await build(root, {
  version: pkg.version,
  ...(values.out === undefined ? {} : { out: resolve(values.out) }),
  ...(values.only === undefined ? {} : { only: values.only.split(',') }),
  ...(values.limit === undefined ? {} : { limit: Number(values.limit) }),
  thumbs: values['no-thumbs'] !== true,
  report: !partial && values.out === undefined,
});
console.log(`done in ${String(Math.round((Date.now() - t0) / 1000))} s`);
if (values.strict === true && rejections.length > 0) {
  for (const r of rejections) console.error(`error: ${r.source}/${r.key}: ${r.reason}`);
  process.exit(1);
}
