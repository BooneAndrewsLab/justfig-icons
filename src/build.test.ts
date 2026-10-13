/**
 * End to end on the house icons (no network): build → validate, and the
 * notice files for a mixed-licence set.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { build } from './build.ts';
import { loadLicenses } from './config.ts';
import type { IconEntry, LibraryManifest } from './format.ts';
import { creditsMarkdown, licenseFiles } from './report.ts';
import { validateDist } from './validate.ts';

const root = join(import.meta.dirname, '..');
const out = mkdtempSync(join(tmpdir(), 'justfig-icons-'));
afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe('build', () => {
  it('builds the house icons into a library that validates', async () => {
    const r = await build(root, {
      version: '0.0.0-test',
      out,
      only: ['house'],
      log: () => undefined,
    });
    expect(r.entries.length).toBeGreaterThanOrEqual(39);
    const v = validateDist(out, loadLicenses(root));
    expect(v.licenseErrors).toEqual([]);
    expect(v.errors).toEqual([]);
    const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as LibraryManifest;
    expect(m.sources.map((s) => s.id)).toEqual(['house']);
    expect(m.thumbs).toEqual({ size: 96, columns: 10, ext: '.webp', hiDpi: '@2x' });
    const tube = r.entries.find((e) => e.id === 'test-tube')!;
    expect(tube.slots.map((s) => s.label)).toEqual(['Liquid', 'Vessel', 'Outline']);
    expect(readFileSync(join(out, 'CREDITS.md'), 'utf8')).toContain('## House icons');
  }, 60_000);
});

describe('notices', () => {
  const entry = (id: string, source: string, author: string, license: string): IconEntry => ({
    id,
    title: id,
    tags: [],
    category: 'cells',
    hash: id,
    svg: '',
    slots: [],
    recolor: 'slots',
    meta: {
      library: 'l',
      libraryVersion: '1',
      id,
      title: id,
      source,
      author,
      license,
      licenseUrl: '',
      originalUrl: '',
      shareAlike: false,
    },
  });
  const licenses = loadLicenses(root);
  const entries = [
    entry('pytorch', 'Bioicons', 'Facebook', 'BSD-3-Clause'),
    entry('aorta', 'Bioicons', 'Kathryn Kananen', 'MIT'),
    entry('vein', 'Bioicons', 'Kathryn Kananen', 'MIT'),
    entry('cell', 'Bioicons', 'Servier', 'CC-BY-3.0'),
    entry('lungs', 'Health Icons', 'Resolve to Save Lives', 'CC0-1.0'),
  ];

  it('writes MIT and BSD texts with every copyright holder, and an index', () => {
    const f = licenseFiles(entries, licenses);
    expect([...f.keys()].sort()).toEqual(['BSD-3-Clause.txt', 'MIT.txt', 'README.md']);
    expect(f.get('MIT.txt')).toContain('Copyright (c) Kathryn Kananen (aorta, vein; via Bioicons)');
    expect(f.get('BSD-3-Clause.txt')).toContain('Copyright (c) Facebook');
    expect(f.get('README.md')).toContain(
      '| CC BY 3.0 | 1 | https://creativecommons.org/licenses/by/3.0/ |',
    );
  });

  it('groups CREDITS.md by source, licence and author', () => {
    const md = creditsMarkdown({ version: '1' } as LibraryManifest, entries, [], licenses);
    expect(md).toContain('## Bioicons');
    expect(md).toContain('### MIT (2)');
    expect(md).toContain('- **Kathryn Kananen** (2): aorta, vein');
    expect(md.indexOf('## Bioicons')).toBeLessThan(md.indexOf('## Health Icons'));
  });

  it('marks icons the normaliser adapted as modified in CREDITS.md', () => {
    const e = entry('nucleus', 'Bioicons', 'Servier', 'CC-BY-3.0');
    const adapted = { ...e, meta: { ...e.meta, adapted: true as const } };
    const md = creditsMarkdown({ version: '1' } as LibraryManifest, [adapted], [], licenses);
    expect(md).toContain('- **Servier** (1): nucleus (modified)');
  });
});
