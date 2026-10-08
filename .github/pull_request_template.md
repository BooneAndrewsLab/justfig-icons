## What this changes

<!-- New icons, a new source, an override, a pipeline fix… -->

## Licence checklist

- [ ] Every new icon has a licence on the allow-list (`licenses.yaml`), an author and a source URL.
- [ ] A new source has a `sources/<id>/source.yaml` with the terms checked (date and URL), and its
      terms allow redistribution and modification.
- [ ] House icons: I drew them myself (or have the right to license them) under CC0 or CC BY 4.0.
- [ ] `npm run build && npm run validate` passes with zero licence errors, and `REPORT.md` is updated
      (or I could not run the full build and say so below).
- [ ] House icons: `npm run validate:house` passes and I looked at `npm run preview` (the CI
      "House icon preview" artifact has the same page).

## Notes for the reviewer

<!-- Anything unusual: could not run the full build, licence questions… -->
