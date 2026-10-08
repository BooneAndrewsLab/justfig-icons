# Contributing

Thank you for helping the icon library grow. Everything here ends up in figures that
people publish, so licences come first.

## Contributing an icon (house style)

1. Draw it to [house/STYLE.md](house/STYLE.md).
2. Save it as `house/svg/<kebab-id>.svg`, with `data-slot` (and `data-tone` for shading) on
   every painted element.
3. Add its entry to `house/meta.yaml`: title, at least 3 tags, category, slots; author and
   licence if not the defaults (CC0-1.0 or CC-BY-4.0 only).
4. `npm run build && npm run validate` must pass. Commit the updated `REPORT.md`.

Only contribute work you drew yourself or have the right to license.

## Adding a source

1. Check the terms: the icons must allow redistribution **and** modification (recolouring is a
   modification), commercially. NC and ND licences are never accepted. If the site's terms
   forbid automated downloading, the source can only be imported from files a person
   downloaded by hand (see `docs/servier-pptx-import.md`).
2. Add `sources/<id>/source.yaml` (the schema is `SourceConfig` in `src/config.ts`): name,
   homepage, licence (an SPDX id, or `per-icon`), author, required attribution wording,
   fetch method with a **pinned** commit (git) or archive + SHA-256, the `originalUrl`
   template, `termsChecked` (date) and `termsUrl`.
3. Map its licence ids to SPDX ids that `licenses.yaml` allows.
4. Map every source category to a taxonomy category in `taxonomy.yaml`.
5. Write a collector in `src/sources/<id>.ts` and register it in `src/build.ts`.
6. `npm run fetch && npm run build && npm run validate`; review `REPORT.md` (rejections, counts).

## Fixing one icon

Add an entry to `overrides/<source>/<anything>.yaml`:

```yaml
overrides:
  - id: bi-erythrocyte-5
    title: Red blood cell
    tags: [erythrocyte, rbc, blood]
  - id: bi-some-logo
    exclude: true
    reason: trademark logo
```

## Checks

`npm run check` runs the typecheck, lint, format check and unit tests.
