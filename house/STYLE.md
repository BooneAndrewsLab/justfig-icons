# House style

House icons are drawn for JustFig and live in this repository (`house/svg/<id>.svg`, described
in `house/meta.yaml`). They are the reference for what a recolourable icon looks like.

## Original work

Every house icon is drawn from scratch for JustFig from basic shapes on the grid below. None is
traced, copied or adapted from third-party artwork (BioRender, Servier, Bioicons, textbooks,
papers, photographs), which is what lets them be released under CC0-1.0. A contributed icon
must be the same; see CONTRIBUTING.md.

## Grid and stroke

- A 100 × 100 grid with a 4-unit safe margin.
- Outline: 2.5 units, round caps and joins, always in slot `outline` (default `#1f2933`).

## Fills

- Flat fills in at most 3 slots (`s1`, `s2`, `s3`) plus `outline`.
- Shading uses tone offsets only (`data-tone`: −0.08, −0.16, +0.10 lightness), never extra hues.
- No gradients, shadows, filters or text.

## Palette

Slot defaults come from Okabe-Ito and their tints, so the defaults are colourblind-safe:
`#e69f00` orange, `#56b4e9` sky blue, `#009e73` green, `#f0e442` yellow, `#0072b2` blue,
`#d55e00` vermilion, `#cc79a7` pink, `#e4f1fb` glass, `#1f2933` outline.

## View

- Front or 3/4 view, the same within a category.
- Organelles are drawn in cross-section.

## Structure

- Each part is a `<g data-part="nucleus">`, so per-part recolouring stays meaningful.
- Every painted element has `data-slot` (and `data-tone` when shaded); its `fill`/`stroke` is the
  slot default (the pipeline bakes the tone into the colour).
- Paths and basic shapes only; transforms are fine (the pipeline flattens them).
- Draw in Inkscape or Figma; the pipeline normalises the output (crops to the drawing plus 2%,
  scales to 100 units, resolves styles).

## Metadata (`house/meta.yaml`)

- Kebab-case ids, matching the file name.
- `title`, at least 3 `tags`, a `category` from `taxonomy.yaml`, and the `slots`
  (`id`, `label`, `default`).
- `author` and `license` default to the file's top-level values; a house icon is CC0-1.0 or
  CC-BY-4.0.

## No trademark logos

Never draw or contribute software, company or product logos (PyTorch, Jupyter, NVIDIA, Excel, FHIR, DHIS2 and
the like). Their trademark policies forbid altering the mark, and recolouring is JustFig's
core feature. Generic artwork (a laptop, a sequencer, a GPU chip) is fine. The validator
rejects titles and ids that name the brands already excluded.

## Gate

A contribution must pass `npm run validate:house` (and, in CI, the full `npm run build &&
npm run validate`). `npm run preview` renders each new or changed icon at its default colours
and recoloured with 3 random palettes, and CI uploads that page for every pull request; see
[CONTRIBUTING.md](../CONTRIBUTING.md).
