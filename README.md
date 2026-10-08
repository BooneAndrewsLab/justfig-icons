# justfig-icons

The icon library of [JustFig](https://github.com/BooneAndrewsLab/JustFig), the free,
browser-only scientific figure editor. This repository fetches openly licensed scientific
icons, normalises them into small recolourable SVGs with complete licence metadata, and
builds a versioned release that the app downloads at deploy time.

The pipeline code is MIT. Every icon keeps its own licence (CC0, CC BY, CC BY-SA, MIT or
BSD), recorded per icon and summarised in the release's `CREDITS.md` and `LICENSES/`.

## Commands

Node 24 runs the TypeScript scripts directly (no build step).

```sh
npm ci
npm run fetch      # git sources at their pinned commits → raw/ (gitignored)
npm run build      # raw/ + house/ → dist/, and REPORT.md
npm run validate   # checks dist/ the way the app reads it; exits 1 on any error
npm run validate:house   # house icons only: build + validate, offline, no fetch needed
npm run preview -- --ids a,b   # PNG/HTML preview of house icons (--base <ref> or --all too)
npm run pack       # dist/ → release/justfig-icons-<version>.tar.gz (+ .sha256)
npm run check      # typecheck, lint, format, unit tests
```

`npm run build -- --only house,healthicons --limit 20 --out /tmp/lib` makes a quick partial
library (no REPORT.md).

## Layout

```
sources/<id>/source.yaml   one per source: licence, fetch method and pinned commit, attribution,
                           terms-checked date (schema: src/config.ts, SourceConfig)
licenses.yaml              licence allow-list: SPDX id → allow, shareAlike, attribution,
                           modifiedNote, notice
taxonomy.yaml              the app's categories (in order), source category → category,
                           search synonyms
overrides/<id>/*.yaml      per-icon fixes: title, tags, category, author, or exclude + reason
house/                     house-style icons: svg/<id>.svg + meta.yaml, drawn to house/STYLE.md
src/                       the pipeline (normalize, slots, path, build, validate, report, …)
scripts/                   command-line entry points
docs/                      how-tos (e.g. the Servier PPTX import)
```

## Sources (v1)

| Source       | Licence                                          | Status                                       |
| ------------ | ------------------------------------------------ | -------------------------------------------- |
| House icons  | CC0                                              | in this repository                           |
| Health Icons | CC0                                              | ingested                                     |
| Bioicons     | per icon: CC0, CC BY 3.0/4.0, CC BY-SA, MIT, BSD | ingested; CC BY-SA icons form the opt-in set |
| Servier      | CC BY 4.0                                        | deferred: no SVGs, terms forbid scraping     |
| SciDraw      | CC BY 4.0 / CC0                                  | cleared, out of v1 by decision               |
| NIH BioArt   | mostly public domain                             | cleared, out of v1 by decision               |

`REPORT.md` has the exact counts per source and licence and the rejection log.

## What the build does

1. **Collect** each enabled source (`src/sources/*.ts`); a source category must map to a
   taxonomy category or the build fails.
2. **Licence gate**: an icon whose SPDX id is not allowed in `licenses.yaml` is rejected.
3. **Normalise** (`src/normalize.ts`, in a worker pool): styles become attributes, inherited
   paint is pushed down, transforms are flattened into path data, shapes become paths, the
   viewBox is cropped to the geometry plus 2% and scaled so the longer side is 100.
   Rasters, text, filters, masks, markers, patterns and clip paths that really clip are
   rejected and logged, never silently altered. Gradients become their average colour.
4. **Slots** (`src/slots.ts`): colours are clustered into at most 4 hue families plus a
   neutral `outline` family; each element gets `data-slot` and a lightness `data-tone`.
   Icons that need more families are recoloured as a whole (`recolor: "whole"`).
5. **De-duplicate** by content hash, then write `dist/`: `manifest.json`,
   `shards/<category>.json`, `svg/<hash>.svg`, sprite sheets `thumbs/<category>-<n>.webp`
   (96 px cells, plus `@2x`), `search-index.json` (MiniSearch), `CREDITS.md`, `LICENSES/`.

The format is the one the app's `src/icons/manifest.ts` reads (format `justfig-icons`,
version 1); `src/format.ts` documents it.

## Releases

`.github/workflows/release.yml` builds, validates and packs on a `v*` tag and attaches the
tarball and its SHA-256 to a GitHub Release. The app pins one release (URL + SHA-256 in its
`icons.lock.json`) and unpacks it into `public/lib/<version>/` at deploy time.

**Not yet published.** This repository exists only locally for now; the release URL in the
workflow and in the app's lock file is a placeholder until the GitHub repository is created.
Until then the app builds its library from a sibling checkout (`../justfig-icons/dist`).
