# justfig-icons

This file is loaded into every session, so it holds only what changes how the code is worked
on: decisions, rules, pointers — not status. Counts and rejections live in `REPORT.md`, how
to contribute in `CONTRIBUTING.md`, the pipeline in `README.md`.

## What this is

The icon library of JustFig (`../JustFig`): fetches openly licensed scientific icons
(Bioicons, Health Icons) plus the house icons in `house/`, normalises them into recolourable
SVGs with per-icon licence metadata, and packs a versioned release that the app pins in its
`icons.lock.json`. The library is published inside a public website, so every rule below is
about what may legally ship.

## Rules

- **Node** is not on PATH: prefix with `PATH=/home/matej/Programs/miniconda3/envs/node/bin:$PATH`.
  `npm run check` gates every commit; `npm run build && npm run validate` must pass before a
  release (validate exits 1 on any licence or format error).
- **Licences:** an icon ships only if its SPDX id is allowed in `licenses.yaml`. Never add an
  NC or ND licence. CC BY-SA stays flagged `shareAlike` (hidden in the app unless opted in).
- **Sources** are pinned (git commit or archive + SHA-256) in `sources/<id>/source.yaml`, with
  `termsChecked` and `termsUrl`; re-read the terms when moving a pin.
- **Never silently alter artwork.** The normaliser rejects what it can't keep and logs it; any
  change to how an icon looks sets `meta.adapted`, which credits it "modified" (CC BY needs
  that). A new normaliser note that leaves the look unchanged goes in `COSMETIC_WARNINGS`.
- **No trademark logos, no brand names in titles** (`TRADEMARK_NAMES`, `BRAND_TITLES` in
  `src/validate.ts`): exclude logos with an override, give branded equipment a generic title;
  the brand may stay a tag.
- **House icons** are original work drawn from scratch (house/STYLE.md, Original work), CC0
  or CC BY 4.0. Never trace or adapt third-party artwork into one.
- **Fixes to source icons** are overrides in `overrides/<source>/*.yaml` (title, tags,
  category, author, exclude + reason), never edits to `raw/`.
- **Format** (`src/format.ts`) is the contract with JustFig's `src/icons/manifest.ts`: a
  new meta field is optional and must be decoded there before the app pins the release.

## Releasing

Bump `version` in `package.json`, build, validate, commit (`REPORT.md` included), tag
`v<version>` and push the tag; `.github/workflows/release.yml` attaches the tarball and its
`.sha256`. Then, in JustFig, update `icons.lock.json`, `BRAND.iconLibraryPath` and run
`npm run icons:fixture` (JustFig's CLAUDE.md).
