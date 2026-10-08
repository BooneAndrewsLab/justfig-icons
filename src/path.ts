/**
 * Path geometry for the normaliser: SVG path data and basic shapes →
 * absolute segments (M, L, C, Q, Z only: H/V become L, S/T are expanded,
 * arcs become cubic Béziers), affine transforms, exact bounding boxes and
 * a compact serialiser. Flattening transforms into the path data is what
 * lets a normalised icon carry no `transform` at all.
 */

export type Seg =
  | { readonly c: 'M'; readonly x: number; readonly y: number }
  | { readonly c: 'L'; readonly x: number; readonly y: number }
  | {
      readonly c: 'C';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly c: 'Q';
      readonly x1: number;
      readonly y1: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly c: 'Z' };

/** Affine matrix [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export class PathError extends Error {
  override readonly name = 'PathError';
}

export function multiply(m: Matrix, n: Matrix): Matrix {
  // m × n: apply n first, then m.
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/** The factor a line width scales by (geometric mean of the axis scales). */
export const lineScale = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

export function parseTransform(s: string): Matrix {
  let m: Matrix = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let found = false;
  let r: RegExpExecArray | null;
  while ((r = re.exec(s)) !== null) {
    found = true;
    const v = (r[2] ?? '')
      .trim()
      .split(/[\s,]+/)
      .filter((x) => x !== '')
      .map(Number);
    if (v.some((x) => !Number.isFinite(x))) throw new PathError(`bad transform "${s}"`);
    const [a = 0, b, c, d, e, f] = v;
    let t: Matrix;
    switch (r[1] ?? '') {
      case 'matrix':
        if (v.length !== 6) throw new PathError(`bad matrix "${s}"`);
        t = [a, b ?? 0, c ?? 0, d ?? 0, e ?? 0, f ?? 0];
        break;
      case 'translate':
        t = [1, 0, 0, 1, a, b ?? 0];
        break;
      case 'scale':
        t = [a, 0, 0, b ?? a, 0, 0];
        break;
      case 'rotate': {
        const rad = (a * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rot: Matrix = [cos, sin, -sin, cos, 0, 0];
        t =
          b !== undefined && c !== undefined
            ? multiply(multiply([1, 0, 0, 1, b, c], rot), [1, 0, 0, 1, -b, -c])
            : rot;
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        throw new PathError(`bad transform "${s}"`);
    }
    m = multiply(m, t);
  }
  if (!found && s.trim() !== '') throw new PathError(`bad transform "${s}"`);
  return m;
}

/** Arc (endpoint form) → cubic Béziers, per SVG 1.1 appendix F.6. */
function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): Seg[] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ c: 'L', x: x2, y: y2 }];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    const k = Math.sqrt(lambda);
    rx *= k;
    ry *= k;
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * yp) / ry;
  const cyp = (-coef * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let delta = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: Seg[] = [];
  const pt = (t: number): [number, number] => {
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    return [cx + cos * ex - sin * ey, cy + sin * ex + cos * ey];
  };
  const deriv = (t: number): [number, number] => {
    const ex = -rx * Math.sin(t);
    const ey = ry * Math.cos(t);
    return [cos * ex - sin * ey, sin * ex + cos * ey];
  };
  for (let i = 0; i < n; i += 1) {
    const t0 = theta1 + i * step;
    const t1 = t0 + step;
    const [p0x, p0y] = pt(t0);
    const [p1x, p1y] = i === n - 1 ? [x2, y2] : pt(t1);
    const [d0x, d0y] = deriv(t0);
    const [d1x, d1y] = deriv(t1);
    out.push({
      c: 'C',
      x1: p0x + k * d0x,
      y1: p0y + k * d0y,
      x2: p1x - k * d1x,
      y2: p1y - k * d1y,
      x: p1x,
      y: p1y,
    });
  }
  return out;
}

const ARGS: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

/** Path data → absolute M/L/C/Q/Z segments. Throws PathError on bad data. */
export function parsePath(d: string): Seg[] {
  const out: Seg[] = [];
  let i = 0;
  const n = d.length;
  const skip = (): void => {
    while (i < n && /[\s,]/.test(d[i] ?? '')) i += 1;
  };
  const number = (): number => {
    skip();
    NUM.lastIndex = i;
    const m = NUM.exec(d);
    if (!m) throw new PathError(`bad number at ${i} in path data`);
    i = NUM.lastIndex;
    return Number(m[0]);
  };
  const flag = (): boolean => {
    skip();
    const c = d[i];
    if (c !== '0' && c !== '1') throw new PathError(`bad arc flag at ${i}`);
    i += 1;
    return c === '1';
  };
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastC: [number, number] | null = null;
  let lastQ: [number, number] | null = null;
  let cmd = '';
  let started = false;
  for (;;) {
    skip();
    if (i >= n) break;
    const ch = d[i] ?? '';
    if (/[a-zA-Z]/.test(ch)) {
      if (ARGS[ch.toUpperCase()] === undefined) throw new PathError(`bad command ${ch}`);
      cmd = ch;
      i += 1;
    } else if (cmd === '' || cmd === 'z' || cmd === 'Z') {
      throw new PathError('path data must start with a command');
    }
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    if (!started && up !== 'M') throw new PathError('path data must start with M');
    started = true;
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    let nextC: [number, number] | null = null;
    let nextQ: [number, number] | null = null;
    switch (up) {
      case 'M': {
        const x = number() + ox;
        const y = number() + oy;
        out.push({ c: 'M', x, y });
        cx = sx = x;
        cy = sy = y;
        // Further pairs are implicit line-tos.
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': {
        cx = number() + ox;
        cy = number() + oy;
        out.push({ c: 'L', x: cx, y: cy });
        break;
      }
      case 'H': {
        cx = number() + ox;
        out.push({ c: 'L', x: cx, y: cy });
        break;
      }
      case 'V': {
        cy = number() + oy;
        out.push({ c: 'L', x: cx, y: cy });
        break;
      }
      case 'C': {
        const x1 = number() + ox;
        const y1 = number() + oy;
        const x2 = number() + ox;
        const y2 = number() + oy;
        cx = number() + ox;
        cy = number() + oy;
        out.push({ c: 'C', x1, y1, x2, y2, x: cx, y: cy });
        nextC = [x2, y2];
        break;
      }
      case 'S': {
        const x1: number = lastC ? 2 * cx - lastC[0] : cx;
        const y1: number = lastC ? 2 * cy - lastC[1] : cy;
        const x2 = number() + ox;
        const y2 = number() + oy;
        cx = number() + ox;
        cy = number() + oy;
        out.push({ c: 'C', x1, y1, x2, y2, x: cx, y: cy });
        nextC = [x2, y2];
        break;
      }
      case 'Q': {
        const x1 = number() + ox;
        const y1 = number() + oy;
        cx = number() + ox;
        cy = number() + oy;
        out.push({ c: 'Q', x1, y1, x: cx, y: cy });
        nextQ = [x1, y1];
        break;
      }
      case 'T': {
        const x1: number = lastQ ? 2 * cx - lastQ[0] : cx;
        const y1: number = lastQ ? 2 * cy - lastQ[1] : cy;
        cx = number() + ox;
        cy = number() + oy;
        out.push({ c: 'Q', x1, y1, x: cx, y: cy });
        nextQ = [x1, y1];
        break;
      }
      case 'A': {
        const rx = number();
        const ry = number();
        const rot = number();
        const large = flag();
        const sweep = flag();
        const x = number() + ox;
        const y = number() + oy;
        out.push(...arcToCubics(cx, cy, rx, ry, rot, large, sweep, x, y));
        cx = x;
        cy = y;
        break;
      }
      default: {
        out.push({ c: 'Z' });
        cx = sx;
        cy = sy;
      }
    }
    lastC = nextC;
    lastQ = nextQ;
  }
  return out;
}

const f = (v: string | number | undefined): number => {
  const x = typeof v === 'number' ? v : Number((v ?? '0').replace(/px$/, ''));
  return Number.isFinite(x) ? x : 0;
};

function points(s: string): number[] {
  return s
    .trim()
    .split(/[\s,]+/)
    .filter((x) => x !== '')
    .map(Number)
    .filter((x) => Number.isFinite(x));
}

/** A basic shape's geometry as segments; null when it draws nothing. */
export function shapeToPath(
  tag: string,
  a: Readonly<Record<string, string | number | undefined>>,
): Seg[] | null {
  const K = 0.5522847498;
  const ellipse = (cx: number, cy: number, rx: number, ry: number): Seg[] => [
    { c: 'M', x: cx + rx, y: cy },
    { c: 'C', x1: cx + rx, y1: cy + K * ry, x2: cx + K * rx, y2: cy + ry, x: cx, y: cy + ry },
    { c: 'C', x1: cx - K * rx, y1: cy + ry, x2: cx - rx, y2: cy + K * ry, x: cx - rx, y: cy },
    { c: 'C', x1: cx - rx, y1: cy - K * ry, x2: cx - K * rx, y2: cy - ry, x: cx, y: cy - ry },
    { c: 'C', x1: cx + K * rx, y1: cy - ry, x2: cx + rx, y2: cy - K * ry, x: cx + rx, y: cy },
    { c: 'Z' },
  ];
  switch (tag) {
    case 'path': {
      const d = a['d'];
      if (typeof d !== 'string' || d.trim() === '' || d.trim() === 'none') return null;
      const s = parsePath(d);
      return s.length > 0 ? s : null;
    }
    case 'rect': {
      const x = f(a['x']);
      const y = f(a['y']);
      const w = f(a['width']);
      const h = f(a['height']);
      if (w <= 0 || h <= 0) return null;
      let rx = a['rx'] === undefined ? undefined : f(a['rx']);
      let ry = a['ry'] === undefined ? undefined : f(a['ry']);
      rx ??= ry ?? 0;
      ry ??= rx;
      rx = Math.min(Math.max(0, rx), w / 2);
      ry = Math.min(Math.max(0, ry), h / 2);
      if (rx === 0 || ry === 0)
        return [
          { c: 'M', x, y },
          { c: 'L', x: x + w, y },
          { c: 'L', x: x + w, y: y + h },
          { c: 'L', x, y: y + h },
          { c: 'Z' },
        ];
      const kx = K * rx;
      const ky = K * ry;
      return [
        { c: 'M', x: x + rx, y },
        { c: 'L', x: x + w - rx, y },
        { c: 'C', x1: x + w - rx + kx, y1: y, x2: x + w, y2: y + ry - ky, x: x + w, y: y + ry },
        { c: 'L', x: x + w, y: y + h - ry },
        {
          c: 'C',
          x1: x + w,
          y1: y + h - ry + ky,
          x2: x + w - rx + kx,
          y2: y + h,
          x: x + w - rx,
          y: y + h,
        },
        { c: 'L', x: x + rx, y: y + h },
        { c: 'C', x1: x + rx - kx, y1: y + h, x2: x, y2: y + h - ry + ky, x, y: y + h - ry },
        { c: 'L', x, y: y + ry },
        { c: 'C', x1: x, y1: y + ry - ky, x2: x + rx - kx, y2: y, x: x + rx, y },
        { c: 'Z' },
      ];
    }
    case 'circle': {
      const r = f(a['r']);
      return r > 0 ? ellipse(f(a['cx']), f(a['cy']), r, r) : null;
    }
    case 'ellipse': {
      const rx = f(a['rx']);
      const ry = f(a['ry']);
      return rx > 0 && ry > 0 ? ellipse(f(a['cx']), f(a['cy']), rx, ry) : null;
    }
    case 'line':
      return [
        { c: 'M', x: f(a['x1']), y: f(a['y1']) },
        { c: 'L', x: f(a['x2']), y: f(a['y2']) },
      ];
    case 'polyline':
    case 'polygon': {
      const p = points(String(a['points'] ?? ''));
      if (p.length < 4) return null;
      const out: Seg[] = [];
      for (let i = 0; i + 1 < p.length; i += 2)
        out.push({ c: i === 0 ? 'M' : 'L', x: p[i] ?? 0, y: p[i + 1] ?? 0 });
      if (tag === 'polygon') out.push({ c: 'Z' });
      return out;
    }
    default:
      return null;
  }
}

export function transformPath(segs: readonly Seg[], m: Matrix): Seg[] {
  return segs.map((s): Seg => {
    switch (s.c) {
      case 'Z':
        return s;
      case 'M':
      case 'L': {
        const [x, y] = apply(m, s.x, s.y);
        return { c: s.c, x, y };
      }
      case 'Q': {
        const [x1, y1] = apply(m, s.x1, s.y1);
        const [x, y] = apply(m, s.x, s.y);
        return { c: 'Q', x1, y1, x, y };
      }
      case 'C': {
        const [x1, y1] = apply(m, s.x1, s.y1);
        const [x2, y2] = apply(m, s.x2, s.y2);
        const [x, y] = apply(m, s.x, s.y);
        return { c: 'C', x1, y1, x2, y2, x, y };
      }
    }
  });
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const emptyBox = (): Box => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

const addPt = (b: Box, x: number, y: number): void => {
  if (x < b.x0) b.x0 = x;
  if (y < b.y0) b.y0 = y;
  if (x > b.x1) b.x1 = x;
  if (y > b.y1) b.y1 = y;
};

/** Roots in (0,1) of the derivative of a 1-D cubic Bézier. */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const out: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) out.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      out.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/** Exact bounding box of the geometry (control points excluded). */
export function pathBox(segs: readonly Seg[], into: Box = emptyBox()): Box {
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const s of segs) {
    switch (s.c) {
      case 'M':
        addPt(into, s.x, s.y);
        cx = sx = s.x;
        cy = sy = s.y;
        break;
      case 'L':
        addPt(into, s.x, s.y);
        cx = s.x;
        cy = s.y;
        break;
      case 'Q': {
        // Elevate to a cubic for one extrema routine.
        const c1x = cx + (2 / 3) * (s.x1 - cx);
        const c1y = cy + (2 / 3) * (s.y1 - cy);
        const c2x = s.x + (2 / 3) * (s.x1 - s.x);
        const c2y = s.y + (2 / 3) * (s.y1 - s.y);
        addCubic(into, cx, cy, c1x, c1y, c2x, c2y, s.x, s.y);
        cx = s.x;
        cy = s.y;
        break;
      }
      case 'C':
        addCubic(into, cx, cy, s.x1, s.y1, s.x2, s.y2, s.x, s.y);
        cx = s.x;
        cy = s.y;
        break;
      case 'Z':
        cx = sx;
        cy = sy;
        break;
    }
  }
  return into;
}

function addCubic(
  b: Box,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): void {
  addPt(b, x3, y3);
  for (const t of cubicExtrema(x0, x1, x2, x3)) addPt(b, cubicAt(x0, x1, x2, x3, t), y0);
  for (const t of cubicExtrema(y0, y1, y2, y3)) addPt(b, x0, cubicAt(y0, y1, y2, y3, t));
}

/**
 * The polygon a path traces when it is made of straight lines only (one
 * subpath), else null. Used to recognise rectangular clip paths.
 */
export function polygonOf(segs: readonly Seg[]): [number, number][] | null {
  const pts: [number, number][] = [];
  let moves = 0;
  for (const s of segs) {
    if (s.c === 'C' || s.c === 'Q') return null;
    if (s.c === 'M') {
      moves += 1;
      if (moves > 1) return null;
    }
    if (s.c === 'Z') continue;
    pts.push([s.x, s.y]);
  }
  return pts;
}

/** An axis-aligned rectangle traced by a polygon (any start, either direction), else null. */
export function rectOf(pts: readonly [number, number][], eps = 1e-6): Box | null {
  const uniq: [number, number][] = [];
  for (const p of pts) {
    const last = uniq[uniq.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > eps || Math.abs(last[1] - p[1]) > eps) uniq.push(p);
  }
  const first = uniq[0];
  const last = uniq[uniq.length - 1];
  if (
    first &&
    last &&
    uniq.length > 1 &&
    Math.abs(first[0] - last[0]) <= eps &&
    Math.abs(first[1] - last[1]) <= eps
  )
    uniq.pop();
  if (uniq.length !== 4) return null;
  for (let i = 0; i < 4; i += 1) {
    const a = uniq[i] ?? [0, 0];
    const b = uniq[(i + 1) % 4] ?? [0, 0];
    const horizontal = Math.abs(a[1] - b[1]) <= eps;
    const vertical = Math.abs(a[0] - b[0]) <= eps;
    if (horizontal === vertical) return null;
  }
  const b = emptyBox();
  for (const [x, y] of uniq) addPt(b, x, y);
  return b;
}

/** Rounds to `dp` decimals, without -0 and trailing zeros; drops a leading 0. */
function fmt(v: number, dp: number): string {
  const k = 10 ** dp;
  let r = Math.round(v * k) / k;
  if (Object.is(r, -0)) r = 0;
  let s = String(r);
  if (s.startsWith('0.')) s = s.slice(1);
  else if (s.startsWith('-0.')) s = `-${s.slice(2)}`;
  return s;
}

/** Joins numbers with the fewest separators (a minus or a leading dot separates). */
function join(nums: readonly string[]): string {
  let out = '';
  let prev = '';
  for (const n of nums) {
    if (out === '' || n.startsWith('-') || (n.startsWith('.') && prev.includes('.'))) out += n;
    else out += ` ${n}`;
    prev = n;
  }
  return out;
}

/** Compact relative path data at `dp` decimals. */
export function serializePath(segs: readonly Seg[], dp = 2): string {
  const k = 10 ** dp;
  const q = (v: number): number => Math.round(v * k) / k;
  let out = '';
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let prevCmd = '';
  const emit = (cmd: string, vals: number[]): void => {
    const s = vals.map((v) => fmt(v, dp));
    const body = join(s);
    if (cmd === prevCmd && cmd !== 'm') {
      out += body.startsWith('-') ? body : ` ${body}`;
    } else {
      out += cmd + body;
    }
    prevCmd = cmd;
  };
  for (const s of segs) {
    switch (s.c) {
      case 'M': {
        const x = q(s.x);
        const y = q(s.y);
        emit('m', [x - cx, y - cy]);
        cx = sx = x;
        cy = sy = y;
        break;
      }
      case 'L': {
        const x = q(s.x);
        const y = q(s.y);
        if (x === cx) emit('v', [y - cy]);
        else if (y === cy) emit('h', [x - cx]);
        else emit('l', [x - cx, y - cy]);
        cx = x;
        cy = y;
        break;
      }
      case 'Q': {
        const x = q(s.x);
        const y = q(s.y);
        emit('q', [q(s.x1) - cx, q(s.y1) - cy, x - cx, y - cy]);
        cx = x;
        cy = y;
        break;
      }
      case 'C': {
        const x = q(s.x);
        const y = q(s.y);
        emit('c', [q(s.x1) - cx, q(s.y1) - cy, q(s.x2) - cx, q(s.y2) - cy, x - cx, y - cy]);
        cx = x;
        cy = y;
        break;
      }
      case 'Z':
        out += 'z';
        prevCmd = 'z';
        cx = sx;
        cy = sy;
        break;
    }
  }
  // The first command must be absolute.
  return out.startsWith('m') ? `M${out.slice(1)}` : out;
}
