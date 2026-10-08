/**
 * The search index (plan §3): a serialised MiniSearch index over title,
 * tags and synonyms (the category's own synonyms plus every taxonomy
 * synonym group that one of the icon's words belongs to). The app loads it
 * on the first search with `MiniSearch.loadJS(index, { fields, storeFields })`.
 */
import MiniSearch from 'minisearch';

import type { Taxonomy } from './config.ts';
import type { IconEntry, SearchIndexFile } from './format.ts';

const FIELDS = ['title', 'tags', 'synonyms'] as const;
const STORE = ['category'] as const;

export const SEARCH_OPTIONS: SearchIndexFile['searchOptions'] = {
  prefix: true,
  fuzzy: 0.2,
  boost: { title: 3, tags: 1.5 },
  combineWith: 'AND',
};

/** Synonyms an icon is also found by. */
export function synonymsFor(e: IconEntry, taxonomy: Taxonomy): string[] {
  const out = new Set<string>();
  const cat = taxonomy.categories.find((c) => c.id === e.category);
  if (cat) {
    out.add(cat.title.toLowerCase());
    for (const s of cat.synonyms) out.add(s);
  }
  const text = ` ${[e.title, ...e.tags]
    .join(' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  for (const group of taxonomy.synonyms)
    if (group.some((w) => text.includes(` ${w} `))) for (const w of group) out.add(w);
  return [...out];
}

export function buildSearchIndex(
  entries: readonly IconEntry[],
  taxonomy: Taxonomy,
): SearchIndexFile {
  const ms = new MiniSearch<{
    id: string;
    title: string;
    tags: string;
    synonyms: string;
    category: string;
  }>({
    fields: [...FIELDS],
    storeFields: [...STORE],
  });
  ms.addAll(
    entries.map((e) => ({
      id: e.id,
      title: e.title,
      tags: e.tags.join(' '),
      synonyms: synonymsFor(e, taxonomy).join(' '),
      category: e.category,
    })),
  );
  return {
    format: 'justfig-search',
    formatVersion: 1,
    fields: [...FIELDS],
    storeFields: [...STORE],
    searchOptions: SEARCH_OPTIONS,
    index: ms.toJSON(),
  };
}

/** Loads an index file back (validation and tests use the same path as the app). */
export function loadSearchIndex(f: SearchIndexFile): MiniSearch {
  return MiniSearch.loadJS(f.index as Parameters<typeof MiniSearch.loadJS>[0], {
    fields: [...f.fields],
    storeFields: [...f.storeFields],
  });
}
