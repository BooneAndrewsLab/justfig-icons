/**
 * Bioicons: `static/icons/icons.json` is the source of truth for each
 * icon's licence and author; files live at
 * `static/icons/<license>/<category>/<author_with_underscores>/<name>.svg`.
 * Matching is case-insensitive (a few entries differ in case from their
 * folders); files not listed in icons.json are skipped, never guessed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { SourceConfig } from '../config.ts';
import { cyrb53 } from '../hash.ts';
import { type Collected, type RawIcon, slug, titleFromName, words } from './types.ts';

interface Entry {
  readonly name: string;
  readonly category: string;
  readonly license: string;
  readonly author: string;
}

function decode(v: unknown): Entry[] {
  if (!Array.isArray(v)) throw new Error('bioicons icons.json: expected a list');
  return v.map((x: unknown, i) => {
    const o = x as Record<string, unknown>;
    const s = (k: string): string => {
      const val = o[k];
      if (typeof val !== 'string' || val.trim() === '') throw new Error(`icons.json[${i}].${k}`);
      return val;
    };
    return { name: s('name'), category: s('category'), license: s('license'), author: s('author') };
  });
}

function listSvgs(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) listSvgs(p, out);
    else if (f.endsWith('.svg') && st.isFile()) out.push(p);
  }
  return out;
}

/** Display name: icons.json slugs like "Helicase_11" → "Helicase 11". */
export const authorName = (a: string): string => a.replace(/_/g, ' ').trim();

export function collectBioicons(src: SourceConfig, dir: string): Collected {
  const base = join(dir, 'static/icons');
  const entries = decode(JSON.parse(readFileSync(join(base, 'icons.json'), 'utf8')));
  const files = new Map<string, string>();
  for (const f of listSvgs(base)) files.set(relative(base, f).toLowerCase(), f);
  const icons: RawIcon[] = [];
  const skipped: Collected['skipped'] = [];
  const used = new Set<string>();
  const ids = new Set<string>();
  const sorted = [...entries].sort((a, b) =>
    `${a.license}/${a.category}/${a.author}/${a.name}`.localeCompare(
      `${b.license}/${b.category}/${b.author}/${b.name}`,
    ),
  );
  for (const e of sorted) {
    const rel = `${e.license}/${e.category}/${e.author.replace(/ /g, '_')}/${e.name}.svg`;
    const key = rel.slice(0, -'.svg'.length);
    const file = files.get(rel.toLowerCase());
    if (rel.includes('..') || file === undefined) {
      skipped.push({ source: src.id, key, reason: 'listed in icons.json but no file at its path' });
      continue;
    }
    used.add(rel.toLowerCase());
    const spdx = src.licenseMap?.[e.license];
    if (spdx === undefined) {
      skipped.push({ source: src.id, key, reason: `unmapped licence "${e.license}"` });
      continue;
    }
    let s = slug(e.name);
    if (s === '') s = cyrb53(e.name).toString(36);
    let id = `bi-${s}`;
    for (let n = 2; ids.has(id); n += 1) id = `bi-${s}-${String(n)}`;
    ids.add(id);
    const title = titleFromName(e.name);
    const tags = [...new Set([...words(e.name), ...words(e.category.replace(/_/g, ' '))])];
    icons.push({
      source: src.id,
      id,
      key: relative(base, file).replace(/\.svg$/, ''),
      title,
      tags,
      sourceCategory: e.category,
      license: spdx,
      author: authorName(e.author),
      file,
      normalize: {},
    });
  }
  for (const [lower, f] of files)
    if (!used.has(lower))
      skipped.push({
        source: src.id,
        key: relative(base, f).replace(/\.svg$/, ''),
        reason: 'file not listed in icons.json (no licence record)',
      });
  return { icons, skipped };
}
