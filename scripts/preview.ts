/**
 * `npm run preview [-- --base origin/main | --ids a,b | --all] [--out DIR]`
 *
 * Renders the house icons that are new or changed versus a git base (default
 * origin/main), the named ids, or all of them: default colours plus 3 random
 * palettes, with metadata and any problems. Writes preview/index.html,
 * preview/summary.md and PNGs. Exits 1 when an icon has a problem. Needs no
 * network and no `npm run fetch`.
 */
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { loadHouse, loadTaxonomy } from '../src/config.ts';
import {
  type PreviewContext,
  type PreviewResult,
  buildPreview,
  changedSince,
  cleanDir,
  problemCount,
  writePreview,
} from '../src/preview.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    ids: { type: 'string' },
    all: { type: 'boolean' },
    out: { type: 'string' },
    where: { type: 'string' },
  },
});
const out = resolve(values.out ?? join(root, 'preview'));
cleanDir(out);

let ctx: PreviewContext;
let result: PreviewResult = { icons: [], missing: [] };
try {
  let ids: string[];
  if (values.ids !== undefined) {
    ids = values.ids
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    ctx = { selection: `Icons ${ids.join(', ')}` };
  } else if (values.all === true) {
    ids = loadHouse(root, loadTaxonomy(root)).map((m) => m.id);
    ctx = { selection: 'All house icons' };
  } else {
    const base = values.base ?? 'origin/main';
    ids = changedSince(root, base);
    ctx = { selection: `House icons new or changed versus ${base}` };
  }
  if (values.where !== undefined) ctx = { ...ctx, where: values.where };
  result = buildPreview(root, ids, out);
} catch (e: unknown) {
  ctx = { selection: 'House icons', fatal: e instanceof Error ? e.message : String(e) };
}
writePreview(out, result, ctx);

const problems = problemCount(result, ctx);
console.log(
  `${String(result.icons.length)} icon(s) previewed, ${String(problems)} problem(s). ` +
    `Open ${join(out, 'index.html')}`,
);
for (const i of result.icons) {
  for (const p of i.problems) console.error(`error: ${i.id}: ${p}`);
  for (const w of i.warnings) console.warn(`warning: ${i.id}: ${w}`);
}
for (const m of result.missing) console.error(`error: ${m}: no such house icon`);
if (ctx.fatal) console.error(`error: ${ctx.fatal}`);
if (problems > 0) process.exit(1);
