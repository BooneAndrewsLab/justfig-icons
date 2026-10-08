/**
 * The repository's YAML inputs and their schemas, decoded strictly so a
 * typo fails the build with the file and key named:
 *
 *   sources/<id>/source.yaml   SourceConfig
 *   licenses.yaml              LicenseTable
 *   taxonomy.yaml              Taxonomy
 *   overrides/<src>/*.yaml     Override[]
 *   house/meta.yaml            HouseMeta
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

type Obj = Record<string, unknown>;

class At {
  readonly where: string;
  constructor(where: string) {
    this.where = where;
  }
  key(k: string | number): At {
    return new At(`${this.where}.${String(k)}`);
  }
  fail(msg: string): never {
    throw new ConfigError(`${this.where}: ${msg}`);
  }
}

function obj(v: unknown, at: At): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) at.fail('expected a mapping');
  return v as Obj;
}
function str(v: unknown, at: At): string {
  if (typeof v !== 'string' || v.trim() === '') at.fail('expected a non-empty string');
  return v;
}
function optStr(v: unknown, at: At): string | undefined {
  return v === undefined || v === null ? undefined : str(v, at);
}
function bool(v: unknown, at: At, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  if (typeof v !== 'boolean') at.fail('expected true or false');
  return v;
}
function strList(v: unknown, at: At): string[] {
  if (!Array.isArray(v)) at.fail('expected a list');
  return v.map((x, i) => str(typeof x === 'number' ? String(x) : x, at.key(i)));
}
function onlyKeys(o: Obj, keys: readonly string[], at: At): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) at.key(k).fail('unknown key');
}
/** YAML turns 2026-10-08 into a Date; keep it as the ISO day. */
function day(v: unknown, at: At): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = str(v, at);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) at.fail('expected YYYY-MM-DD');
  return s;
}

function load(path: string): unknown {
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch (e: unknown) {
    throw new ConfigError(`${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// --- source.yaml ---------------------------------------------------------------------------

export type FetchConfig =
  | {
      readonly method: 'git';
      readonly url: string;
      readonly commit: string;
      readonly paths: string[];
    }
  | { readonly method: 'local'; readonly path: string }
  | { readonly method: 'manual'; readonly path: string }
  | { readonly method: 'none' };

export interface SourceConfig {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly homepage: string;
  /** An SPDX id, or `per-icon` when every icon declares its own. */
  readonly license: string;
  /** Default author when icons carry none. */
  readonly author?: string;
  /** Required credit wording, shown with the source in the app. */
  readonly attribution?: string;
  readonly fetch: FetchConfig;
  /** Template with {commit} and {path}. */
  readonly originalUrl?: string;
  readonly licenseMap?: Readonly<Record<string, string>>;
  readonly termsChecked: string;
  readonly termsUrl?: string;
  readonly notes?: string;
}

export function decodeSource(v: unknown, file: string): SourceConfig {
  const at = new At(file);
  const o = obj(v, at);
  onlyKeys(
    o,
    [
      'id',
      'name',
      'enabled',
      'homepage',
      'license',
      'author',
      'attribution',
      'fetch',
      'originalUrl',
      'licenseMap',
      'termsChecked',
      'termsUrl',
      'notes',
    ],
    at,
  );
  const f = obj(o['fetch'], at.key('fetch'));
  const fa = at.key('fetch');
  let fetch: FetchConfig;
  switch (f['method']) {
    case 'git': {
      onlyKeys(f, ['method', 'url', 'commit', 'paths'], fa);
      const commit = str(f['commit'], fa.key('commit'));
      if (!/^[0-9a-f]{40}$/.test(commit)) fa.key('commit').fail('expected a full 40-hex commit');
      const url = str(f['url'], fa.key('url'));
      if (!url.startsWith('https://')) fa.key('url').fail('expected an https URL');
      fetch = { method: 'git', url, commit, paths: strList(f['paths'] ?? [], fa.key('paths')) };
      break;
    }
    case 'local':
    case 'manual':
      onlyKeys(f, ['method', 'path'], fa);
      fetch = { method: f['method'], path: str(f['path'], fa.key('path')) };
      break;
    case 'none':
      onlyKeys(f, ['method'], fa);
      fetch = { method: 'none' };
      break;
    default:
      return fa.key('method').fail('expected git, local, manual or none');
  }
  let licenseMap: Record<string, string> | undefined;
  if (o['licenseMap'] !== undefined) {
    const m = obj(o['licenseMap'], at.key('licenseMap'));
    licenseMap = {};
    for (const [k, x] of Object.entries(m)) licenseMap[k] = str(x, at.key('licenseMap').key(k));
  }
  const enabled = bool(o['enabled'], at.key('enabled'), true);
  const out: SourceConfig = {
    id: str(o['id'], at.key('id')),
    name: str(o['name'], at.key('name')),
    enabled,
    homepage: str(o['homepage'], at.key('homepage')),
    license: str(o['license'], at.key('license')),
    fetch,
    termsChecked: day(o['termsChecked'], at.key('termsChecked')),
    ...opt('author', optStr(o['author'], at.key('author'))),
    ...opt('attribution', optStr(o['attribution'], at.key('attribution'))),
    ...opt('originalUrl', optStr(o['originalUrl'], at.key('originalUrl'))),
    ...opt('licenseMap', licenseMap),
    ...opt('termsUrl', optStr(o['termsUrl'], at.key('termsUrl'))),
    ...opt('notes', optStr(o['notes'], at.key('notes'))),
  };
  if (enabled && fetch.method !== 'none' && out.originalUrl === undefined)
    at.key('originalUrl').fail('an enabled source needs an originalUrl template');
  return out;
}

function opt<K extends string, V>(k: K, v: V | undefined): Partial<Record<K, V>> {
  return v === undefined ? {} : ({ [k]: v } as Record<K, V>);
}

export function loadSources(root: string): SourceConfig[] {
  const dir = join(root, 'sources');
  return readdirSync(dir)
    .sort()
    .filter((d) => existsSync(join(dir, d, 'source.yaml')))
    .map((d) => {
      const file = `sources/${d}/source.yaml`;
      const s = decodeSource(load(join(root, file)), file);
      if (s.id !== d) throw new ConfigError(`${file}: id "${s.id}" must match its folder "${d}"`);
      return s;
    });
}

// --- licenses.yaml -------------------------------------------------------------------------

export interface LicenseInfo {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly allow: boolean;
  readonly shareAlike: boolean;
  readonly attribution: boolean;
  readonly modifiedNote: boolean;
  readonly notice: boolean;
}
export type LicenseTable = ReadonlyMap<string, LicenseInfo>;

export function decodeLicenses(v: unknown, file = 'licenses.yaml'): LicenseTable {
  const at = new At(file);
  const o = obj(v, at);
  onlyKeys(o, ['licenses'], at);
  const l = obj(o['licenses'], at.key('licenses'));
  const out = new Map<string, LicenseInfo>();
  for (const [id, x] of Object.entries(l)) {
    const a = at.key('licenses').key(id);
    const e = obj(x, a);
    onlyKeys(e, ['name', 'url', 'allow', 'shareAlike', 'attribution', 'modifiedNote', 'notice'], a);
    if (typeof e['allow'] !== 'boolean') a.key('allow').fail('allow must be stated');
    out.set(id, {
      id,
      name: str(e['name'], a.key('name')),
      url: str(e['url'], a.key('url')),
      allow: e['allow'] as boolean,
      shareAlike: bool(e['shareAlike'], a.key('shareAlike'), false),
      attribution: bool(e['attribution'], a.key('attribution'), false),
      modifiedNote: bool(e['modifiedNote'], a.key('modifiedNote'), false),
      notice: bool(e['notice'], a.key('notice'), false),
    });
  }
  return out;
}

export const loadLicenses = (root: string): LicenseTable =>
  decodeLicenses(load(join(root, 'licenses.yaml')));

// --- taxonomy.yaml -------------------------------------------------------------------------

export interface Category {
  readonly id: string;
  readonly title: string;
  readonly synonyms: readonly string[];
}
export interface Taxonomy {
  readonly categories: readonly Category[];
  /** source id → source category → category id */
  readonly sourceCategories: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly synonyms: readonly (readonly string[])[];
}

export function decodeTaxonomy(v: unknown, file = 'taxonomy.yaml'): Taxonomy {
  const at = new At(file);
  const o = obj(v, at);
  onlyKeys(o, ['categories', 'sourceCategories', 'synonyms'], at);
  if (!Array.isArray(o['categories'])) at.key('categories').fail('expected a list');
  const categories = (o['categories'] as unknown[]).map((x, i) => {
    const a = at.key('categories').key(i);
    const c = obj(x, a);
    onlyKeys(c, ['id', 'title', 'synonyms'], a);
    const id = str(c['id'], a.key('id'));
    if (!/^[a-z][a-z0-9-]*$/.test(id)) a.key('id').fail('expected a kebab-case id');
    return {
      id,
      title: str(c['title'], a.key('title')),
      synonyms: strList(c['synonyms'] ?? [], a.key('synonyms')),
    };
  });
  const ids = new Set(categories.map((c) => c.id));
  if (ids.size !== categories.length) at.key('categories').fail('duplicate category id');
  const sourceCategories = new Map<string, Map<string, string>>();
  const sc = obj(o['sourceCategories'] ?? {}, at.key('sourceCategories'));
  for (const [src, m] of Object.entries(sc)) {
    const a = at.key('sourceCategories').key(src);
    const map = new Map<string, string>();
    for (const [k, x] of Object.entries(obj(m, a))) {
      const target = str(x, a.key(k));
      if (!ids.has(target)) a.key(k).fail(`unknown category "${target}"`);
      map.set(k, target);
    }
    sourceCategories.set(src, map);
  }
  if (!Array.isArray(o['synonyms'] ?? [])) at.key('synonyms').fail('expected a list');
  const synonyms = ((o['synonyms'] ?? []) as unknown[]).map((g, i) =>
    strList(g, at.key('synonyms').key(i)).map((s) => s.toLowerCase()),
  );
  return { categories, sourceCategories, synonyms };
}

export const loadTaxonomy = (root: string): Taxonomy =>
  decodeTaxonomy(load(join(root, 'taxonomy.yaml')));

// --- overrides/<src>/*.yaml ----------------------------------------------------------------

export interface Override {
  /** The icon's library id (e.g. `bi-erythrocyte-5`). */
  readonly id: string;
  readonly exclude?: boolean;
  readonly reason?: string;
  readonly title?: string;
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly author?: string;
}

export function decodeOverrides(v: unknown, file: string, taxonomy: Taxonomy): Override[] {
  const at = new At(file);
  const o = obj(v, at);
  onlyKeys(o, ['overrides'], at);
  if (!Array.isArray(o['overrides'])) at.key('overrides').fail('expected a list');
  const cats = new Set(taxonomy.categories.map((c) => c.id));
  return (o['overrides'] as unknown[]).map((x, i) => {
    const a = at.key('overrides').key(i);
    const e = obj(x, a);
    onlyKeys(e, ['id', 'exclude', 'reason', 'title', 'tags', 'category', 'author'], a);
    const exclude = bool(e['exclude'], a.key('exclude'), false);
    const reason = optStr(e['reason'], a.key('reason'));
    if (exclude && reason === undefined) a.key('reason').fail('an exclusion needs a reason');
    const category = optStr(e['category'], a.key('category'));
    if (category !== undefined && !cats.has(category))
      a.key('category').fail(`unknown category "${category}"`);
    return {
      id: str(e['id'], a.key('id')),
      ...(exclude ? { exclude } : {}),
      ...opt('reason', reason),
      ...opt('title', optStr(e['title'], a.key('title'))),
      ...opt('tags', e['tags'] === undefined ? undefined : strList(e['tags'], a.key('tags'))),
      ...opt('category', category),
      ...opt('author', optStr(e['author'], a.key('author'))),
    };
  });
}

export function loadOverrides(
  root: string,
  source: string,
  taxonomy: Taxonomy,
): Map<string, Override> {
  const dir = join(root, 'overrides', source);
  const out = new Map<string, Override>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.yaml')) continue;
    const file = `overrides/${source}/${f}`;
    for (const ov of decodeOverrides(load(join(root, file)), file, taxonomy)) {
      if (out.has(ov.id)) throw new ConfigError(`${file}: ${ov.id} is overridden twice`);
      out.set(ov.id, ov);
    }
  }
  return out;
}

// --- house/meta.yaml -----------------------------------------------------------------------

export interface HouseIcon {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly category: string;
  readonly slots: readonly { id: string; label: string; default: string }[];
  readonly author: string;
  readonly license: string;
}

export function decodeHouse(v: unknown, taxonomy: Taxonomy, file = 'house/meta.yaml'): HouseIcon[] {
  const at = new At(file);
  const o = obj(v, at);
  onlyKeys(o, ['author', 'license', 'icons'], at);
  const author = str(o['author'], at.key('author'));
  const license = str(o['license'], at.key('license'));
  const cats = new Set(taxonomy.categories.map((c) => c.id));
  return Object.entries(obj(o['icons'], at.key('icons'))).map(([id, x]) => {
    const a = at.key('icons').key(id);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) a.fail('icon ids are kebab-case');
    const e = obj(x, a);
    onlyKeys(e, ['title', 'tags', 'category', 'slots', 'author', 'license'], a);
    const tags = strList(e['tags'], a.key('tags'));
    if (tags.length < 3) a.key('tags').fail('at least 3 tags');
    const category = str(e['category'], a.key('category'));
    if (!cats.has(category)) a.key('category').fail(`unknown category "${category}"`);
    if (!Array.isArray(e['slots'])) a.key('slots').fail('expected a list');
    const slots = (e['slots'] as unknown[]).map((s, i) => {
      const b = a.key('slots').key(i);
      const so = obj(s, b);
      onlyKeys(so, ['id', 'label', 'default'], b);
      const d = str(so['default'], b.key('default')).toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(d)) b.key('default').fail('expected #rrggbb');
      return {
        id: str(so['id'], b.key('id')),
        label: str(so['label'], b.key('label')),
        default: d,
      };
    });
    const lic = optStr(e['license'], a.key('license')) ?? license;
    if (lic !== 'CC0-1.0' && lic !== 'CC-BY-4.0')
      a.key('license').fail('house icons are CC0-1.0 or CC-BY-4.0');
    return {
      id,
      title: str(e['title'], a.key('title')),
      tags,
      category,
      slots,
      author: optStr(e['author'], a.key('author')) ?? author,
      license: lic,
    };
  });
}

export const loadHouse = (root: string, taxonomy: Taxonomy): HouseIcon[] =>
  decodeHouse(load(join(root, 'house', 'meta.yaml')), taxonomy);
