/*
 * Copied from the JustFig app (src/core/color/color.ts) at its Phase 1 state; keep the two in
 * step by hand when either changes (the plan allows a copy or a workspace
 * package; a copy keeps this repo buildable on its own).
 */
/**
 * Colour utilities: hex ↔ sRGB ↔ OKLab/OKLCH (Björn Ottosson's matrices),
 * used for icon slot tones (a lightness offset from the slot's base) and
 * palette work.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

export function parseHex(hex: string): Rgb | null {
  let s = hex.trim().toLowerCase();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3) s = s.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16) / 255,
    g: parseInt(s.slice(2, 4), 16) / 255,
    b: parseInt(s.slice(4, 6), 16) / 255,
  };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function toHex(c: Rgb): string {
  const h = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number): number =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;

export function rgbToOklch(c: Rgb): Oklch {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c: C, h: H };
}

export function oklchToRgb(o: Oklch): Rgb {
  const hr = (o.h * Math.PI) / 180;
  const A = o.c * Math.cos(hr);
  const B = o.c * Math.sin(hr);
  const l = (o.l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (o.l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (o.l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/** The colour with its OKLCH lightness moved by `dl` (e.g. -0.12 = a shade darker). */
export function shiftLightness(hex: string, dl: number): string {
  const rgb = parseHex(hex);
  if (!rgb || dl === 0) return hex;
  const o = rgbToOklch(rgb);
  return toHex(oklchToRgb({ ...o, l: Math.min(1, Math.max(0, o.l + dl)) }));
}

/** Okabe-Ito, colourblind-safe: the default swatches offered in the colour picker. */
export const OKABE_ITO: readonly string[] = [
  '#000000',
  '#e69f00',
  '#56b4e9',
  '#009e73',
  '#f0e442',
  '#0072b2',
  '#d55e00',
  '#cc79a7',
];
