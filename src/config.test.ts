import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ConfigError,
  decodeLicenses,
  decodeOverrides,
  decodeSource,
  decodeTaxonomy,
  loadHouse,
  loadLicenses,
  loadSources,
  loadTaxonomy,
} from './config.ts';

const root = join(import.meta.dirname, '..');

const source = {
  id: 'x',
  name: 'X',
  homepage: 'https://x.org',
  license: 'CC0-1.0',
  fetch: { method: 'git', url: 'https://github.com/x/x.git', commit: 'a'.repeat(40), paths: [] },
  originalUrl: 'https://x.org/{path}',
  termsChecked: '2026-10-08',
};

describe('source.yaml', () => {
  it('decodes the repository sources', () => {
    const s = loadSources(root);
    expect(s.map((x) => x.id)).toEqual([
      'bioicons',
      'healthicons',
      'house',
      'nih-bioart',
      'scidraw',
      'servier',
    ]);
    expect(s.filter((x) => x.enabled).map((x) => x.id)).toEqual([
      'bioicons',
      'healthicons',
      'house',
    ]);
    const servier = s.find((x) => x.id === 'servier')!;
    expect(servier.attribution).toMatch(/Servier Medical Art .* CC BY 4\.0/);
  });

  it('rejects unknown keys, unpinned commits and missing fields', () => {
    expect(() => decodeSource({ ...source, colour: 'red' }, 'f')).toThrow(/f.colour: unknown key/);
    expect(() =>
      decodeSource({ ...source, fetch: { ...source.fetch, commit: 'main' } }, 'f'),
    ).toThrow(/40-hex commit/);
    expect(() => decodeSource({ ...source, homepage: '' }, 'f')).toThrow(ConfigError);
    const { originalUrl: _drop, ...noUrl } = source;
    expect(() => decodeSource(noUrl, 'f')).toThrow(/originalUrl/);
    expect(decodeSource({ ...noUrl, enabled: false, fetch: { method: 'none' } }, 'f').enabled).toBe(
      false,
    );
  });
});

describe('licenses.yaml', () => {
  it('allows the v1 licences and never NC/ND', () => {
    const l = loadLicenses(root);
    for (const id of ['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'MIT', 'BSD-3-Clause'])
      expect(l.get(id)?.allow, id).toBe(true);
    for (const [id, info] of l) if (/NC|ND/.test(id)) expect(info.allow, id).toBe(false);
    expect(l.get('CC-BY-SA-3.0')?.shareAlike).toBe(true);
    expect(l.get('CC-BY-4.0')?.modifiedNote).toBe(true);
    expect(l.get('MIT')?.notice).toBe(true);
  });

  it('requires allow to be stated', () => {
    expect(() => decodeLicenses({ licenses: { X: { name: 'X', url: 'https://x' } } })).toThrow(
      /allow must be stated/,
    );
  });
});

describe('taxonomy.yaml and overrides', () => {
  it('maps source categories only to known categories', () => {
    const t = loadTaxonomy(root);
    expect(t.categories[0]?.id).toBe('cells');
    expect(() =>
      decodeTaxonomy({
        categories: [{ id: 'a', title: 'A' }],
        sourceCategories: { s: { X: 'b' } },
      }),
    ).toThrow(/unknown category "b"/);
  });

  it('needs a reason to exclude an icon', () => {
    const t = loadTaxonomy(root);
    expect(() => decodeOverrides({ overrides: [{ id: 'a', exclude: true }] }, 'o', t)).toThrow(
      /needs a reason/,
    );
    expect(decodeOverrides({ overrides: [{ id: 'a', title: 'B' }] }, 'o', t)).toEqual([
      { id: 'a', title: 'B' },
    ]);
  });

  it('reads the house icons with at least 3 tags each', () => {
    const h = loadHouse(root, loadTaxonomy(root));
    expect(h.length).toBeGreaterThanOrEqual(39);
    for (const i of h) expect(i.tags.length).toBeGreaterThanOrEqual(3);
  });
});
