/**
 * Release validation (plan §3, "validate.ts fails the build"): reads dist/
 * back as the app would and checks every icon. Licence errors (missing or
 * disallowed licence, author or source URL, a share-alike flag that does not
 * match the licence) are counted separately, since the release gate is
 * "zero licence errors".
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { LicenseTable } from './config.ts';
import {
  type IconEntry,
  type LibraryManifest,
  type LibraryShard,
  type SearchIndexFile,
  LIBRARY_FORMAT,
} from './format.ts';
import { contentHash } from './hash.ts';
import { MAX_BYTES, MAX_NODES } from './normalize.ts';
import { sanitizeSvg } from './sanitize.ts';
import { loadSearchIndex } from './searchIndex.ts';
import { walkNodes } from './svgNode.ts';
import { parseXml } from './xml.ts';

export const FIRST_PAYLOAD_BUDGET = 300_000;
export const SEARCH_BUDGET_MS = 100;

export interface ValidationResult {
  readonly icons: number;
  readonly licenseErrors: string[];
  readonly errors: string[];
  readonly firstPayload: number;
  readonly searchMs: number;
}

const HEX = /^#[0-9a-f]{6}$/;
const PATH_ATTRS = new Set([
  'd',
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'data-slot',
  'data-tone',
]);
const G_ATTRS = new Set(['opacity', 'data-part']);

/** Problems with one normalised SVG against its entry; [] when clean. */
export function checkSvg(svg: string, entry: Pick<IconEntry, 'slots' | 'recolor'>): string[] {
  const out: string[] = [];
  if (svg.length > MAX_BYTES) out.push(`SVG is ${String(svg.length)} bytes`);
  let root;
  try {
    root = parseXml(svg);
  } catch (e: unknown) {
    return [`SVG does not parse: ${String(e)}`];
  }
  if (root.tag !== 'svg') return ['root is not <svg>'];
  const vb = String(root.attrs['viewBox'] ?? '')
    .split(' ')
    .map(Number);
  if (vb.length !== 4 || vb[0] !== 0 || vb[1] !== 0) out.push('viewBox must start at 0 0');
  else if (Math.abs(Math.max(vb[2] ?? 0, vb[3] ?? 0) - 100) > 0.011)
    out.push(`viewBox longer side is ${String(Math.max(vb[2] ?? 0, vb[3] ?? 0))}, not 100`);
  for (const k of Object.keys(root.attrs))
    if (k !== 'viewBox' && k !== 'xmlns') out.push(`<svg ${k}> is not allowed`);
  const slots = new Set(entry.slots.map((s) => s.id));
  let nodes = 0;
  for (const n of walkNodes(root)) {
    if (n === root) continue;
    nodes += 1;
    if (n.tag === 'g') {
      for (const k of Object.keys(n.attrs))
        if (!G_ATTRS.has(k)) out.push(`<g ${k}> is not allowed`);
      continue;
    }
    if (n.tag !== 'path') {
      out.push(`<${n.tag}> is not allowed`);
      continue;
    }
    for (const k of Object.keys(n.attrs))
      if (!PATH_ATTRS.has(k)) out.push(`<path ${k}> is not allowed`);
    const fill = String(n.attrs['fill'] ?? '');
    const stroke = String(n.attrs['stroke'] ?? 'none');
    for (const [k, v] of [
      ['fill', fill],
      ['stroke', stroke],
    ] as const)
      if (v !== 'none' && !HEX.test(v)) out.push(`${k}="${v}" is not #rrggbb or none`);
    if (fill === 'none' && stroke === 'none') out.push('a path paints nothing');
    const slot = n.attrs['data-slot'];
    if (typeof slot !== 'string') out.push('a painted element has no data-slot');
    else if (!slots.has(slot)) out.push(`data-slot="${slot}" is not one of the entry's slots`);
    const tone = n.attrs['data-tone'];
    if (tone !== undefined && !Number.isFinite(Number(tone)))
      out.push(`data-tone="${String(tone)}"`);
    if (entry.recolor === 'whole' && tone !== undefined)
      out.push('a whole-recolour icon has a tone');
  }
  if (nodes > MAX_NODES) out.push(`${String(nodes)} elements (limit ${String(MAX_NODES)})`);
  // The app sanitises every placed icon; a normalised icon must pass untouched.
  const s = sanitizeSvg(svg);
  if (s.warnings.length > 0) out.push(`the app's sanitiser warns: ${s.warnings.join('; ')}`);
  return [...new Set(out)];
}

/** Brand names of the logos excluded as trademarks (the trademark-logos.yaml overrides). */
export const TRADEMARK_NAMES =
  /\b(pytorch|tensorflow|jupyter|keras|python|nvidia|colab|galaxy|gromacs|openmm|julia|rust|nf-core|pubchem|geo logo|excel|fhir\d*|hl7(?:v\d)?|dhis\d*|openmrs|simple logo|simple\.org)\b/i;

/** Product brands that name lab equipment: a title says what the icon is, the brand may be a tag. */
export const BRAND_TITLES =
  /\b(falcon|agilent|tecan|illumina|miseq|nextseq|novaseq|pacbio|nanopore|eppendorf|gilson|corning|thermo|biorad|bio-rad|nikon|zeiss|leica|olympus|qiagen|beckman|sartorius|biorender)\b/i;

export function validateDist(dist: string, licenses: LicenseTable): ValidationResult {
  const errors: string[] = [];
  const licenseErrors: string[] = [];
  const read = (p: string): string => readFileSync(join(dist, p), 'utf8');
  if (!existsSync(join(dist, 'manifest.json')))
    return {
      icons: 0,
      licenseErrors,
      errors: ['no manifest.json (npm run build)'],
      firstPayload: 0,
      searchMs: 0,
    };
  const manifestText = read('manifest.json');
  const manifest = JSON.parse(manifestText) as LibraryManifest;
  if ((manifest.format as string) !== LIBRARY_FORMAT) errors.push('manifest: wrong format id');
  if (manifest.formatVersion !== 1) errors.push('manifest: formatVersion must be 1');
  const sourceNames = new Set(manifest.sources.map((s) => s.name));
  const ids = new Set<string>();
  const hashes = new Map<string, string>();
  const all: IconEntry[] = [];
  for (const cat of manifest.categories) {
    const shard = JSON.parse(read(cat.shard)) as LibraryShard;
    if (shard.category !== cat.id) errors.push(`${cat.shard}: category ${shard.category}`);
    if (shard.icons.length !== cat.count)
      errors.push(
        `${cat.id}: manifest count ${String(cat.count)}, shard has ${String(shard.icons.length)}`,
      );
    const sa = shard.icons.filter((e) => e.meta.shareAlike).length;
    if (cat.shareAlike !== undefined && cat.shareAlike !== sa)
      errors.push(`${cat.id}: shareAlike count ${String(cat.shareAlike)}, shard has ${String(sa)}`);
    for (const e of shard.icons) {
      const at = `${cat.id}/${e.id}`;
      all.push(e);
      if (ids.has(e.id)) errors.push(`${at}: duplicate id`);
      ids.add(e.id);
      if (e.category !== cat.id) errors.push(`${at}: category ${e.category}`);
      if (e.title.trim() === '' || e.meta.title !== e.title) errors.push(`${at}: title`);
      if (e.meta.id !== e.id) errors.push(`${at}: meta.id`);
      if (TRADEMARK_NAMES.test(e.title) || TRADEMARK_NAMES.test(e.id.replace(/-/g, ' ')))
        errors.push(`${at}: looks like a trademark logo (not accepted, see CONTRIBUTING.md)`);
      if (BRAND_TITLES.test(e.title))
        errors.push(
          `${at}: title names a product brand (use a generic title, see CONTRIBUTING.md)`,
        );
      if (e.meta.libraryVersion !== manifest.version) errors.push(`${at}: meta.libraryVersion`);
      // Licence metadata.
      const m = e.meta;
      const lic = licenses.get(m.license);
      if (!m.license) licenseErrors.push(`${at}: no licence`);
      else if (!lic) licenseErrors.push(`${at}: licence ${m.license} is not in licenses.yaml`);
      else {
        if (!lic.allow) licenseErrors.push(`${at}: licence ${m.license} is not allowed`);
        if (m.licenseUrl !== lic.url) licenseErrors.push(`${at}: licenseUrl ${m.licenseUrl}`);
        if (m.shareAlike !== lic.shareAlike) licenseErrors.push(`${at}: shareAlike flag`);
      }
      if (!m.author?.trim()) licenseErrors.push(`${at}: no author`);
      if (!m.source.trim() || !sourceNames.has(m.source))
        licenseErrors.push(`${at}: source "${m.source}"`);
      if (!/^https:\/\/\S+$/.test(m.originalUrl)) licenseErrors.push(`${at}: originalUrl`);
      // Slots.
      if (e.slots.length === 0) errors.push(`${at}: no slots`);
      if (new Set(e.slots.map((s) => s.id)).size !== e.slots.length)
        errors.push(`${at}: duplicate slot`);
      for (const s of e.slots) if (!HEX.test(s.default)) errors.push(`${at}: slot ${s.id} default`);
      if (e.recolor === 'whole' && (e.slots.length !== 1 || e.slots[0]?.id !== 'all'))
        errors.push(`${at}: a whole-recolour icon has one slot "all"`);
      // SVG.
      if (e.svg !== `svg/${e.hash}.svg`) errors.push(`${at}: svg path`);
      const dup = hashes.get(e.hash);
      if (dup !== undefined) errors.push(`${at}: same content as ${dup}`);
      hashes.set(e.hash, e.id);
      if (!existsSync(join(dist, e.svg))) {
        errors.push(`${at}: missing ${e.svg}`);
        continue;
      }
      const svg = read(e.svg);
      if (contentHash(svg) !== e.hash) errors.push(`${at}: hash does not match the SVG`);
      for (const p of checkSvg(svg, e)) errors.push(`${at}: ${p}`);
      if (e.thumb && manifest.thumbs) {
        for (const suffix of ['', manifest.thumbs.hiDpi])
          if (!existsSync(join(dist, `${e.thumb.sheet}${suffix}${manifest.thumbs.ext}`)))
            errors.push(`${at}: missing sprite ${e.thumb.sheet}${suffix}`);
      } else if (manifest.thumbs) errors.push(`${at}: no thumbnail`);
    }
  }
  // Notices travel with the icons.
  if (!existsSync(join(dist, 'CREDITS.md'))) licenseErrors.push('CREDITS.md is missing');
  if (!existsSync(join(dist, 'LICENSES', 'README.md')))
    licenseErrors.push('LICENSES/README.md is missing');
  for (const e of all) {
    const lic = licenses.get(e.meta.license);
    if (!lic?.notice) continue;
    const p = join(dist, 'LICENSES', `${e.meta.license}.txt`);
    if (!existsSync(p)) licenseErrors.push(`LICENSES/${e.meta.license}.txt is missing`);
    else if (!readFileSync(p, 'utf8').includes(`Copyright (c) ${e.meta.author ?? ''}`))
      licenseErrors.push(`${e.id}: no copyright line in LICENSES/${e.meta.license}.txt`);
  }
  // Payload budget.
  const first = manifest.categories[0];
  const firstPayload = manifestText.length + (first ? statSync(join(dist, first.shard)).size : 0);
  if (firstPayload > FIRST_PAYLOAD_BUDGET)
    errors.push(
      `first payload is ${String(firstPayload)} bytes (budget ${String(FIRST_PAYLOAD_BUDGET)})`,
    );
  // Search index: every icon findable, and fast.
  let searchMs = 0;
  if (manifest.search) {
    const f = JSON.parse(read(manifest.search)) as SearchIndexFile;
    const ms = loadSearchIndex(f);
    if (ms.documentCount !== all.length)
      errors.push(
        `search index has ${String(ms.documentCount)} icons, library ${String(all.length)}`,
      );
    for (const e of all) if (!ms.has(e.id)) errors.push(`${e.id}: not in the search index`);
    const queries = [
      'cell',
      'mito',
      'dna helix',
      'mouse',
      'pipete',
      'antibody',
      'heart',
      'virus',
      'flask',
      'neuron',
    ];
    for (const q of queries) {
      const t0 = performance.now();
      ms.search(q, { ...f.searchOptions, boost: { ...f.searchOptions.boost } });
      searchMs = Math.max(searchMs, performance.now() - t0);
    }
    if (searchMs > SEARCH_BUDGET_MS) errors.push(`search took ${searchMs.toFixed(1)} ms`);
  } else errors.push('manifest has no search index');
  return { icons: all.length, licenseErrors, errors, firstPayload, searchMs };
}
