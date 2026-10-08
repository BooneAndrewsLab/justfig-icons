/** House icons: `house/meta.yaml` + `house/svg/<id>.svg`, already slotted. */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { type Taxonomy, loadHouse } from '../config.ts';
import type { SourceConfig } from '../config.ts';
import type { Collected, RawIcon } from './types.ts';

export function collectHouse(src: SourceConfig, root: string, taxonomy: Taxonomy): Collected {
  const icons: RawIcon[] = [];
  const skipped: Collected['skipped'] = [];
  const meta = loadHouse(root, taxonomy);
  const listed = new Set(meta.map((m) => m.id));
  for (const m of meta) {
    const file = join(root, 'house', 'svg', `${m.id}.svg`);
    if (!existsSync(file)) {
      skipped.push({ source: src.id, key: m.id, reason: 'in meta.yaml but no SVG' });
      continue;
    }
    icons.push({
      source: src.id,
      id: m.id,
      key: m.id,
      title: m.title,
      tags: m.tags,
      category: m.category,
      license: m.license,
      author: m.author,
      file,
      normalize: { slots: m.slots },
    });
  }
  for (const f of readdirSync(join(root, 'house', 'svg')).sort())
    if (f.endsWith('.svg') && !listed.has(f.slice(0, -4)))
      skipped.push({ source: src.id, key: f, reason: 'SVG without a meta.yaml entry' });
  return { icons, skipped };
}
