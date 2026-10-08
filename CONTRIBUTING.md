# Contributing

Thank you for helping the icon library grow. Everything here ends up in figures that
people publish, so licences come first.

## Contributing an icon (house style)

This walks you from nothing to an open pull request. The example adds an icon called
`test-flask`; use your own id wherever you see it. Only contribute work you drew yourself
or have the right to license (CC0-1.0 or CC-BY-4.0).

### 1. Set up

You need git and Node.js 24 (the version in [.nvmrc](.nvmrc); with nvm, `nvm install` then
`nvm use`). Check with `node --version`. Fork the repository on GitHub, then:

```sh
git clone https://github.com/<you>/justfig-icons.git
cd justfig-icons
git switch -c icon-test-flask
npm ci
```

`npm ci` installs the exact dependencies. You do **not** need `npm run fetch` to add or
check a house icon.

### 2. Draw it

Follow [house/STYLE.md](house/STYLE.md). In short:

- A 100 x 100 grid, 4 units of margin; outline 2.5 units with round caps and joins.
- Flat fills in at most 3 slots (`s1`, `s2`, `s3`) plus `outline`. No gradients, shadows,
  filters, text, images or `<use>`; paths and basic shapes only.
- **Every painted element carries `data-slot="<slot id>"`** (and `data-tone="-0.08"` etc. for
  shading). Its `fill`/`stroke` should be the slot's default colour. An element without a
  `data-slot`, or naming a slot you did not declare in `meta.yaml`, fails the build.
- Colours come from the house palette: `#e69f00` `#56b4e9` `#009e73` `#f0e442` `#0072b2`
  `#d55e00` `#cc79a7`, glass `#e4f1fb`, outline `#1f2933`.
- The id is kebab-case (`test-flask`), and the file is `house/svg/<id>.svg`.

Draw in Inkscape or Figma and add the `data-slot` attributes in a text editor (Inkscape:
Edit > XML Editor), or write the SVG by hand. A minimal valid icon, saved as
`house/svg/test-flask.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M40 8H60V38L88 86A6 6 0 0 1 83 94H17A6 6 0 0 1 12 86L40 38Z" fill="#e4f1fb" data-slot="s2"/>
  <path d="M24 66H76L88 86A6 6 0 0 1 83 94H17A6 6 0 0 1 12 86Z" fill="#56b4e9" data-slot="s1"/>
  <path d="M40 8H60V38L88 86A6 6 0 0 1 83 94H17A6 6 0 0 1 12 86L40 38Z" fill="none" stroke="#1f2933" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" data-slot="outline"/>
</svg>
```

### 3. Describe it

Append an entry to the **end** of `house/meta.yaml`. It sits under the `icons:` key at the top
of the file, so it is indented two spaces, like the entries above it. Add these lines (the
first two are context, do not repeat them):

```yaml
icons:
  # ...the existing entries...
  test-flask:
    title: 'Test flask'
    tags: ['flask', 'glass', 'conical']
    category: lab
    slots:
      - { id: s1, label: 'Liquid', default: '#56b4e9' }
      - { id: s2, label: 'Vessel', default: '#e4f1fb' }
      - { id: outline, label: 'Outline', default: '#1f2933' }
```

- `title`: what the user sees. `tags`: at least 3 search words. `category`: one of the ids in
  `taxonomy.yaml` (`lab`, `cells`, `organelles`, ...).
- `slots`: every `data-slot` you used, with a human label and the default colour (the colour
  in the SVG). Unused slots only produce a warning.
- `author` and `license` are inherited from the top of the file (`JustFig contributors`,
  `CC0-1.0`). To be credited by name, or to offer CC-BY-4.0, add them to your entry:
  `author: Your Name` and `license: CC-BY-4.0`. Nothing else is allowed.

### 4. Check it locally

```sh
npm run validate:house
npm run preview -- --ids test-flask
```

`validate:house` builds only the house icons into `.house-dist/` and validates them, the same
checks as `npm run validate`, in a second, offline. It also fails when an SVG has no
`meta.yaml` entry or the reverse. **Success** prints `built 40 icons in ...` and ends with a
line like

```
40 icons; 0 licence errors; 0 other errors; first payload 3 kB; slowest search 2.8 ms
```

and exit status 0 (the count is the number of house icons, yours included). Anything else
prints `licence:` or `error:` lines naming the icon and the problem; fix those and rerun.

`preview` renders your icon through the same normaliser as the build and writes
`preview/index.html`. **Success** is

```
1 icon(s) previewed, 0 problem(s). Open /…/preview/index.html
```

Open that file in a browser. You see the icon at its default colours and with three palettes
picked at random from the house palette (seeded from the id, so a rerun is identical), with
its title, tags, category, slots, licence and author. Problems are shown in red at the top of
the page and of the icon's card, and printed as `error:` lines. Check that the recoloured
versions still read well, and that each slot changes the part you meant it to. `preview/`
is git-ignored.

Without `--ids`, `npm run preview -- --base upstream/main` previews every house icon that is
new or changed versus that git ref (default `origin/main`); `--all` previews all of them.

### 5. Update REPORT.md

`REPORT.md` lists the library's icon counts, and CI fails if it is out of date, so a new icon
means a new `REPORT.md`. It is generated from the full library, so this one step needs the
network (it downloads the pinned third-party sources into the git-ignored `raw/`, a few
minutes the first time):

```sh
npm run fetch
npm run build
npm run validate
git diff REPORT.md
```

`npm run validate` must end with `0 licence errors; 0 other errors`. The diff of `REPORT.md`
should only show the icon totals and the House icons line going up by the icons you added.
If it shows more, the sources have moved on; start from an up-to-date `main`.

If you cannot run the full build, open the PR anyway and say so: the `CI` check will point at
`REPORT.md` and a maintainer can regenerate it.

### 6. Commit and open the pull request

```sh
npm run check
git add house/svg/test-flask.svg house/meta.yaml REPORT.md
git commit -m "Add test-flask house icon"
git push -u origin icon-test-flask
```

Commit only those files (`dist/`, `raw/`, `preview/` and `.house-dist/` are git-ignored).
`npm run check` (typecheck, lint, format, unit tests) should pass; it does not look at your
icon, so this is just a sanity check.

On GitHub, open a pull request from your branch to `main`. Tick every box of the
template, including the licence checklist: you drew the icon yourself (or have the right to
license it) and it is offered under CC0-1.0 or CC-BY-4.0.

### 7. What CI does

- **CI** runs `npm run check`, then a full fetch, build and `npm run validate`, and checks
  that `REPORT.md` is up to date.
- **House icon preview** runs when `house/` changes. It runs `npm run validate:house`, builds
  the preview for the icons your PR adds or changes, and uploads it as the
  `house-icon-preview` artifact. Open the workflow run from the PR's Checks tab: the
  Summary lists your icons, their slots and any problems, and the artifact is at the bottom
  of that page. Unzip it and open `index.html`. A pull request from a fork gets the same
  checks, with a read-only token and no secrets.

A reviewer looks at the preview and at the licence statement before merging.

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
