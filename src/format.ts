/**
 * The release format, as the app's `src/icons/manifest.ts` reads it
 * (format id `justfig-icons`, version 1). Fields marked "v1 extension" are
 * optional in the app's decoder, so a Phase 1 app still reads this release.
 *
 *   manifest.json             LibraryManifest
 *   shards/<category>.json    LibraryShard (compact JSON)
 *   svg/<hash>.svg            normalised SVG
 *   thumbs/<cat>-<n>.webp     sprite sheet, `columns` wide, `size` px cells (+ @2x)
 *   search-index.json         SearchIndexFile (MiniSearch, serialised)
 *   CREDITS.md, LICENSES/     licence notices, shown in the app
 */
import type { SlotDef } from './slots.ts';

export const LIBRARY_FORMAT = 'justfig-icons';
export const LIBRARY_FORMAT_VERSION = 1;
export const LIBRARY_ID = 'justfig-icons';

export interface IconMeta {
  readonly library: string;
  readonly libraryVersion: string;
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly author?: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly originalUrl: string;
  readonly shareAlike: boolean;
}

export interface IconEntry {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly category: string;
  readonly hash: string;
  readonly svg: string;
  readonly slots: readonly SlotDef[];
  readonly recolor: 'slots' | 'whole';
  readonly meta: IconMeta;
  /** v1 extension: sprite sheet (without extension) and cell index. */
  readonly thumb?: { readonly sheet: string; readonly i: number };
}

export interface LibraryShard {
  readonly category: string;
  readonly icons: readonly IconEntry[];
}

export interface SourceInfo {
  readonly id: string;
  readonly name: string;
  readonly homepage: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly attribution?: string;
  /**
   * v1 extensions: provenance. (The fetch time stays in raw/<id>/.justfig-fetch.json:
   * in the release it would make the tarball differ from one fetch to the next.)
   */
  readonly commit?: string;
  readonly termsChecked?: string;
}

export interface LibraryManifest {
  readonly format: typeof LIBRARY_FORMAT;
  readonly formatVersion: number;
  readonly library: string;
  readonly version: string;
  readonly categories: readonly {
    readonly id: string;
    readonly title: string;
    readonly count: number;
    readonly shard: string;
    /** v1 extension: icons in the share-alike set. */
    readonly shareAlike?: number;
  }[];
  readonly sources: readonly SourceInfo[];
  /** v1 extensions. */
  readonly thumbs?: {
    readonly size: number;
    readonly columns: number;
    readonly ext: string;
    readonly hiDpi: string;
  };
  readonly search?: string;
  readonly credits?: string;
  readonly licenses?: string;
}

export interface SearchIndexFile {
  readonly format: 'justfig-search';
  readonly formatVersion: 1;
  /** MiniSearch options the index was built with (the loader must match). */
  readonly fields: readonly string[];
  readonly storeFields: readonly string[];
  readonly searchOptions: {
    readonly prefix: boolean;
    readonly fuzzy: number;
    readonly boost: Readonly<Record<string, number>>;
    readonly combineWith: 'AND' | 'OR';
  };
  /** `MiniSearch#toJSON()`; load with `MiniSearch.loadJS`. */
  readonly index: unknown;
}

export const THUMB_SIZE = 96;
export const THUMB_COLUMNS = 10;
export const THUMB_PER_SHEET = 100;
