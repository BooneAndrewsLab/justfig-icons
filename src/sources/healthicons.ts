/**
 * Health Icons (CC0): `public/icons/meta-data.json` lists every icon with
 * title, tags and category; the filled 48 px SVGs are single-colour
 * (`currentColor`), drawn here as #333333 in one slot.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SourceConfig } from '../config.ts';
import { type Collected, type RawIcon, slug, words } from './types.ts';

interface Meta {
  readonly id: string;
  readonly category: string;
  readonly path: string;
  readonly tags: readonly string[];
  readonly title: string;
}

function decode(v: unknown): Meta[] {
  if (!Array.isArray(v)) throw new Error('healthicons meta-data.json: expected a list');
  return v.map((x: unknown, i) => {
    const o = x as Record<string, unknown>;
    const s = (k: string): string => {
      const val = o[k];
      if (typeof val !== 'string' || val === '') throw new Error(`meta-data.json[${i}].${k}`);
      return val;
    };
    const tags = Array.isArray(o['tags']) ? o['tags'].filter((t) => typeof t === 'string') : [];
    return { id: s('id'), category: s('category'), path: s('path'), title: s('title'), tags };
  });
}

export function collectHealthIcons(src: SourceConfig, dir: string): Collected {
  const icons: RawIcon[] = [];
  const skipped: Collected['skipped'] = [];
  const meta = decode(JSON.parse(readFileSync(join(dir, 'public/icons/meta-data.json'), 'utf8')));
  const seen = new Set<string>();
  // An id listed in two categories keeps the plain id for the first (by path) and
  // gets its category prefixed for the others.
  const counts = new Map<string, number>();
  for (const m of meta) counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
  for (const m of [...meta].sort((a, b) => a.path.localeCompare(b.path))) {
    const file = join(dir, 'public/icons/svg/filled', `${m.path}.svg`);
    if (m.path.includes('..') || !existsSync(file)) {
      skipped.push({ source: src.id, key: m.path, reason: 'listed but no filled SVG' });
      continue;
    }
    let id = `hi-${slug(m.id)}`;
    if (seen.has(id) && (counts.get(m.id) ?? 0) > 1) id = `hi-${slug(m.category)}-${slug(m.id)}`;
    if (seen.has(id)) {
      skipped.push({ source: src.id, key: m.path, reason: `duplicate id ${id}` });
      continue;
    }
    seen.add(id);
    const tags = [
      ...new Set(
        m.tags
          .filter((t) => !t.includes(':'))
          .map((t) => t.toLowerCase().trim())
          .concat(words(m.title))
          .filter((t) => t !== ''),
      ),
    ];
    icons.push({
      source: src.id,
      id,
      key: m.path,
      title: m.title,
      tags,
      sourceCategory: m.category,
      license: src.license,
      author: src.author ?? src.name,
      file,
      normalize: { currentColor: '#333333' },
    });
  }
  return { icons, skipped };
}
