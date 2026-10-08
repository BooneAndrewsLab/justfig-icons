/*
 * Copied from the JustFig app (src/io/svg/sanitize.ts) at its Phase 1 state; keep the two in
 * step by hand when either changes (the plan allows a copy or a workspace
 * package; a copy keeps this repo buildable on its own).
 */
/**
 * SVG sanitiser and normaliser (notes 01 and 03): any SVG text → a tree in
 * the export subset. Used for imported SVGs and, defensively, for every
 * icon placed; the Phase 2 icon pipeline starts from this module (copied),
 * adding transform flattening, viewBox cropping and slot clustering.
 *
 * - Elements outside the allow-list are dropped with their content
 *   (script, foreignObject, image, filter, mask, clipPath, …) and logged.
 * - `<style>` rules (simple tag, .class and #id selectors) and `style=`
 *   are resolved into presentation attributes.
 * - `<use>` is inlined (as a <g> with its x/y translate); `<defs>` dropped.
 * - Gradient paints become their average stop colour.
 * - Event handlers, ids, classes, external references and unknown
 *   attributes are dropped; `currentColor` becomes black.
 */
import { type SvgNode, el, walkNodes } from './svgNode.ts';
import { parseXml } from './xml.ts';

export interface SanitizedSvg {
  /** `<svg viewBox>` root with only allowed content. */
  readonly root: SvgNode;
  readonly viewBox: readonly [number, number, number, number];
  /** What was removed or approximated, for the import report. */
  readonly warnings: readonly string[];
}

export class SvgImportError extends Error {
  override readonly name = 'SvgImportError';
}

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const CONTAINERS = new Set(['svg', 'g', 'a', 'switch']);
const TEXT = new Set(['text', 'tspan']);
const DROP_SILENT = new Set([
  'title',
  'desc',
  'metadata',
  'defs',
  'style',
  'linearGradient',
  'radialGradient',
  'symbol',
]);

const PRESENTATION = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
];
const PRESENTATION_SET = new Set(PRESENTATION);

const GEOMETRY: Readonly<Record<string, readonly string[]>> = {
  path: ['d'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
  text: ['x', 'y', 'xml:space'],
  tspan: ['x', 'y'],
};

const KEEP_DATA = ['data-slot', 'data-tone', 'data-part'];

export interface CssRule {
  readonly sel: string;
  readonly decls: Readonly<Record<string, string>>;
}

export function parseDecls(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part
      .slice(i + 1)
      .replace(/!important/i, '')
      .trim();
    if (k && v) out[k] = v;
  }
  return out;
}

export function parseCss(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const decls = parseDecls(m[2] ?? '');
    for (const sel of (m[1] ?? '').split(',')) {
      const s = sel.trim();
      if (/^([a-zA-Z]+|\.[\w-]+|#[\w-]+)$/.test(s)) rules.push({ sel: s, decls });
    }
  }
  return rules;
}

export function matches(sel: string, n: SvgNode): boolean {
  const a = n.attrs;
  if (sel.startsWith('.'))
    return String(a['class'] ?? '')
      .split(/\s+/)
      .includes(sel.slice(1));
  if (sel.startsWith('#')) return a['id'] === sel.slice(1);
  return n.tag === sel;
}

const NAMED: Readonly<Record<string, string>> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
};

function hex2(n: number): string {
  return Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0');
}

/** A colour value in the subset: #rrggbb, 'none', or null when unusable. */
export function normalizeColor(v: string, gradients: ReadonlyMap<string, string>): string | null {
  const s = v.trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return 'none';
  if (s === 'currentcolor') return '#000000';
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s.slice(1).replace(/./g, (c) => c + c)}`;
  const rgb = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)/.exec(s);
  if (rgb) {
    const ch = (v: string | undefined, pct: string | undefined) =>
      hex2(pct === '%' ? (Number(v) * 255) / 100 : Number(v));
    return `#${ch(rgb[1], rgb[2])}${ch(rgb[3], rgb[4])}${ch(rgb[5], rgb[6])}`;
  }
  const url = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(s);
  if (url) return gradients.get(url[1] ?? '') ?? 'none';
  return NAMED[s] ?? null;
}

export function gradientColors(
  root: SvgNode,
  ids: ReadonlyMap<string, SvgNode>,
): Map<string, string> {
  const out = new Map<string, string>();
  const stopsOf = (g: SvgNode, depth = 0): SvgNode[] => {
    const own = g.children.filter((c): c is SvgNode => typeof c !== 'string' && c.tag === 'stop');
    if (own.length > 0 || depth > 4) return own;
    const href = String(g.attrs['href'] ?? g.attrs['xlink:href'] ?? '');
    const target = href.startsWith('#') ? ids.get(href.slice(1)) : undefined;
    return target ? stopsOf(target, depth + 1) : [];
  };
  for (const n of walkNodes(root)) {
    if (n.tag !== 'linearGradient' && n.tag !== 'radialGradient') continue;
    const id = n.attrs['id'];
    if (typeof id !== 'string') continue;
    let r = 0;
    let g = 0;
    let b = 0;
    let k = 0;
    for (const s of stopsOf(n)) {
      const style = parseDecls(String(s.attrs['style'] ?? ''));
      const c = normalizeColor(
        style['stop-color'] ?? String(s.attrs['stop-color'] ?? '#000000'),
        new Map(),
      );
      if (!c || c === 'none') continue;
      r += parseInt(c.slice(1, 3), 16);
      g += parseInt(c.slice(3, 5), 16);
      b += parseInt(c.slice(5, 7), 16);
      k += 1;
    }
    if (k > 0) out.set(id, `#${hex2(r / k)}${hex2(g / k)}${hex2(b / k)}`);
  }
  return out;
}

export function numberList(s: string): number[] {
  return s
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((x) => Number.isFinite(x));
}

/** Width/height attribute in user units (px, pt, mm, cm, in; % ignored). */
export function length(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const m = /^\s*([\d.]+)\s*(px|pt|mm|cm|in)?\s*$/.exec(String(v));
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? 'px';
  const k: Record<string, number> = { px: 1, pt: 4 / 3, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
  return n * (k[unit] ?? 1);
}

export function sanitizeSvg(text: string): SanitizedSvg {
  let parsed: SvgNode;
  try {
    parsed = parseXml(text);
  } catch (e: unknown) {
    throw new SvgImportError(
      `This is not a readable SVG file (${e instanceof Error ? e.message : 'parse error'}).`,
    );
  }
  if (parsed.tag !== 'svg' && !parsed.tag.endsWith(':svg'))
    throw new SvgImportError('This is not an SVG file.');
  const warnings = new Set<string>();
  const ids = new Map<string, SvgNode>();
  const css: CssRule[] = [];
  for (const n of walkNodes(parsed)) {
    const id = n.attrs['id'];
    if (typeof id === 'string') ids.set(id, n);
    if (n.tag === 'style')
      css.push(...parseCss(n.children.filter((c) => typeof c === 'string').join('')));
  }
  const gradients = gradientColors(parsed, ids);

  /** Element → its own presentation values (attr < CSS < style=). */
  const own = (n: SvgNode): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.attrs))
      if (PRESENTATION_SET.has(k) && v !== undefined) out[k] = String(v);
    for (const r of css) if (matches(r.sel, n)) Object.assign(out, r.decls);
    Object.assign(out, parseDecls(String(n.attrs['style'] ?? '')));
    return out;
  };

  const clean = (n: SvgNode, depth: number, useDepth: number): SvgNode | null => {
    const tag = n.tag.includes(':') ? '' : n.tag;
    if (depth > 64) return null;
    if (tag === 'use') {
      const href = String(n.attrs['href'] ?? n.attrs['xlink:href'] ?? '');
      const target = href.startsWith('#') ? ids.get(href.slice(1)) : undefined;
      if (!target || useDepth > 8) {
        warnings.add('Removed a reference to something outside the file.');
        return null;
      }
      const inner = clean(
        target.tag === 'symbol' ? { ...target, tag: 'g' } : target,
        depth + 1,
        useDepth + 1,
      );
      if (!inner) return null;
      const x = Number(n.attrs['x'] ?? 0) || 0;
      const y = Number(n.attrs['y'] ?? 0) || 0;
      const t = [n.attrs['transform'], x || y ? `translate(${String(x)} ${String(y)})` : undefined]
        .filter((s) => s !== undefined)
        .join(' ');
      return el('g', { ...pres(n), ...(t ? { transform: t } : {}) }, [inner]);
    }
    if (!(CONTAINERS.has(tag) || SHAPES.has(tag) || TEXT.has(tag))) {
      if (!DROP_SILENT.has(tag) && tag !== '')
        warnings.add(`Removed unsupported <${n.tag}> content.`);
      return null;
    }
    const attrs: Record<string, string> = {};
    for (const k of GEOMETRY[tag] ?? []) {
      const v = n.attrs[k];
      if (v !== undefined) attrs[k] = String(v);
    }
    const tr = n.attrs['transform'];
    if (typeof tr === 'string' && tag !== 'svg') attrs['transform'] = tr;
    Object.assign(attrs, pres(n));
    for (const k of KEEP_DATA) {
      const v = n.attrs[k];
      if (v !== undefined) attrs[k] = String(v);
    }
    const children: (SvgNode | string)[] = [];
    for (const c of n.children) {
      if (typeof c === 'string') {
        if (TEXT.has(tag)) children.push(c);
        continue;
      }
      const k = clean(c, depth + 1, useDepth);
      if (k) children.push(k);
    }
    if (tag === 'svg' && depth > 0) {
      // A nested <svg>: kept as a group at its x/y; its own viewport clipping is not.
      const x = Number(n.attrs['x'] ?? 0) || 0;
      const y = Number(n.attrs['y'] ?? 0) || 0;
      return el(
        'g',
        x || y ? { ...attrs, transform: `translate(${String(x)} ${String(y)})` } : attrs,
        children,
      );
    }
    return el(tag === 'a' || tag === 'switch' ? 'g' : tag, attrs, children);
  };

  const pres = (n: SvgNode): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, raw] of Object.entries(own(n))) {
      if (!PRESENTATION_SET.has(k)) continue;
      if (k === 'fill' || k === 'stroke') {
        const c = normalizeColor(raw, gradients);
        if (c === null) {
          warnings.add(`Replaced an unsupported colour (${raw}).`);
          out[k] = '#000000';
        } else {
          if (raw.includes('url('))
            warnings.add('Gradients were replaced by their average colour.');
          out[k] = c;
        }
      } else if (/^[\w\s.,#%"'()-]*$/.test(raw) && !raw.includes('url(') && !raw.includes('var(')) {
        out[k] = raw;
      }
    }
    return out;
  };

  const vb = numberList(String(parsed.attrs['viewBox'] ?? ''));
  const w = length(parsed.attrs['width']);
  const h = length(parsed.attrs['height']);
  let viewBox: [number, number, number, number];
  if (vb.length === 4 && (vb[2] ?? 0) > 0 && (vb[3] ?? 0) > 0) {
    viewBox = [vb[0] ?? 0, vb[1] ?? 0, vb[2] ?? 1, vb[3] ?? 1];
  } else if (w && h) {
    viewBox = [0, 0, w, h];
  } else {
    throw new SvgImportError('This SVG has no size (no viewBox, width or height).');
  }
  const body = clean(parsed, 0, 0);
  const root = el(
    'svg',
    { viewBox: viewBox.map(String).join(' '), ...pres(parsed) },
    body ? body.children : [],
  );
  return { root, viewBox, warnings: [...warnings] };
}
