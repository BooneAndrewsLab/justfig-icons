/**
 * Colour slots (plan §3 "Color slots", the recolour feature). The distinct
 * fill and stroke colours of an icon are grouped into slot families:
 *
 * - near-neutral colours (OKLCH chroma < NEUTRAL_C) form one family,
 *   `outline` when it holds a dark colour, else `neutral`;
 * - chromatic colours are clustered by hue: neighbouring clusters merge
 *   while every member can still be drawn as "the family's base colour
 *   with its lightness shifted" (the app's `data-tone`) within TOLERANCE
 *   (OKLab ΔE) of its original colour.
 *
 * Every colour becomes base + tone, so the icon's default look is what the
 * app renders before anyone recolours it. An icon that needs more than
 * MAX_FAMILIES chromatic families is marked `recolor: 'whole'`: it keeps
 * its exact colours, and recolouring tints the whole icon at once.
 */
import { parseHex, rgbToOklch, shiftLightness } from './color.ts';

export interface SlotDef {
  readonly id: string;
  readonly label: string;
  readonly default: string;
}

export interface ColorUse {
  readonly hex: string;
  /** Prominence, e.g. painted area. */
  readonly weight: number;
}

export interface Assignment {
  readonly slot: string;
  /** OKLCH lightness offset from the slot's base (0 for 'whole'). */
  readonly tone: number;
  /** The colour as the app renders it by default (base shifted by tone). */
  readonly hex: string;
}

export interface SlotPlan {
  readonly recolor: 'slots' | 'whole';
  readonly slots: readonly SlotDef[];
  readonly map: ReadonlyMap<string, Assignment>;
  /** Largest colour error of the plan (OKLab ΔE), for the report. */
  readonly maxError: number;
}

export const NEUTRAL_C = 0.03;
export const TOLERANCE = 0.06;
export const MAX_FAMILIES = 4;
const LABELS = ['Primary', 'Secondary', 'Tertiary', 'Quaternary'];

interface Col {
  readonly hex: string;
  readonly weight: number;
  readonly l: number;
  readonly c: number;
  readonly h: number;
  readonly a: number;
  readonly b: number;
}

const colCache = new Map<string, Col>();
const shiftCache = new Map<string, string>();

function col(hex: string, weight: number): Col {
  if (weight === 0) {
    const hit = colCache.get(hex);
    if (hit) return hit;
  }
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`not a colour: ${hex}`);
  const o = rgbToOklch(rgb);
  const r = (o.h * Math.PI) / 180;
  const out = { hex, weight, l: o.l, c: o.c, h: o.h, a: o.c * Math.cos(r), b: o.c * Math.sin(r) };
  if (weight === 0) {
    if (colCache.size > 50_000) colCache.clear();
    colCache.set(hex, out);
  }
  return out;
}

function shifted(hex: string, tone: number): string {
  const k = `${hex}${String(tone)}`;
  let v = shiftCache.get(k);
  if (v === undefined) {
    v = shiftLightness(hex, tone);
    if (shiftCache.size > 200_000) shiftCache.clear();
    shiftCache.set(k, v);
  }
  return v;
}

function deltaE(x: Col, y: Col): number {
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Base = heaviest member; returns its quantised colours and largest error. */
function fit(members: readonly Col[]): {
  base: Col;
  error: number;
  out: Map<string, { tone: number; hex: string }>;
} {
  let base = members[0];
  for (const m of members) if (base === undefined || m.weight > base.weight) base = m;
  if (!base) throw new Error('empty family');
  let error = 0;
  const out = new Map<string, { tone: number; hex: string }>();
  for (const m of members) {
    const tone = round3(m.l - base.l);
    const hex = m === base ? base.hex : shifted(base.hex, tone);
    error = Math.max(error, deltaE(m, col(hex, 0)));
    out.set(m.hex, { tone, hex });
  }
  return { base, error, out };
}

const totalWeight = (cs: readonly Col[]): number => cs.reduce((s, c) => s + c.weight, 0);

export function planSlots(
  uses: readonly ColorUse[],
  opts: { tolerance?: number; maxFamilies?: number } = {},
): SlotPlan {
  const tolerance = opts.tolerance ?? TOLERANCE;
  const maxFamilies = opts.maxFamilies ?? MAX_FAMILIES;
  const weights = new Map<string, number>();
  for (const u of uses) weights.set(u.hex, (weights.get(u.hex) ?? 0) + Math.max(u.weight, 1e-6));
  const cols = [...weights.entries()].map(([hex, w]) => col(hex, w));
  if (cols.length === 0) return { recolor: 'slots', slots: [], map: new Map(), maxError: 0 };

  const neutral = cols.filter((c) => c.c < NEUTRAL_C);
  const chroma = cols.filter((c) => c.c >= NEUTRAL_C).sort((x, y) => x.h - y.h);

  // Agglomerative clustering of hue-adjacent clusters (the hue circle wraps).
  let clusters: Col[][] = chroma.map((c) => [c]);
  const pairErr = new Map<Col[], Map<Col[], number>>();
  const errOf = (x: Col[], y: Col[]): number => {
    let row = pairErr.get(x);
    if (!row) {
      row = new Map();
      pairErr.set(x, row);
    }
    let e = row.get(y);
    if (e === undefined) {
      e = fit([...x, ...y]).error;
      row.set(y, e);
    }
    return e;
  };
  for (;;) {
    if (clusters.length < 2) break;
    let best = -1;
    let bestErr = Infinity;
    const pairs = clusters.length === 2 ? 1 : clusters.length;
    for (let i = 0; i < pairs; i += 1) {
      const j = (i + 1) % clusters.length;
      const err = errOf(clusters[i] ?? [], clusters[j] ?? []);
      if (err < bestErr) {
        bestErr = err;
        best = i;
      }
    }
    if (best < 0 || bestErr > tolerance) break;
    const j = (best + 1) % clusters.length;
    const merged = [...(clusters[best] ?? []), ...(clusters[j] ?? [])];
    clusters = clusters.filter((_, k) => k !== best && k !== j);
    clusters.splice(Math.min(best, clusters.length), 0, merged);
  }

  if (clusters.length > maxFamilies) {
    const heaviest = [...cols].sort((x, y) => y.weight - x.weight)[0];
    const map = new Map<string, Assignment>();
    for (const c of cols) map.set(c.hex, { slot: 'all', tone: 0, hex: c.hex });
    return {
      recolor: 'whole',
      slots: [{ id: 'all', label: 'Colour', default: heaviest?.hex ?? '#000000' }],
      map,
      maxError: 0,
    };
  }

  clusters.sort((x, y) => totalWeight(y) - totalWeight(x));
  const families: { id: string; label: string; members: Col[] }[] = clusters.map((m, i) => ({
    id: `s${String(i + 1)}`,
    label: LABELS[i] ?? `Colour ${String(i + 1)}`,
    members: m,
  }));
  if (neutral.length > 0) {
    const dark = neutral.some((c) => c.l < 0.5);
    families.push({
      id: dark ? 'outline' : 'neutral',
      label: dark ? 'Outline' : 'Neutral',
      members: neutral,
    });
  }
  const only = families.length === 1 ? families[0] : undefined;
  if (only) {
    only.id = 's1';
    only.label = 'Colour';
  }

  const slots: SlotDef[] = [];
  const map = new Map<string, Assignment>();
  let maxError = 0;
  for (const f of families) {
    const r = fit(f.members);
    maxError = Math.max(maxError, r.error);
    slots.push({ id: f.id, label: f.label, default: r.base.hex });
    for (const [hex, a] of r.out) map.set(hex, { slot: f.id, tone: a.tone, hex: a.hex });
  }
  return { recolor: 'slots', slots, map, maxError };
}
