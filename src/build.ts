/**
 * The build (plan §3): every enabled source → collect → overrides →
 * licence gate → normalise (worker pool) → category → de-duplicate →
 * dist/ (manifest, shards, SVGs, sprite sheets, search index, CREDITS.md,
 * LICENSES/) and REPORT.md. Deterministic for the pinned sources.
 */
import { mkdirSync, rmSync, statSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  type LicenseTable,
  type SourceConfig,
  type Taxonomy,
  loadLicenses,
  loadOverrides,
  loadSources,
  loadTaxonomy,
} from './config.ts';
import { readFetchRecord, rawDir } from './fetch.ts';
import {
  type IconEntry,
  type LibraryManifest,
  type SourceInfo,
  LIBRARY_FORMAT,
  LIBRARY_FORMAT_VERSION,
  LIBRARY_ID,
  THUMB_COLUMNS,
  THUMB_PER_SHEET,
  THUMB_SIZE,
} from './format.ts';
import { contentHash } from './hash.ts';
import type { NormalizeResult } from './normalize.ts';
import type { Done, Job } from './normalizeWorker.ts';
import { type Rejection, creditsMarkdown, licenseFiles, reportMarkdown } from './report.ts';
import { buildSearchIndex } from './searchIndex.ts';
import { collectBioicons } from './sources/bioicons.ts';
import { collectHealthIcons } from './sources/healthicons.ts';
import { collectHouse } from './sources/house.ts';
import type { Collected, RawIcon } from './sources/types.ts';
import { writeSprites } from './thumbs.ts';

export interface BuildOptions {
  readonly version: string;
  readonly out?: string;
  /** Only these sources (default: every enabled one). */
  readonly only?: readonly string[];
  /** Keep only the first N icons per source (quick runs and fixtures). */
  readonly limit?: number;
  readonly thumbs?: boolean;
  /** Write REPORT.md at the repository root (full builds only). */
  readonly report?: boolean;
  readonly log?: (s: string) => void;
}

function collect(root: string, src: SourceConfig, taxonomy: Taxonomy): Collected {
  switch (src.id) {
    case 'house':
      return collectHouse(src, root, taxonomy);
    case 'healthicons':
    case 'bioicons': {
      const dir = rawDir(root, src.id);
      if (!existsSync(dir)) throw new Error(`${src.id}: not fetched (npm run fetch)`);
      const rec = readFetchRecord(dir);
      if (src.fetch.method === 'git' && rec?.commit !== src.fetch.commit)
        throw new Error(`${src.id}: raw/ is not at the pinned commit (npm run fetch)`);
      return src.id === 'bioicons' ? collectBioicons(src, dir) : collectHealthIcons(src, dir);
    }
    default:
      throw new Error(`${src.id}: enabled, but no collector exists for it (src/build.ts)`);
  }
}

async function normalizeAll(
  jobs: readonly Job[],
  log: (s: string) => void,
): Promise<Map<number, NormalizeResult>> {
  const results = new Map<number, NormalizeResult>();
  const threads = Math.max(1, Math.min(availableParallelism() - 1, 8));
  const BATCH = 16;
  let next = 0;
  let done = 0;
  const workerUrl = new URL('./normalizeWorker.ts', import.meta.url);
  await Promise.all(
    Array.from({ length: threads }, () => {
      return new Promise<void>((resolve, reject) => {
        const w = new Worker(workerUrl);
        const feed = (): void => {
          if (next >= jobs.length) {
            void w.terminate().then(() => {
              resolve();
            });
            return;
          }
          const batch = jobs.slice(next, next + BATCH);
          next += BATCH;
          w.postMessage(batch);
        };
        w.on('message', (out: readonly Done[]) => {
          for (const d of out) results.set(d.n, d.result);
          const before = done;
          done += out.length;
          if (Math.floor(before / 500) !== Math.floor(done / 500))
            log(`  normalised ${String(done)}/${String(jobs.length)}`);
          feed();
        });
        w.on('error', reject);
        feed();
      });
    }),
  );
  return results;
}

const encodePath = (p: string): string => p.split('/').map(encodeURIComponent).join('/');

function originalUrl(src: SourceConfig, key: string): string {
  const commit = src.fetch.method === 'git' ? src.fetch.commit : 'main';
  return (src.originalUrl ?? src.homepage)
    .replace('{commit}', commit)
    .replace('{path}', encodePath(key));
}

function dirBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    total += st.isDirectory() ? dirBytes(p) : st.size;
  }
  return total;
}

export async function build(
  root: string,
  opts: BuildOptions,
): Promise<{
  manifest: LibraryManifest;
  entries: IconEntry[];
  rejections: Rejection[];
}> {
  const log =
    opts.log ??
    ((s: string) => {
      console.log(s);
    });
  const out = opts.out ?? join(root, 'dist');
  const sources = loadSources(root);
  const licenses: LicenseTable = loadLicenses(root);
  const taxonomy = loadTaxonomy(root);
  const active = sources.filter((s) =>
    opts.only ? opts.only.includes(s.id) : s.enabled && s.fetch.method !== 'none',
  );
  // Priority for de-duplication: house first, then the order of `only` / folder order.
  active.sort((a, b) => (a.id === 'house' ? -1 : b.id === 'house' ? 1 : 0));

  const rejections: Rejection[] = [];
  const candidates: { raw: RawIcon; src: SourceConfig; category: string }[] = [];
  const ids = new Set<string>();
  for (const src of active) {
    const c = collect(root, src, taxonomy);
    rejections.push(...c.skipped);
    const overrides = loadOverrides(root, src.id, taxonomy);
    const unknownOverrides = new Set(overrides.keys());
    let icons = c.icons;
    if (opts.limit !== undefined) icons = icons.slice(0, opts.limit);
    for (let raw of icons) {
      const ov = overrides.get(raw.id);
      unknownOverrides.delete(raw.id);
      if (ov?.exclude) {
        rejections.push({ source: src.id, key: raw.key, reason: `excluded: ${ov.reason ?? ''}` });
        continue;
      }
      if (ov)
        raw = {
          ...raw,
          ...(ov.title === undefined ? {} : { title: ov.title }),
          ...(ov.tags === undefined ? {} : { tags: ov.tags }),
          ...(ov.category === undefined ? {} : { category: ov.category }),
          ...(ov.author === undefined ? {} : { author: ov.author }),
        };
      const lic = licenses.get(raw.license);
      if (!lic?.allow) {
        rejections.push({
          source: src.id,
          key: raw.key,
          reason: lic ? `licence ${raw.license} is not allowed` : `unknown licence ${raw.license}`,
        });
        continue;
      }
      const category =
        raw.category ??
        (raw.sourceCategory === undefined
          ? undefined
          : taxonomy.sourceCategories.get(src.id)?.get(raw.sourceCategory));
      if (category === undefined)
        throw new Error(
          `${src.id}: category "${raw.sourceCategory ?? '?'}" is not mapped in taxonomy.yaml`,
        );
      if (ids.has(raw.id)) throw new Error(`duplicate icon id ${raw.id}`);
      ids.add(raw.id);
      candidates.push({ raw, src, category });
    }
    if (opts.limit === undefined)
      for (const k of unknownOverrides) log(`warning: override for unknown icon ${src.id}/${k}`);
  }

  log(`normalising ${String(candidates.length)} icons…`);
  const results = await normalizeAll(
    candidates.map((c, n) => ({ n, file: c.raw.file, opts: c.raw.normalize })),
    log,
  );

  rmSync(out, { recursive: true, force: true });
  for (const d of ['svg', 'shards', 'thumbs', 'LICENSES'])
    mkdirSync(join(out, d), { recursive: true });

  const warnings = new Map<string, number>();
  // Normaliser notes that leave the artwork as drawn; any other note marks the icon adapted.
  const COSMETIC_WARNINGS = new Set(['script removed']);
  const byHash = new Map<string, string>();
  const entries: IconEntry[] = [];
  const geometry = new Map<string, { svg: string; width: number; height: number }>();
  let svgBytes = 0;
  candidates.forEach((c, n) => {
    const r = results.get(n);
    if (!r) throw new Error(`no result for ${c.raw.id}`);
    if (!r.ok) {
      rejections.push({ source: c.src.id, key: c.raw.key, reason: r.reason });
      return;
    }
    const hash = contentHash(r.svg);
    const dup = byHash.get(hash);
    if (dup !== undefined) {
      rejections.push({ source: c.src.id, key: c.raw.key, reason: `duplicate of ${dup}` });
      return;
    }
    byHash.set(hash, c.raw.id);
    for (const w of r.warnings) warnings.set(w, (warnings.get(w) ?? 0) + 1);
    const lic = licenses.get(c.raw.license);
    if (!lic) throw new Error('unreachable');
    writeFileSync(join(out, 'svg', `${hash}.svg`), r.svg);
    svgBytes += r.svg.length;
    geometry.set(c.raw.id, { svg: r.svg, width: r.width, height: r.height });
    entries.push({
      id: c.raw.id,
      title: c.raw.title,
      tags: [...c.raw.tags],
      category: c.category,
      hash,
      svg: `svg/${hash}.svg`,
      slots: r.slots,
      recolor: r.recolor,
      meta: {
        library: LIBRARY_ID,
        libraryVersion: opts.version,
        id: c.raw.id,
        title: c.raw.title,
        source: c.src.name,
        author: c.raw.author,
        license: c.raw.license,
        licenseUrl: lic.url,
        originalUrl: originalUrl(c.src, c.raw.key),
        shareAlike: lic.shareAlike,
        ...(r.warnings.some((w) => !COSMETIC_WARNINGS.has(w)) ? { adapted: true as const } : {}),
      },
    });
  });

  // Categories in taxonomy order; icons by title, then id.
  const categories: LibraryManifest['categories'][number][] = [];
  const shardEntries: IconEntry[] = [];
  for (const cat of taxonomy.categories) {
    const list = entries
      .filter((e) => e.category === cat.id)
      .sort((a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id));
    if (list.length === 0) continue;
    let sheets: string[] = [];
    if (opts.thumbs !== false) {
      log(`  thumbnails: ${cat.id} (${String(list.length)})`);
      sheets = await writeSprites(
        join(out, 'thumbs'),
        cat.id,
        list.map((e) => {
          const g = geometry.get(e.id);
          if (!g) throw new Error('unreachable');
          return g;
        }),
      );
    }
    const withThumbs = list.map((e, i) => {
      const sheet = sheets[Math.floor(i / THUMB_PER_SHEET)];
      return sheet === undefined
        ? e
        : { ...e, thumb: { sheet: `thumbs/${sheet}`, i: i % THUMB_PER_SHEET } };
    });
    shardEntries.push(...withThumbs);
    writeFileSync(
      join(out, 'shards', `${cat.id}.json`),
      `${JSON.stringify({ category: cat.id, icons: withThumbs })}\n`,
    );
    categories.push({
      id: cat.id,
      title: cat.title,
      count: list.length,
      shard: `shards/${cat.id}.json`,
      shareAlike: list.filter((e) => e.meta.shareAlike).length,
    });
  }

  const sourceInfos: SourceInfo[] = active
    .filter((s) => entries.some((e) => e.meta.source === s.name))
    .map((s) => {
      const lic = licenses.get(s.license);
      return {
        id: s.id,
        name: s.name,
        homepage: s.homepage,
        license: s.license,
        licenseUrl: lic?.url ?? s.termsUrl ?? s.homepage,
        ...(s.attribution === undefined ? {} : { attribution: s.attribution }),
        ...(s.fetch.method === 'git' ? { commit: s.fetch.commit } : {}),
        termsChecked: s.termsChecked,
      };
    });

  const manifest: LibraryManifest = {
    format: LIBRARY_FORMAT,
    formatVersion: LIBRARY_FORMAT_VERSION,
    library: LIBRARY_ID,
    version: opts.version,
    categories,
    sources: sourceInfos,
    ...(opts.thumbs === false
      ? {}
      : { thumbs: { size: THUMB_SIZE, columns: THUMB_COLUMNS, ext: '.webp', hiDpi: '@2x' } }),
    search: 'search-index.json',
    credits: 'CREDITS.md',
    licenses: 'LICENSES/',
  };
  const manifestText = `${JSON.stringify(manifest, null, 1)}\n`;
  writeFileSync(join(out, 'manifest.json'), manifestText);

  const search = `${JSON.stringify(buildSearchIndex(shardEntries, taxonomy))}\n`;
  writeFileSync(join(out, 'search-index.json'), search);
  writeFileSync(join(out, 'CREDITS.md'), creditsMarkdown(manifest, entries, active, licenses));
  for (const [name, text] of licenseFiles(entries, licenses))
    writeFileSync(join(out, 'LICENSES', name), text);

  const first = categories[0];
  const firstPayload = manifestText.length + (first ? statSync(join(out, first.shard)).size : 0);
  if (opts.report === true)
    writeFileSync(
      join(root, 'REPORT.md'),
      reportMarkdown(manifest, {
        entries,
        rejections,
        warnings,
        sizes: {
          svgBytes,
          firstPayload,
          searchIndex: search.length,
          thumbs: dirBytes(join(out, 'thumbs')),
        },
      }),
    );
  log(
    `built ${String(entries.length)} icons in ${String(categories.length)} categories; ` +
      `${String(rejections.length)} rejected or skipped; first payload ${String(Math.round(firstPayload / 1000))} kB`,
  );
  return { manifest, entries, rejections };
}
