/** Contribution preview: seeded palettes, recolouring, changed-icon selection, end to end. */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  HOUSE_PALETTE,
  buildPreview,
  changedHouseIds,
  pickPalettes,
  previewHtml,
  previewSummary,
  problemCount,
  recolorSvg,
  seedFrom,
} from './preview.ts';

const root = join(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'justfig-preview-'));
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const slots = [
  { id: 's1', label: 'Liquid', default: '#56b4e9' },
  { id: 's2', label: 'Vessel', default: '#e4f1fb' },
  { id: 'outline', label: 'Outline', default: '#1f2933' },
];

describe('palettes', () => {
  it('are identical on a rerun and differ between ids', () => {
    expect(pickPalettes('beaker', slots)).toEqual(pickPalettes('beaker', slots));
    expect(seedFrom('beaker')).not.toBe(seedFrom('test-tube'));
    expect(pickPalettes('beaker', slots)).not.toEqual(pickPalettes('test-tube', slots));
  });
  it('are 3 distinct palettes from the house colours, keeping the outline', () => {
    const ps = pickPalettes('beaker', slots);
    expect(ps).toHaveLength(3);
    expect(new Set(ps.map((p) => JSON.stringify(p))).size).toBe(3);
    for (const p of ps) {
      expect(HOUSE_PALETTE).toContain(p['s1']);
      expect(HOUSE_PALETTE).toContain(p['s2']);
      expect(p['s1']).not.toBe(p['s2']);
      expect(p['outline']).toBe('#1f2933');
    }
  });
  it('copes with a single slot', () => {
    expect(pickPalettes('x', [slots[0]!])).toHaveLength(3);
  });
});

describe('recolorSvg', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<path d="M0 0H10V10Z" fill="#56b4e9" data-slot="s1"/>' +
    '<path d="M0 0H10" fill="none" stroke="#1f2933" stroke-width="2.5" data-slot="outline"/></svg>';
  it('replaces slot colours, keeps none and unknown slots', () => {
    const out = recolorSvg(svg, { s1: '#d55e00' });
    expect(out).toContain('fill="#d55e00"');
    expect(out).toContain('fill="none" stroke="#1f2933"');
  });
  it('applies the tone', () => {
    const toned = svg.replace('data-slot="s1"', 'data-slot="s1" data-tone="-0.16"');
    const out = recolorSvg(toned, { s1: '#d55e00' });
    expect(out).not.toContain('#d55e00');
    expect(out).toMatch(/fill="#[0-9a-f]{6}" data-slot="s1"/);
  });
});

describe('changedHouseIds', () => {
  const m = (id: string, title = id): never =>
    ({ id, title, tags: [], category: 'lab', slots: [], author: 'a', license: 'CC0-1.0' }) as never;
  it('picks changed SVGs and new or edited entries, not untouched ones', () => {
    const base = [m('a'), m('b'), m('c')];
    const cur = [m('a'), m('b', 'B2'), m('c'), m('d')];
    expect(changedHouseIds(['house/svg/a.svg', 'README.md'], base, cur)).toEqual(['a', 'b', 'd']);
  });
  it('treats an unreadable base as everything changed', () => {
    expect(changedHouseIds([], undefined, [m('a'), m('b')])).toEqual(['a', 'b']);
  });
});

describe('buildPreview', () => {
  it('renders real house icons with PNGs, deterministically', () => {
    const a = join(tmp, 'a');
    const b = join(tmp, 'b');
    const r = buildPreview(root, ['beaker', 'test-tube'], a);
    buildPreview(root, ['beaker', 'test-tube'], b);
    expect(r.icons.map((i) => i.problems)).toEqual([[], []]);
    expect(r.icons[0]?.variants).toHaveLength(4);
    for (const f of ['beaker-default.png', 'beaker-p1.png', 'beaker-p3.png'])
      expect(
        readFileSync(join(a, 'png', f))
          .subarray(1, 4)
          .toString(),
      ).toBe('PNG');
    expect(readFileSync(join(a, 'png', 'beaker-p2.png'))).toEqual(
      readFileSync(join(b, 'png', 'beaker-p2.png')),
    );
    const html = previewHtml(r, { selection: 'test' });
    expect(html).toContain('Beaker');
    expect(html).toContain('CC0-1.0');
    expect(html).toContain('No problems found');
    expect(previewSummary(r, { selection: 'test' })).toContain('`beaker`');
  });

  it('shows problems prominently, escaped', () => {
    const fake = join(tmp, 'root');
    mkdirSync(join(fake, 'house', 'svg'), { recursive: true });
    for (const f of ['taxonomy.yaml', 'licenses.yaml']) cpSync(join(root, f), join(fake, f));
    writeFileSync(
      join(fake, 'house', 'meta.yaml'),
      `author: Tester
license: CC0-1.0
icons:
  good-one:
    title: 'Good <one>'
    tags: [a, b, c]
    category: lab
    slots:
      - { id: s1, label: 'Fill', default: '#56b4e9' }
      - { id: s2, label: 'Unused', default: '#e69f00' }
  no-slot:
    title: 'No slot'
    tags: [a, b, c]
    category: lab
    slots:
      - { id: s1, label: 'Fill', default: '#56b4e9' }
  no-file:
    title: 'No file'
    tags: [a, b, c]
    category: lab
    slots:
      - { id: s1, label: 'Fill', default: '#56b4e9' }
`,
    );
    const p = (fill: string, slot = ' data-slot="s1"'): string =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10H90V90H10Z" fill="${fill}"${slot}/></svg>`;
    writeFileSync(join(fake, 'house', 'svg', 'good-one.svg'), p('#56b4e9'));
    writeFileSync(join(fake, 'house', 'svg', 'no-slot.svg'), p('#56b4e9', ''));
    writeFileSync(join(fake, 'house', 'svg', 'orphan.svg'), p('#56b4e9'));
    const out = join(tmp, 'bad');
    const r = buildPreview(fake, ['good-one', 'no-slot', 'no-file', 'orphan', 'ghost'], out);
    const by = new Map(r.icons.map((i) => [i.id, i]));
    expect(by.get('good-one')?.problems).toEqual([]);
    expect(by.get('good-one')?.warnings.join()).toContain('slot "s2" is declared but no element');
    expect(by.get('no-slot')?.problems.join()).toContain('without a declared slot');
    expect(by.get('no-file')?.problems.join()).toContain('does not exist');
    expect(by.get('orphan')?.problems.join()).toContain('no entry in house/meta.yaml');
    expect(r.missing).toEqual(['ghost']);
    expect(problemCount(r, { selection: 's' })).toBe(4);
    const html = previewHtml(r, { selection: 's' });
    expect(html).toContain('Good &lt;one&gt;');
    expect(html).not.toContain('Good <one>');
    expect(html).toContain('problems to fix before this can merge');
    expect(existsSync(join(out, 'png', 'good-one-p3.png'))).toBe(true);
  });
});
