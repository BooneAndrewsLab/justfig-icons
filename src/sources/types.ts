/** What a source collector hands the build: one record per candidate icon. */
import type { NormalizeOptions } from '../normalize.ts';

export interface RawIcon {
  readonly source: string;
  /** Library id: kebab-case, unique across the library. */
  readonly id: string;
  /** Path of the icon inside its source, for the `{path}` of `originalUrl`. */
  readonly key: string;
  readonly title: string;
  readonly tags: readonly string[];
  /** The source's own category, mapped through taxonomy.yaml. */
  readonly sourceCategory?: string;
  /** A taxonomy category given directly (house icons). */
  readonly category?: string;
  /** SPDX id. */
  readonly license: string;
  readonly author: string;
  /** Absolute path of the source SVG. */
  readonly file: string;
  readonly normalize: NormalizeOptions;
}

export interface Skipped {
  readonly source: string;
  readonly key: string;
  readonly reason: string;
}

export interface Collected {
  readonly icons: RawIcon[];
  readonly skipped: Skipped[];
}

/** Kebab-case slug; '' when nothing Latin is left. */
export function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "erythrocyte_5" → "Erythrocyte 5". */
export function titleFromName(name: string): string {
  const t = name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Lower-case words of a name, for tags. */
export function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w));
}
