# Importing Servier Medical Art from PPTX (deferred)

**Status: not built.** Servier Medical Art (https://smart.servier.com) licenses its drawings
under CC BY 4.0, but it publishes them only as PNG and PowerPoint slide sets, and its terms
forbid automated downloading. The pipeline therefore never fetches from the site.
`sources/servier/source.yaml` is in place with `enabled: false`.

About 1,400 older Servier drawings already reach the library through Bioicons (vectorised
there, CC BY 3.0). This import is for the newer CC BY 4.0 sets.

## What a person does

1. Download the wanted slide sets (`.pptx`) by hand from smart.servier.com, accepting the
   terms in the browser.
2. Put them in `raw/servier/pptx/` (gitignored; never commit them).
3. Record in `sources/servier/source.yaml` the date and the list of files, and set
   `enabled: true` once the converter exists.

## What the converter has to do (`src/sources/servier.ts`, to write)

A `.pptx` is a zip of DrawingML XML. Servier's sets place each drawing as a group of vector
shapes (`p:grpSp` / `p:sp` with `a:custGeom` paths), sometimes with embedded PNGs.

1. Unzip with a zip reader (no external tools); read `ppt/slides/slide<N>.xml`.
2. For each top-level group (one drawing), convert:
   - `a:custGeom/a:pathLst/a:path` commands (`moveTo`, `lnTo`, `cubicBezTo`, `quadBezTo`,
     `arcTo`, `close`) to SVG path data, scaled from the path's `w`/`h` to the shape's
     `a:xfrm` (`a:off`, `a:ext`, `rot`, `flipH`, `flipV`), composed through the parent
     groups' `a:chOff`/`a:chExt` transforms;
   - preset shapes (`a:prstGeom`: ellipse, rect, roundRect …) to the equivalent SVG shapes;
   - `a:solidFill` (`a:srgbClr`, `a:schemeClr` resolved through the theme, with `lumMod`/
     `lumOff`/`alpha`) to fill and fill-opacity; `a:ln` to stroke and stroke-width (EMU →
     points: 12,700 EMU per point);
   - `a:gradFill` to its stops (the normaliser averages them).
3. Reject a drawing with a `p:pic` (raster) or text body with visible text; log it.
4. Write one SVG per drawing and hand it to `normalizeSvg` like any other source. Title and
   tags come from the slide's title placeholder and the set's name.
5. Each icon's metadata: author `Servier`, licence `CC-BY-4.0`, `originalUrl` the set's page
   on smart.servier.com, and the source's required wording (`attribution` in source.yaml)
   in the credit line.

Test it against a couple of hand-downloaded sets before enabling the source, and compare
the renders with Servier's PNGs.
