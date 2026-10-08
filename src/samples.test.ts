/**
 * The slot clusterer on 20 real icons (src/fixtures/samples/: 10 Servier,
 * 10 other Bioicons authors). The snapshot records each plan, so a change
 * to the clusterer shows up as a reviewable diff.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { shiftLightness } from './color.ts';
import { normalizeSvg } from './normalize.ts';
import { TOLERANCE } from './slots.ts';
import { checkSvg } from './validate.ts';

const dir = join(import.meta.dirname, 'fixtures', 'samples');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.svg'))
  .sort();

describe('slot clusterer on 20 samples', () => {
  it('has the 20 samples', () => {
    expect(files).toHaveLength(20);
  });

  it.each(files)('%s', (f) => {
    const r = normalizeSvg(readFileSync(join(dir, f), 'utf8'));
    if (!r.ok) throw new Error(r.reason);
    expect(checkSvg(r.svg, r)).toEqual([]);
    expect(r.colorError).toBeLessThanOrEqual(TOLERANCE);
    const els = [...r.svg.matchAll(/<path [^>]*>/g)].map((m) => m[0]);
    const perSlot: Record<string, number> = {};
    for (const e of els) {
      const slot = /data-slot="([^"]+)"/.exec(e)![1]!;
      perSlot[slot] = (perSlot[slot] ?? 0) + 1;
      if (r.recolor === 'slots') {
        // What the SVG says is what the app renders before any recolour.
        const def = r.slots.find((s) => s.id === slot)!;
        const tone = Number(/data-tone="([^"]+)"/.exec(e)?.[1] ?? 0);
        const colour = /(?:fill|stroke)="(#[0-9a-f]{6})"/.exec(e)![1];
        expect(colour).toBe(tone === 0 ? def.default : shiftLightness(def.default, tone));
      }
    }
    if (r.recolor === 'slots')
      expect(r.slots.filter((s) => /^s\d$/.test(s.id)).length).toBeLessThanOrEqual(4);
    expect({ recolor: r.recolor, slots: r.slots, perSlot }).toMatchSnapshot();
  });
});
