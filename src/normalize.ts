/**
 * The normaliser (plan §3 "Normalization rules"): any source SVG → the
 * library's normalised SVG, or a rejection with a reason for the report.
 *
 * Output: `<svg viewBox="0 0 W H">` (longer side 100, cropped to the
 * geometry plus 2% padding) holding only `<g>` (opacity, data-part) and
 * `<path>` elements with presentation attributes, no transforms, and a
 * `data-slot` (plus `data-tone`) on every painted element.
 *
 * - Transforms (and `<use>` offsets) are flattened into the path data;
 *   basic shapes become paths; arcs become cubics (path.ts).
 * - `<style>` rules and `style=` are resolved into attributes and
 *   inherited paint is pushed down to each painted element.
 * - Gradients become their average colour (logged).
 * - Rejected: rasters (`<image>`), `foreignObject`, text, filters, masks,
 *   markers, patterns, and clip paths that actually clip something (a
 *   rectangular clip that contains its content, as Illustrator and PDF
 *   exports add, is dropped).
 * - An element whose fill and stroke land in different slots (or tones) is
 *   split in two, so every element belongs to one slot.
 */
import { shiftLightness } from './color.ts';
import {
  type Box,
  type Matrix,
  PathError,
  type Seg,
  IDENTITY,
  emptyBox,
  lineScale,
  multiply,
  parseTransform,
  pathBox,
  polygonOf,
  rectOf,
  serializePath,
  shapeToPath,
  transformPath,
} from './path.ts';
import {
  type CssRule,
  gradientColors,
  length,
  matches,
  normalizeColor,
  numberList,
  parseCss,
  parseDecls,
} from './sanitize.ts';
import { type SlotDef, planSlots } from './slots.ts';
import { type SvgNode, walkNodes } from './svgNode.ts';
import { parseXml } from './xml.ts';

export interface NormalizeOptions {
  /** What `currentColor` stands for (single-colour icon sets). */
  readonly currentColor?: string;
  /**
   * House icons arrive already slotted: keep their `data-slot`/`data-tone`
   * and these slot definitions instead of clustering.
   */
  readonly slots?: readonly SlotDef[];
  readonly maxBytes?: number;
  readonly maxNodes?: number;
}

export type NormalizeResult =
  | {
      readonly ok: true;
      readonly svg: string;
      readonly width: number;
      readonly height: number;
      readonly slots: readonly SlotDef[];
      readonly recolor: 'slots' | 'whole';
      readonly nodes: number;
      /** Largest difference (OKLab ΔE) between an original colour and its slot rendering. */
      readonly colorError: number;
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

export const MAX_BYTES = 200_000;
export const MAX_NODES = 2_000;
/** Above this an icon is written at 1 decimal (0.1% of its size) instead of 2. */
export const COMPACT_BYTES = 40_000;
const PAD = 0.02;

class Reject extends Error {
  override readonly name = 'Reject';
}

const INHERITED = [
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'visibility',
  'data-slot',
  'data-tone',
] as const;
type Inherited = Partial<Record<(typeof INHERITED)[number], string>>;

const PROPS = new Set<string>([
  ...INHERITED,
  'opacity',
  'display',
  'clip-path',
  'mask',
  'filter',
  'marker-start',
  'marker-mid',
  'marker-end',
  'marker',
]);

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const CONTAINERS = new Set(['g', 'a', 'svg']);
const DEFINITIONS = new Set([
  'title',
  'desc',
  'metadata',
  'defs',
  'style',
  'linearGradient',
  'radialGradient',
  'symbol',
  'clipPath',
  'mask',
  'marker',
  'pattern',
  'filter',
  'font',
  'font-face',
  'sodipodi:namedview',
]);
const REJECT_TAGS: Readonly<Record<string, string>> = {
  image: 'embedded raster image',
  foreignObject: 'foreignObject',
  video: 'embedded media',
  audio: 'embedded media',
  iframe: 'embedded document',
  canvas: 'canvas',
  textPath: 'text',
};

/** CSS named colours beyond the sanitiser's short list. */
const MORE_NAMED: Readonly<Record<string, string>> = {
  silver: '#c0c0c0',
  maroon: '#800000',
  navy: '#000080',
  teal: '#008080',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  cyan: '#00ffff',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gold: '#ffd700',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  dimgray: '#696969',
  dimgrey: '#696969',
  gainsboro: '#dcdcdc',
  whitesmoke: '#f5f5f5',
  darkred: '#8b0000',
  darkgreen: '#006400',
  darkblue: '#00008b',
  lightblue: '#add8e6',
  skyblue: '#87ceeb',
  steelblue: '#4682b4',
  royalblue: '#4169e1',
  crimson: '#dc143c',
  salmon: '#fa8072',
  tomato: '#ff6347',
  coral: '#ff7f50',
  khaki: '#f0e68c',
  violet: '#ee82ee',
  indigo: '#4b0082',
  tan: '#d2b48c',
  beige: '#f5f5dc',
  ivory: '#fffff0',
  lightgreen: '#90ee90',
  forestgreen: '#228b22',
  darkorange: '#ff8c00',
  orangered: '#ff4500',
  lightyellow: '#ffffe0',
  lavender: '#e6e6fa',
  turquoise: '#40e0d0',
  slategray: '#708090',
  slategrey: '#708090',
  lightpink: '#ffb6c1',
  hotpink: '#ff69b4',
  peru: '#cd853f',
  chocolate: '#d2691e',
  sienna: '#a0522d',
  wheat: '#f5deb3',
  linen: '#faf0e6',
  plum: '#dda0dd',
  orchid: '#da70d6',
  darkviolet: '#9400d3',
  mediumpurple: '#9370db',
  firebrick: '#b22222',
  seagreen: '#2e8b57',
  limegreen: '#32cd32',
  yellowgreen: '#9acd32',
  darkcyan: '#008b8b',
  cadetblue: '#5f9ea0',
  dodgerblue: '#1e90ff',
  deepskyblue: '#00bfff',
  midnightblue: '#191970',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
};

interface Leaf {
  readonly kind: 'leaf';
  readonly segs: Seg[];
  readonly fill: string;
  readonly stroke: string;
  readonly attrs: Readonly<Record<string, string>>;
  /** Stroke width in output units (scaled with the geometry). */
  readonly strokeWidth: number;
  readonly dash: readonly number[] | null;
  readonly dashOffset: number;
  readonly opacity: number;
  readonly slot?: string;
  readonly tone?: number;
}
interface Group {
  readonly kind: 'group';
  readonly opacity: number;
  readonly part?: string;
  readonly children: Item[];
}
type Item = Leaf | Group;

const localName = (tag: string): string => (tag.startsWith('svg:') ? tag.slice(4) : tag);

function num(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px)?\s*$/i.exec(v);
  return m ? Number(m[1]) : fallback;
}

function itemBox(items: readonly Item[], into: Box = emptyBox()): Box {
  for (const it of items) {
    if (it.kind === 'group') {
      itemBox(it.children, into);
      continue;
    }
    const b = pathBox(it.segs);
    const pad = it.stroke !== 'none' ? it.strokeWidth / 2 : 0;
    if (b.x0 - pad < into.x0) into.x0 = b.x0 - pad;
    if (b.y0 - pad < into.y0) into.y0 = b.y0 - pad;
    if (b.x1 + pad > into.x1) into.x1 = b.x1 + pad;
    if (b.y1 + pad > into.y1) into.y1 = b.y1 + pad;
  }
  return into;
}

function mapItems(items: readonly Item[], m: Matrix): Item[] {
  const k = lineScale(m);
  return items.map((it): Item => {
    if (it.kind === 'group') return { ...it, children: mapItems(it.children, m) };
    return {
      ...it,
      segs: transformPath(it.segs, m),
      strokeWidth: it.strokeWidth * k,
      dash: it.dash ? it.dash.map((d) => d * k) : null,
      dashOffset: it.dashOffset * k,
    };
  });
}

function leaves(items: readonly Item[], out: Leaf[] = []): Leaf[] {
  for (const it of items) {
    if (it.kind === 'group') leaves(it.children, out);
    else out.push(it);
  }
  return out;
}

const fmt = (v: number, dp = 3): string => {
  const k = 10 ** dp;
  const r = Math.round(v * k) / k;
  return Object.is(r, -0) ? '0' : String(r);
};

export function normalizeSvg(text: string, opts: NormalizeOptions = {}): NormalizeResult {
  try {
    return run(text, opts);
  } catch (e: unknown) {
    if (e instanceof Reject) return { ok: false, reason: e.message };
    if (e instanceof PathError) return { ok: false, reason: `bad geometry: ${e.message}` };
    return { ok: false, reason: `unreadable SVG: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Sources larger than this are not even parsed (traced photos, data dumps). */
export const MAX_SOURCE_BYTES = 3_000_000;

function run(text: string, opts: NormalizeOptions): NormalizeResult {
  if (text.length > MAX_SOURCE_BYTES)
    throw new Reject(`source too large (${String(Math.round(text.length / 1e6))} MB)`);
  const root = parseXml(text);
  if (localName(root.tag) !== 'svg') throw new Reject('not an SVG');
  const warnings = new Set<string>();
  const ids = new Map<string, SvgNode>();
  const css: CssRule[] = [];
  for (const n of walkNodes(root)) {
    const id = n.attrs['id'];
    if (typeof id === 'string') ids.set(id, n);
    if (localName(n.tag) === 'style')
      css.push(...parseCss(n.children.filter((c) => typeof c === 'string').join('')));
  }
  const gradients = gradientColors(root, ids);
  const currentColor = opts.currentColor ?? '#000000';

  /** Own declared properties (attribute < CSS rule < style=). */
  const own = (n: SvgNode): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.attrs))
      if (PROPS.has(k) && v !== undefined) out[k] = String(v).trim();
    for (const r of css) if (matches(r.sel, n)) Object.assign(out, r.decls);
    Object.assign(out, parseDecls(String(n.attrs['style'] ?? '')));
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== 'inherit'));
  };

  const paint = (raw: string | undefined, fallback: string): string => {
    if (raw === undefined) return fallback;
    const s = raw.trim();
    const url = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)\s*(.*)$/.exec(s);
    if (url) {
      const id = url[1] ?? '';
      const g = gradients.get(id);
      if (g) {
        warnings.add('gradient replaced by its average colour');
        return g;
      }
      const target = ids.get(id);
      if (target && localName(target.tag) === 'pattern') throw new Reject('pattern fill');
      const alt = url[2]?.trim();
      return alt ? paint(alt, 'none') : 'none';
    }
    if (s.toLowerCase() === 'currentcolor') return currentColor;
    const named = MORE_NAMED[s.toLowerCase()];
    if (named) return named;
    const c = normalizeColor(s, gradients);
    if (c === null) throw new Reject(`unsupported colour "${s}"`);
    return c;
  };

  const vb = numberList(String(root.attrs['viewBox'] ?? ''));
  const w = length(root.attrs['width']);
  const h = length(root.attrs['height']);
  // The viewBox origin and scale do not matter: everything is re-cropped below.
  if (!(vb.length === 4 && (vb[2] ?? 0) > 0 && (vb[3] ?? 0) > 0) && !(w && h))
    throw new Reject('no viewBox, width or height');

  const walk = (
    n: SvgNode,
    ctm: Matrix,
    inh: Inherited,
    depth: number,
    useDepth: number,
  ): Item[] => {
    if (depth > 80) throw new Reject('nesting too deep');
    const tag = localName(n.tag);
    if (tag.includes(':') || DEFINITIONS.has(tag)) return [];
    if (tag === 'script') {
      warnings.add('script removed');
      return [];
    }
    const rejectWhy = REJECT_TAGS[tag];
    if (rejectWhy) throw new Reject(rejectWhy);
    if (tag === 'text' || tag === 'tspan') {
      const hasText = [...walkNodes(n)].some((x) =>
        x.children.some((c) => typeof c === 'string' && c.trim() !== ''),
      );
      if (hasText) throw new Reject('text (would need outlining)');
      return [];
    }
    const p = own(n);
    if (p['display'] === 'none') return [];
    const nextInh: Inherited = { ...inh };
    for (const k of INHERITED) {
      const v = p[k];
      if (v !== undefined) nextInh[k] = v;
    }
    if (nextInh.visibility === 'hidden' || nextInh.visibility === 'collapse') return [];
    for (const k of ['filter', 'mask'] as const) {
      const v = p[k];
      if (v !== undefined && v !== 'none') throw new Reject(k === 'filter' ? 'filter' : 'mask');
    }
    for (const k of ['marker', 'marker-start', 'marker-mid', 'marker-end'] as const) {
      const v = p[k];
      if (v !== undefined && v !== 'none') throw new Reject('markers');
    }
    let m = ctm;
    const tr = n.attrs['transform'];
    if (typeof tr === 'string' && tag !== 'svg') m = multiply(m, parseTransform(tr));
    const opacity = Math.min(1, Math.max(0, num(p['opacity'], 1)));
    if (opacity === 0) return [];

    let items: Item[] = [];
    if (tag === 'use') {
      const href = String(n.attrs['href'] ?? n.attrs['xlink:href'] ?? '');
      const target = href.startsWith('#') ? ids.get(href.slice(1)) : undefined;
      if (!target || useDepth > 8) {
        warnings.add('reference to something outside the file removed');
        return [];
      }
      const x = num(String(n.attrs['x'] ?? '0'), 0);
      const y = num(String(n.attrs['y'] ?? '0'), 0);
      const um = multiply(m, [1, 0, 0, 1, x, y]);
      const t = localName(target.tag) === 'symbol' ? { ...target, tag: 'g' } : target;
      items = walk(t, um, nextInh, depth + 1, useDepth + 1);
    } else if (tag === 'switch') {
      const pick = n.children.find(
        (c): c is SvgNode =>
          typeof c !== 'string' &&
          localName(c.tag) !== 'foreignObject' &&
          c.attrs['requiredExtensions'] === undefined &&
          c.attrs['requiredFeatures'] === undefined &&
          c.attrs['systemLanguage'] === undefined,
      );
      items = pick ? walk(pick, m, nextInh, depth + 1, useDepth) : [];
    } else if (CONTAINERS.has(tag)) {
      let cm = m;
      if (tag === 'svg' && depth > 0) {
        const x = num(String(n.attrs['x'] ?? '0'), 0);
        const y = num(String(n.attrs['y'] ?? '0'), 0);
        cm = multiply(m, [1, 0, 0, 1, x, y]);
        if (n.attrs['viewBox'] !== undefined) warnings.add('nested viewport flattened');
      }
      for (const c of n.children)
        if (typeof c !== 'string') items.push(...walk(c, cm, nextInh, depth + 1, useDepth));
    } else if (SHAPES.has(tag)) {
      const geo = shapeToPath(tag, n.attrs);
      if (!geo) return [];
      const leaf = makeLeaf(geo, m, nextInh, tag === 'line' || tag === 'polyline');
      if (leaf) items = [leaf];
    } else {
      warnings.add(`unknown <${tag}> removed`);
      return [];
    }

    const clip = p['clip-path'];
    if (clip !== undefined && clip !== 'none' && items.length > 0)
      items = applyClip(clip, m, items);

    const part = n.attrs['data-part'];
    if (items.length === 0) return [];
    if (opacity < 1 || typeof part === 'string') {
      // A single leaf takes the opacity itself.
      const only = items.length === 1 ? items[0] : undefined;
      if (only?.kind === 'leaf' && typeof part !== 'string')
        return [{ ...only, opacity: only.opacity * opacity }];
      return [
        {
          kind: 'group',
          opacity,
          ...(typeof part === 'string' ? { part } : {}),
          children: items,
        },
      ];
    }
    return items;
  };

  const makeLeaf = (geo: Seg[], m: Matrix, inh: Inherited, open: boolean): Leaf | null => {
    let fill = paint(inh.fill, '#000000');
    let stroke = paint(inh.stroke, 'none');
    const fo = Math.min(1, Math.max(0, num(inh['fill-opacity'], 1)));
    const so = Math.min(1, Math.max(0, num(inh['stroke-opacity'], 1)));
    const k = lineScale(m);
    const sw = num(inh['stroke-width'], 1) * k;
    if (fo === 0 || (open && geo.length <= 2)) fill = 'none';
    if (so === 0 || sw <= 0) stroke = 'none';
    if (fill === 'none' && stroke === 'none') return null;
    const attrs: Record<string, string> = {};
    if (fill !== 'none') {
      if (inh['fill-rule'] === 'evenodd') attrs['fill-rule'] = 'evenodd';
      if (fo < 1) attrs['fill-opacity'] = fmt(fo);
    }
    let dash: number[] | null = null;
    let dashOffset = 0;
    if (stroke !== 'none') {
      if (so < 1) attrs['stroke-opacity'] = fmt(so);
      const cap = inh['stroke-linecap'];
      if (cap === 'round' || cap === 'square') attrs['stroke-linecap'] = cap;
      const join = inh['stroke-linejoin'];
      if (join === 'round' || join === 'bevel') attrs['stroke-linejoin'] = join;
      const ml = num(inh['stroke-miterlimit'], 4);
      if (ml !== 4 && join !== 'round' && join !== 'bevel')
        attrs['stroke-miterlimit'] = fmt(Math.max(1, ml));
      const da = inh['stroke-dasharray'];
      if (da !== undefined && da !== 'none') {
        const v = numberList(da);
        if (v.length > 0 && v.some((x) => x > 0) && v.every((x) => x >= 0)) {
          dash = (v.length % 2 === 1 ? [...v, ...v] : v).map((x) => x * k);
          dashOffset = num(inh['stroke-dashoffset'], 0) * k;
        }
      }
      const a = Math.abs(m[0] * m[0] + m[1] * m[1] - (m[2] * m[2] + m[3] * m[3]));
      if (a > 0.2 * (m[0] * m[0] + m[1] * m[1])) warnings.add('non-uniform stroke scaling');
    }
    const slot = inh['data-slot'];
    const toneRaw = inh['data-tone'];
    return {
      kind: 'leaf',
      segs: transformPath(geo, m),
      fill,
      stroke,
      attrs,
      strokeWidth: sw,
      dash,
      dashOffset,
      opacity: 1,
      ...(slot === undefined ? {} : { slot }),
      ...(toneRaw === undefined ? {} : { tone: Number(toneRaw) || 0 }),
    };
  };

  /** Only a rectangular clip that its content does not cross is allowed (and dropped). */
  const applyClip = (ref: string, m: Matrix, items: Item[]): Item[] => {
    const id = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)$/.exec(ref)?.[1];
    const cp = id === undefined ? undefined : ids.get(id);
    if (!cp || localName(cp.tag) !== 'clipPath') {
      warnings.add('missing clip path ignored');
      return items;
    }
    if (cp.attrs['clipPathUnits'] === 'objectBoundingBox')
      throw new Reject('clip path (bbox units)');
    if (own(cp)['clip-path'] !== undefined) throw new Reject('nested clip path');
    let cm = m;
    const ctr = cp.attrs['transform'];
    if (typeof ctr === 'string') cm = multiply(cm, parseTransform(ctr));
    const shapes: Seg[][] = [];
    const collect = (n: SvgNode, mm: Matrix, d: number): void => {
      if (d > 8) throw new Reject('clip path too deep');
      for (const c of n.children) {
        if (typeof c === 'string') continue;
        const t = localName(c.tag);
        let cmm = mm;
        const tr = c.attrs['transform'];
        if (typeof tr === 'string') cmm = multiply(cmm, parseTransform(tr));
        if (t === 'use') {
          const href = String(c.attrs['href'] ?? c.attrs['xlink:href'] ?? '');
          const target = href.startsWith('#') ? ids.get(href.slice(1)) : undefined;
          if (!target) continue;
          const x = num(String(c.attrs['x'] ?? '0'), 0);
          const y = num(String(c.attrs['y'] ?? '0'), 0);
          collect(
            { tag: 'g', attrs: {}, children: [target] },
            multiply(cmm, [1, 0, 0, 1, x, y]),
            d + 1,
          );
        } else if (SHAPES.has(t)) {
          const g = shapeToPath(t, c.attrs);
          if (g) shapes.push(transformPath(g, cmm));
        } else if (t === 'g') collect(c, cmm, d + 1);
        else if (t === 'text') throw new Reject('text clip path');
      }
    };
    collect(cp, cm, 0);
    if (shapes.length === 0) return [];
    const content = itemBox(items);
    const size = Math.max(content.x1 - content.x0, content.y1 - content.y0, 1e-9);
    const tol = size * 0.01;
    const rects = shapes.map((s) => {
      const poly = polygonOf(s);
      return poly ? rectOf(poly, Math.max(1e-6, size * 1e-4)) : null;
    });
    const inside = (r: Box): boolean =>
      content.x0 >= r.x0 - tol &&
      content.y0 >= r.y0 - tol &&
      content.x1 <= r.x1 + tol &&
      content.y1 <= r.y1 + tol;
    const disjoint = (r: Box): boolean =>
      content.x1 <= r.x0 || content.x0 >= r.x1 || content.y1 <= r.y0 || content.y0 >= r.y1;
    if (rects.some((r) => r !== null && inside(r))) return items;
    if (rects.every((r) => r !== null && disjoint(r))) return [];
    throw new Reject('clip path that cuts the artwork');
  };

  let items = walk(root, IDENTITY, {}, 0, 0);
  if (items.length === 0) throw new Reject('nothing is drawn');
  const box = itemBox(items);
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const long = Math.max(bw, bh);
  if (!Number.isFinite(long) || long <= 0) throw new Reject('nothing is drawn');
  const pad = long * PAD;
  const scale = 100 / (long + 2 * pad);
  const W = Math.round((bw + 2 * pad) * scale * 100) / 100;
  const H = Math.round((bh + 2 * pad) * scale * 100) / 100;
  items = mapItems(items, [scale, 0, 0, scale, (pad - box.x0) * scale, (pad - box.y0) * scale]);

  // --- slots ---------------------------------------------------------------------------
  const all = leaves(items);
  const maxNodes = opts.maxNodes ?? MAX_NODES;
  if (all.length > maxNodes) throw new Reject(`too complex (${String(all.length)} elements)`);
  let slots: readonly SlotDef[];
  let recolor: 'slots' | 'whole' = 'slots';
  let colorError = 0;
  interface Paint {
    slot: string;
    tone: number;
    hex: string;
  }
  const assign = new Map<Leaf, { fill: Paint | null; stroke: Paint | null }>();
  if (opts.slots) {
    slots = opts.slots;
    const byId = new Map(slots.map((s) => [s.id, s]));
    for (const l of all) {
      const def = l.slot === undefined ? undefined : byId.get(l.slot);
      if (!def) throw new Reject(`painted element without a declared slot (${l.slot ?? 'none'})`);
      const tone = l.tone ?? 0;
      const p: Paint = { slot: def.id, tone, hex: shiftLightness(def.default, tone) };
      assign.set(l, { fill: l.fill === 'none' ? null : p, stroke: l.stroke === 'none' ? null : p });
    }
  } else {
    const uses: { hex: string; weight: number }[] = [];
    for (const l of all) {
      const b = pathBox(l.segs);
      const area = Math.max(0.01, (b.x1 - b.x0) * (b.y1 - b.y0));
      if (l.fill !== 'none') uses.push({ hex: l.fill, weight: area });
      if (l.stroke !== 'none') uses.push({ hex: l.stroke, weight: Math.max(0.01, area * 0.1) });
    }
    const plan = planSlots(uses);
    slots = plan.slots;
    recolor = plan.recolor;
    colorError = plan.maxError;
    const pick = (hex: string): Paint | null => {
      if (hex === 'none') return null;
      const a = plan.map.get(hex);
      if (!a) throw new Error(`unplanned colour ${hex}`);
      return a;
    };
    for (const l of all) assign.set(l, { fill: pick(l.fill), stroke: pick(l.stroke) });
  }

  // --- serialise ------------------------------------------------------------------------
  const render = (dp: number): { body: string; nodes: number } => {
    let nodes = 0;
    const leafEl = (l: Leaf, fill: Paint | null, stroke: Paint | null, d: string): string => {
      nodes += 1;
      const p = fill ?? stroke;
      if (!p) return '';
      const a: string[] = [`d="${d}"`, `fill="${fill ? fill.hex : 'none'}"`];
      if (fill) {
        if (l.attrs['fill-rule']) a.push(`fill-rule="evenodd"`);
        if (l.attrs['fill-opacity']) a.push(`fill-opacity="${l.attrs['fill-opacity']}"`);
      }
      if (stroke) {
        a.push(`stroke="${stroke.hex}"`, `stroke-width="${fmt(l.strokeWidth, dp + 1)}"`);
        for (const k of [
          'stroke-opacity',
          'stroke-linecap',
          'stroke-linejoin',
          'stroke-miterlimit',
        ] as const) {
          const v = l.attrs[k];
          if (v !== undefined) a.push(`${k}="${v}"`);
        }
        if (l.dash) {
          a.push(`stroke-dasharray="${l.dash.map((x) => fmt(x, dp)).join(' ')}"`);
          if (l.dashOffset) a.push(`stroke-dashoffset="${fmt(l.dashOffset, dp)}"`);
        }
      }
      if (l.opacity < 1) a.push(`opacity="${fmt(l.opacity)}"`);
      a.push(`data-slot="${p.slot}"`);
      if (p.tone !== 0) a.push(`data-tone="${fmt(p.tone)}"`);
      return `<path ${a.join(' ')}/>`;
    };
    const out = (list: readonly Item[]): string =>
      list
        .map((it) => {
          if (it.kind === 'group') {
            nodes += 1;
            const a: string[] = [];
            if (it.part !== undefined) a.push(`data-part="${it.part.replace(/[^\w-]/g, '')}"`);
            if (it.opacity < 1) a.push(`opacity="${fmt(it.opacity)}"`);
            return `<g${a.length ? ` ${a.join(' ')}` : ''}>${out(it.children)}</g>`;
          }
          const { fill, stroke } = assign.get(it) ?? { fill: null, stroke: null };
          const d = serializePath(it.segs, dp);
          const same =
            !fill ||
            !stroke ||
            (fill.slot === stroke.slot && Math.abs(fill.tone - stroke.tone) < 0.005);
          if (same) return leafEl(it, fill, stroke, d);
          const pair = leafEl(it, fill, null, d) + leafEl(it, null, stroke, d);
          if (it.opacity < 1) {
            nodes += 1;
            // Opacity moves to a group so the overlap of fill and stroke composites as before.
            return `<g opacity="${fmt(it.opacity)}">${pair.replace(/ opacity="[^"]*"/g, '')}</g>`;
          }
          return pair;
        })
        .join('');
    return { body: out(items), nodes };
  };

  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  let svg = '';
  let nodes = 0;
  for (const dp of [2, 1]) {
    const r = render(dp);
    nodes = r.nodes;
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(W)} ${String(H)}">${r.body}</svg>\n`;
    // 0.01 units of a 100-unit icon is far below print resolution; large icons get 0.1.
    if (svg.length <= COMPACT_BYTES) break;
  }
  if (nodes > maxNodes) throw new Reject(`too complex (${String(nodes)} elements)`);
  if (svg.length > maxBytes)
    throw new Reject(`too large (${String(Math.round(svg.length / 1000))} kB)`);
  return {
    ok: true,
    svg,
    width: W,
    height: H,
    slots,
    recolor,
    nodes,
    colorError,
    warnings: [...warnings],
  };
}
