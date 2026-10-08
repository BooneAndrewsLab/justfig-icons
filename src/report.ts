/**
 * Licence report (plan §3): CREDITS.md (shown in the app), LICENSES/
 * (notice licences with their copyright lines, plus an index of every
 * licence used) and REPORT.md (per-source and per-licence counts, the
 * rejection log). All deterministic: sorted, no timestamps.
 */
import type { LicenseTable, SourceConfig } from './config.ts';
import type { IconEntry, LibraryManifest } from './format.ts';
import { NOTICE_TEXTS } from './licenseTexts.ts';

export interface Rejection {
  readonly source: string;
  readonly key: string;
  readonly reason: string;
}

const byText = (a: string, b: string): number => a.localeCompare(b, 'en');
const n = (v: number): string => v.toLocaleString('en-US');

function group<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    let list = out.get(k);
    if (!list) out.set(k, (list = []));
    list.push(x);
  }
  return new Map([...out.entries()].sort(([a], [b]) => byText(a, b)));
}

/** Markdown-safe text (the app renders CREDITS.md as text, never as HTML). */
const md = (s: string): string => s.replace(/([\\`*_[\]<>#|])/g, '\\$1');

export function creditsMarkdown(
  manifest: LibraryManifest,
  entries: readonly IconEntry[],
  sources: readonly SourceConfig[],
  licenses: LicenseTable,
): string {
  const lines: string[] = [];
  const bySource = group(entries, (e) => e.meta.source);
  lines.push(
    '# Icon credits',
    '',
    `Icon library ${manifest.version}: ${n(entries.length)} icons from ${String(bySource.size)} sources. ` +
      'Every icon keeps its own licence, author and original URL in the library metadata; ' +
      'this page lists them by source, licence and author.',
    '',
    'When you use an icon, the figure’s credit line names its source, author and licence. ' +
      'CC BY and CC BY-SA icons must be credited, and a recoloured one is credited as “modified”. ' +
      'CC BY-SA icons are hidden unless you turn on share-alike icons: a figure that adapts one ' +
      'must be shared under the same licence. MIT and BSD icons carry their licence text, ' +
      'reproduced in the LICENSES folder of the library.',
    '',
  );
  for (const [sourceName, list] of bySource) {
    const src = sources.find((s) => s.name === sourceName);
    lines.push(`## ${md(sourceName)}`, '');
    if (src) {
      lines.push(`Homepage: ${src.homepage}`, '');
      if (src.attribution) lines.push(`Required credit: ${md(src.attribution)}`, '');
    }
    for (const [lic, ls] of group(list, (e) => e.meta.license)) {
      const info = licenses.get(lic);
      lines.push(`### ${info?.name ?? lic} (${String(ls.length)})`, '');
      if (info) lines.push(`Licence: ${info.url}`, '');
      for (const [author, as] of group(ls, (e) => e.meta.author ?? sourceName)) {
        const titles = [...new Set(as.map((e) => e.title))].sort(byText).map(md);
        lines.push(`- **${md(author)}** (${String(as.length)}): ${titles.join(', ')}`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** LICENSES/<spdx>.txt for notice licences, and LICENSES/README.md. */
export function licenseFiles(
  entries: readonly IconEntry[],
  licenses: LicenseTable,
): Map<string, string> {
  const files = new Map<string, string>();
  const used = group(entries, (e) => e.meta.license);
  const index: string[] = [
    '# Licences of the icons in this library',
    '',
    'Each icon’s licence is recorded in its metadata (`meta.license`, an SPDX id).',
    'Notice licences, whose text must travel with the icons, are reproduced in full',
    'in this folder with the copyright line of every author they cover.',
    '',
    '| Licence | Icons | Text |',
    '| --- | ---: | --- |',
  ];
  for (const [id, list] of used) {
    const info = licenses.get(id);
    if (!info) throw new Error(`licence ${id} is not in licenses.yaml`);
    let where = info.url;
    if (info.notice) {
      const text = NOTICE_TEXTS[id];
      if (text === undefined) throw new Error(`no notice text for ${id} (src/licenseTexts.ts)`);
      const holders = group(list, (e) => e.meta.author ?? e.meta.source);
      const copyright = [...holders.entries()]
        .map(
          ([a, es]) =>
            `Copyright (c) ${a} (${es
              .map((e) => e.title)
              .sort(byText)
              .join(', ')}; via ${[...new Set(es.map((e) => e.meta.source))].join(', ')})`,
        )
        .join('\n');
      files.set(`${id}.txt`, text.replace('<COPYRIGHT>', copyright));
      where = `[${id}.txt](${id}.txt)`;
    }
    index.push(`| ${info.name} | ${String(list.length)} | ${where} |`);
  }
  files.set('README.md', `${index.join('\n')}\n`);
  return files;
}

export interface BuildStats {
  readonly entries: readonly IconEntry[];
  readonly rejections: readonly Rejection[];
  readonly warnings: ReadonlyMap<string, number>;
  readonly sizes: {
    readonly svgBytes: number;
    readonly firstPayload: number;
    readonly searchIndex: number;
    readonly thumbs: number;
  };
}

export function reportMarkdown(manifest: LibraryManifest, s: BuildStats): string {
  const L: string[] = [];
  L.push(
    `# Build report: ${manifest.library} ${manifest.version}`,
    '',
    'Generated by `npm run build`; deterministic for the pinned sources.',
    '',
    `- Icons: **${n(s.entries.length)}**, all with licence, author and source URL`,
    `- Share-alike (hidden by default in the app): ${n(s.entries.filter((e) => e.meta.shareAlike).length)}`,
    `- Recolour: ${n(s.entries.filter((e) => e.recolor === 'slots').length)} by slot, ${n(s.entries.filter((e) => e.recolor === 'whole').length)} as a whole (more than 4 colour families)`,
    `- Rejected or skipped: ${n(s.rejections.length)}`,
    `- SVG total: ${(s.sizes.svgBytes / 1e6).toFixed(1)} MB; thumbnails ${(s.sizes.thumbs / 1e6).toFixed(1)} MB; search index ${String(Math.round(s.sizes.searchIndex / 1000))} kB`,
    `- First payload (manifest + first shard): ${String(Math.round(s.sizes.firstPayload / 1000))} kB (budget 300 kB)`,
    '',
    '## Icons per source and licence',
    '',
    '| Source | Licence | Icons |',
    '| --- | --- | ---: |',
  );
  for (const [src, list] of group(s.entries, (e) => e.meta.source))
    for (const [lic, ls] of group(list, (e) => e.meta.license))
      L.push(`| ${src} | ${lic} | ${n(ls.length)} |`);
  L.push('', '## Icons per category', '', '| Category | Icons |', '| --- | ---: |');
  for (const c of manifest.categories) L.push(`| ${c.title} | ${n(c.count)} |`);
  L.push('', '## Normaliser notes (icons kept)', '', '| Note | Icons |', '| --- | ---: |');
  for (const [w, k] of [...s.warnings.entries()].sort(([a], [b]) => byText(a, b)))
    L.push(`| ${w} | ${n(k)} |`);
  L.push('', '## Rejections by reason', '', '| Reason | Icons |', '| --- | ---: |');
  const reason = (r: string): string => r.replace(/\s*\([^)]*\)$/, '').replace(/"[^"]*"/, '"…"');
  for (const [r, list] of group(s.rejections, (x) => `${x.source}: ${reason(x.reason)}`))
    L.push(`| ${r} | ${n(list.length)} |`);
  L.push('', '## Rejection log', '');
  for (const r of [...s.rejections].sort((a, b) =>
    byText(`${a.source}/${a.key}`, `${b.source}/${b.key}`),
  ))
    L.push(`- ${r.source} \`${r.key}\`: ${r.reason}`);
  return `${L.join('\n')}\n`;
}
