/**
 * Contribution preview: for house icons (new or changed versus a git base, or
 * named), run the build's own normaliser and slot pipeline, check the result
 * the way `npm run validate` does, and render the icon at its default colours
 * and recoloured with 3 palettes drawn at random (seeded from the icon id, so
 * a rerun is identical) from the Okabe-Ito based house palette.
 *
 * Needs no network and no fetched sources: house icons are local.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Resvg } from '@resvg/resvg-js';
import { parse } from 'yaml';

import { shiftLightness } from './color.ts';
import { type HouseIcon, decodeHouse, loadHouse, loadLicenses, loadTaxonomy } from './config.ts';
import type { IconEntry } from './format.ts';
import { contentHash } from './hash.ts';
import { normalizeSvg } from './normalize.ts';
import type { SlotDef } from './slots.ts';
import { checkSvg } from './validate.ts';

/** The chromatic Okabe-Ito colours of house/STYLE.md; palettes are drawn from these. */
export const HOUSE_PALETTE: readonly string[] = [
  '#e69f00',
  '#56b4e9',
  '#009e73',
  '#f0e442',
  '#0072b2',
  '#d55e00',
  '#cc79a7',
];
/** Outline slots keep the house outline colour in every palette. */
export const OUTLINE_SLOT = 'outline';
export const OUTLINE_COLOR = '#1f2933';
export const PALETTE_COUNT = 3;
export const PREVIEW_PX = 192;

// --- seeded randomness ---------------------------------------------------------------------

/** FNV-1a, 32 bit. */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded generator returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Palette = Readonly<Record<string, string>>;

/**
 * `PALETTE_COUNT` distinct palettes for these slots: every slot except the
 * outline gets its own colour from `HOUSE_PALETTE` (repeating only when the
 * icon has more slots than colours). Deterministic for an id.
 */
export function pickPalettes(id: string, slots: readonly SlotDef[]): Palette[] {
  const rand = mulberry32(seedFrom(id));
  const fill = slots.filter((s) => s.id !== OUTLINE_SLOT);
  const palettes: Palette[] = [];
  const seen = new Set<string>();
  for (let attempt = 0; palettes.length < PALETTE_COUNT && attempt < 200; attempt += 1) {
    const pool = [...HOUSE_PALETTE];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j] ?? '', pool[i] ?? ''];
    }
    const p: Record<string, string> = {};
    fill.forEach((s, i) => {
      p[s.id] = pool[i % pool.length] ?? OUTLINE_COLOR;
    });
    for (const s of slots) if (s.id === OUTLINE_SLOT) p[s.id] = OUTLINE_COLOR;
    const key = JSON.stringify(p);
    if (seen.has(key)) continue;
    seen.add(key);
    palettes.push(p);
  }
  return palettes;
}

/** The normalised SVG with each slot's colour replaced (tones applied); other slots keep theirs. */
export function recolorSvg(svg: string, colors: Palette): string {
  return svg.replace(/<path\b[^>]*>/g, (tag) => {
    const slot = /data-slot="([^"]*)"/.exec(tag)?.[1];
    const base = slot === undefined ? undefined : colors[slot];
    if (base === undefined) return tag;
    const tone = Number(/data-tone="([^"]*)"/.exec(tag)?.[1] ?? 0);
    const hex = shiftLightness(base, Number.isFinite(tone) ? tone : 0);
    return tag.replace(/\b(fill|stroke)="#[0-9a-fA-F]{6}"/g, `$1="${hex}"`);
  });
}

export function renderPng(svg: string, px = PREVIEW_PX): Buffer {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const wide = Number(m?.[1] ?? 100) >= Number(m?.[2] ?? 100);
  return new Resvg(svg, {
    fitTo: { mode: wide ? 'width' : 'height', value: px },
    background: '#ffffff',
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
}

// --- which icons --------------------------------------------------------------------------

const SVG_PATH = /^house\/svg\/([^/]+)\.svg$/;

/**
 * Ids to preview from the changed files under `house/` and the metadata at the
 * base and now: an icon counts when its SVG changed or its resolved metadata
 * entry (including the inherited author and licence) is new or different.
 */
export function changedHouseIds(
  files: readonly string[],
  base: readonly HouseIcon[] | undefined,
  current: readonly HouseIcon[],
): string[] {
  const ids = new Set<string>();
  for (const f of files) {
    const id = SVG_PATH.exec(f)?.[1];
    if (id !== undefined) ids.add(id);
  }
  const before = new Map((base ?? []).map((m) => [m.id, JSON.stringify(m)]));
  for (const m of current) if (before.get(m.id) !== JSON.stringify(m)) ids.add(m.id);
  return [...ids].sort();
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * House icons changed versus `baseRef`: the committed, staged and unstaged
 * changes since the merge base with HEAD, plus untracked files.
 */
export function changedSince(root: string, baseRef: string): string[] {
  let mergeBase: string;
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]);
    mergeBase = git(root, ['merge-base', baseRef, 'HEAD']).trim();
  } catch {
    throw new Error(
      `cannot find the base "${baseRef}". Fetch it (git fetch origin main) or pass --ids a,b / --all.`,
    );
  }
  const files = [
    ...git(root, ['diff', '--name-only', '--diff-filter=ACMR', mergeBase, '--', 'house']).split(
      '\n',
    ),
    ...git(root, ['ls-files', '--others', '--exclude-standard', '--', 'house']).split('\n'),
  ].filter((f) => f !== '');
  const taxonomy = loadTaxonomy(root);
  let base: HouseIcon[] | undefined;
  try {
    base = decodeHouse(parse(git(root, ['show', `${mergeBase}:house/meta.yaml`])), taxonomy);
  } catch {
    base = undefined;
  }
  return changedHouseIds(files, base, loadHouse(root, taxonomy));
}

// --- the preview --------------------------------------------------------------------------

export interface PreviewVariant {
  readonly label: string;
  readonly png: string;
  /** slot id → colour, for the swatches; empty for the default colours. */
  readonly colors: Palette;
}

export interface PreviewIcon {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly category: string;
  readonly license: string;
  readonly author: string;
  readonly slots: readonly SlotDef[];
  /** Problems that `npm run build` / `npm run validate` would fail on. */
  readonly problems: readonly string[];
  /** Worth a look, but not a failure. */
  readonly warnings: readonly string[];
  readonly variants: readonly PreviewVariant[];
}

export interface PreviewResult {
  readonly icons: PreviewIcon[];
  /** Selected ids that exist nowhere (no meta entry and no SVG). */
  readonly missing: string[];
}

/** PNGs are written to `<out>/png`, the normalised SVGs to `<out>/svg`. */
export function buildPreview(root: string, ids: readonly string[], out: string): PreviewResult {
  const taxonomy = loadTaxonomy(root);
  const licenses = loadLicenses(root);
  const meta = new Map(loadHouse(root, taxonomy).map((m) => [m.id, m]));
  const svgDir = join(root, 'house', 'svg');
  const files = new Set(
    existsSync(svgDir)
      ? readdirSync(svgDir)
          .filter((f) => f.endsWith('.svg'))
          .map((f) => f.slice(0, -4))
      : [],
  );
  // The build rejects a drawing identical to another icon's: find those.
  const hashes = new Map<string, string[]>();
  const normalised = new Map<string, ReturnType<typeof normalizeSvg>>();
  for (const [id, m] of meta) {
    if (!files.has(id)) continue;
    const r = normalizeSvg(readFileSync(join(svgDir, `${id}.svg`), 'utf8'), { slots: m.slots });
    normalised.set(id, r);
    if (r.ok) hashes.set(contentHash(r.svg), [...(hashes.get(contentHash(r.svg)) ?? []), id]);
  }

  mkdirSync(join(out, 'png'), { recursive: true });
  mkdirSync(join(out, 'svg'), { recursive: true });
  const icons: PreviewIcon[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const m = meta.get(id);
    const hasFile = files.has(id);
    if (!m && !hasFile) {
      missing.push(id);
      continue;
    }
    if (!m) {
      icons.push({
        id,
        title: id,
        tags: [],
        category: '',
        license: '',
        author: '',
        slots: [],
        problems: [`house/svg/${id}.svg has no entry in house/meta.yaml`],
        warnings: [],
        variants: [],
      });
      continue;
    }
    const problems: string[] = [];
    const warnings: string[] = [];
    const base = {
      id,
      title: m.title,
      tags: m.tags,
      category: m.category,
      license: m.license,
      author: m.author,
      slots: m.slots,
    };
    const r = normalised.get(id);
    if (!hasFile || !r) {
      icons.push({
        ...base,
        problems: [`house/meta.yaml lists ${id} but house/svg/${id}.svg does not exist`],
        warnings,
        variants: [],
      });
      continue;
    }
    if (!licenses.get(m.license)?.allow) problems.push(`licence ${m.license} is not allowed`);
    if (m.author.trim() === '') problems.push('no author');
    if (new Set(m.slots.map((s) => s.id)).size !== m.slots.length)
      problems.push('duplicate slot id');
    if (m.slots.length === 0) problems.push('no slots declared');
    if (!r.ok) {
      icons.push({
        ...base,
        problems: [...problems, `normaliser: ${r.reason}`],
        warnings,
        variants: [],
      });
      continue;
    }
    const entry: Pick<IconEntry, 'slots' | 'recolor'> = { slots: r.slots, recolor: r.recolor };
    problems.push(...checkSvg(r.svg, entry));
    const twins = (hashes.get(contentHash(r.svg)) ?? []).filter((x) => x !== id);
    if (twins.length > 0)
      problems.push(`same drawing as ${twins.join(', ')} (the build drops duplicates)`);
    warnings.push(...r.warnings);
    const used = new Set([...r.svg.matchAll(/data-slot="([^"]*)"/g)].map((x) => x[1]));
    for (const s of m.slots)
      if (!used.has(s.id)) warnings.push(`slot "${s.id}" is declared but no element uses it`);
    if (m.slots.length > 4) warnings.push('more than 4 slots; STYLE.md allows s1-s3 plus outline');

    writeFileSync(join(out, 'svg', `${id}.svg`), r.svg);
    const variants: PreviewVariant[] = [];
    const add = (label: string, file: string, colors: Palette, svg: string): void => {
      writeFileSync(join(out, 'png', file), renderPng(svg));
      variants.push({ label, png: `png/${file}`, colors });
    };
    add('Default colours', `${id}-default.png`, {}, r.svg);
    pickPalettes(id, m.slots).forEach((p, i) => {
      add(`Palette ${String(i + 1)}`, `${id}-p${String(i + 1)}.png`, p, recolorSvg(r.svg, p));
    });
    icons.push({ ...base, problems: [...new Set(problems)], warnings, variants });
  }
  return { icons, missing };
}

// --- output -------------------------------------------------------------------------------

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const mdCell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export interface PreviewContext {
  /** What was compared, e.g. "origin/main", "--ids a,b", "all icons". */
  readonly selection: string;
  /** Fatal problems that stop any preview (e.g. meta.yaml does not parse). */
  readonly fatal?: string;
  /** Where to download the preview, for the summary. */
  readonly where?: string;
}

export function problemCount(r: PreviewResult, ctx: PreviewContext): number {
  return (
    r.icons.reduce((n, i) => n + i.problems.length, 0) + r.missing.length + (ctx.fatal ? 1 : 0)
  );
}

export function previewHtml(r: PreviewResult, ctx: PreviewContext): string {
  const total = problemCount(r, ctx);
  const swatch = (hex: string): string =>
    `<i class="sw" style="background:${esc(hex)}" title="${esc(hex)}"></i>`;
  const card = (i: PreviewIcon): string => `
<article class="card${i.problems.length > 0 ? ' bad' : ''}" id="${esc(i.id)}">
  <h2>${esc(i.title)} <code>${esc(i.id)}</code></h2>
  ${
    i.problems.length > 0
      ? `<div class="problems"><strong>${String(i.problems.length)} problem${i.problems.length === 1 ? '' : 's'} (the build or validate will fail)</strong><ul>${i.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`
      : '<div class="ok">No problems found</div>'
  }
  ${i.warnings.length > 0 ? `<div class="warn"><strong>Warnings</strong><ul>${i.warnings.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
  <div class="row">${i.variants
    .map(
      (v) =>
        `<figure><img src="${esc(v.png)}" width="${String(PREVIEW_PX)}" height="${String(PREVIEW_PX)}" alt="${esc(`${i.title}, ${v.label}`)}"><figcaption>${esc(v.label)}<br>${Object.entries(
          v.colors,
        )
          .map(([slot, hex]) => `${swatch(hex)}<small>${esc(slot)}</small>`)
          .join(' ')}</figcaption></figure>`,
    )
    .join('')}</div>
  <dl>
    <dt>Category</dt><dd>${esc(i.category)}</dd>
    <dt>Tags</dt><dd>${i.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</dd>
    <dt>Licence</dt><dd>${esc(i.license)}</dd>
    <dt>Author</dt><dd>${esc(i.author)}</dd>
    <dt>Slots</dt><dd>${i.slots.map((s) => `${swatch(s.default)} <code>${esc(s.id)}</code> ${esc(s.label)} <small>${esc(s.default)}</small>`).join('<br>')}</dd>
  </dl>
</article>`;
  const all = r.icons.flatMap((i) => i.problems.map((p) => `${i.id}: ${p}`));
  if (ctx.fatal) all.unshift(ctx.fatal);
  for (const m of r.missing) all.push(`${m}: no such house icon (no meta.yaml entry, no SVG)`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>House icon preview</title>
<style>
:root{--bg:#f6f7f9;--fg:#1f2933;--card:#fff;--line:#d9dde3;--bad:#b42318;--badbg:#fdecea;--warn:#8a5a00;--warnbg:#fff6df;--ok:#0a7d4f}
@media (prefers-color-scheme:dark){:root{--bg:#14181d;--fg:#e6e9ed;--card:#1d232a;--line:#33404d;--bad:#ff8a80;--badbg:#3a1d1b;--warn:#f0c36a;--warnbg:#352a12;--ok:#5fd6a3}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
main{max-width:1000px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px;margin:16px 0}
.card.bad{border:2px solid var(--bad)}
h1{margin:.2em 0}h2{margin:0 0 8px;font-size:1.15em}
.problems{background:var(--badbg);color:var(--bad);border-radius:6px;padding:8px 12px;margin:8px 0}
.warn{background:var(--warnbg);color:var(--warn);border-radius:6px;padding:8px 12px;margin:8px 0}
.ok{color:var(--ok);margin:8px 0}
ul{margin:4px 0;padding-left:20px}
.row{display:flex;flex-wrap:wrap;gap:12px}
figure{margin:0;text-align:center}
img{object-fit:contain;border:1px solid var(--line);border-radius:6px;background:#fff;max-width:100%;height:auto}
figcaption{font-size:13px}
.sw{display:inline-block;width:12px;height:12px;border:1px solid var(--line);border-radius:3px;vertical-align:-1px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:12px 0 0}
dt{font-weight:600}dd{margin:0}
.tag{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:0 8px;font-size:13px}
code{font-size:.9em}
</style></head><body><main>
<h1>House icon preview</h1>
<p>${esc(ctx.selection)}: ${String(r.icons.length)} icon${r.icons.length === 1 ? '' : 's'}. Palettes are drawn at random from the Okabe-Ito house palette, seeded from the icon id, so a rerun gives the same picture.</p>
${
  total > 0
    ? `<div class="problems"><strong>${String(total)} problem${total === 1 ? '' : 's'} to fix before this can merge</strong><ul>${all.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`
    : r.icons.length > 0
      ? '<div class="ok"><strong>No problems found.</strong></div>'
      : ''
}
${r.icons.length === 0 && total === 0 ? '<p>No house icons are new or changed, so there is nothing to preview.</p>' : ''}
${r.icons.map(card).join('\n')}
</main></body></html>
`;
}

export function previewSummary(r: PreviewResult, ctx: PreviewContext): string {
  const total = problemCount(r, ctx);
  const lines = [
    `## House icon preview`,
    '',
    `${ctx.selection}: **${String(r.icons.length)}** icon(s).`,
    '',
  ];
  if (ctx.fatal) lines.push(`**Problem:** ${ctx.fatal}`, '');
  if (r.icons.length > 0) {
    lines.push(
      '| Icon | Category | Licence | Slots | Problems |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const i of r.icons)
      lines.push(
        `| \`${i.id}\` ${mdCell(i.title)} | ${mdCell(i.category)} | ${mdCell(i.license)} | ${mdCell(
          i.slots.map((s) => s.id).join(', '),
        )} | ${i.problems.length === 0 ? 'none' : `**${String(i.problems.length)}**`} |`,
      );
    lines.push('');
  } else if (!ctx.fatal) lines.push('No house icons are new or changed; nothing to preview.', '');
  for (const i of r.icons) {
    for (const p of i.problems) lines.push(`- :x: \`${i.id}\`: ${mdCell(p)}`);
    for (const w of i.warnings) lines.push(`- :warning: \`${i.id}\`: ${mdCell(w)}`);
  }
  for (const m of r.missing) lines.push(`- :x: \`${m}\`: no such house icon`);
  lines.push(
    '',
    total > 0 ? `**${String(total)} problem(s): fix them and push again.**` : 'No problems found.',
    '',
    ctx.where ?? 'Open `preview/index.html`.',
    '',
  );
  return lines.join('\n');
}

/** Writes `<out>/index.html` and `<out>/summary.md` (PNGs and SVGs are written by `buildPreview`). */
export function writePreview(out: string, r: PreviewResult, ctx: PreviewContext): void {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'index.html'), previewHtml(r, ctx));
  writeFileSync(join(out, 'summary.md'), previewSummary(r, ctx));
}

export function cleanDir(out: string): void {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
}
