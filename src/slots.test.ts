import { describe, expect, it } from 'vitest';

import { shiftLightness } from './color.ts';
import { TOLERANCE, planSlots } from './slots.ts';

describe('planSlots', () => {
  it('gives a single-colour icon one slot called Colour', () => {
    const p = planSlots([{ hex: '#333333', weight: 10 }]);
    expect(p.recolor).toBe('slots');
    expect(p.slots).toEqual([{ id: 's1', label: 'Colour', default: '#333333' }]);
  });

  it('groups shades of one hue into one family with tones', () => {
    const base = '#d55e00';
    const darker = shiftLightness(base, -0.1);
    const p = planSlots([
      { hex: base, weight: 10 },
      { hex: darker, weight: 2 },
      { hex: '#1f2933', weight: 1 },
    ]);
    expect(p.slots.map((s) => s.id)).toEqual(['s1', 'outline']);
    expect(p.map.get(darker)?.slot).toBe('s1');
    // Not exactly -0.1: the shifted colour was clamped into sRGB.
    expect(p.map.get(darker)?.tone).toBeCloseTo(-0.1, 1);
    expect(p.maxError).toBeLessThanOrEqual(TOLERANCE);
  });

  it('keeps distinct hues apart, heaviest first', () => {
    const p = planSlots([
      { hex: '#0072b2', weight: 5 },
      { hex: '#e69f00', weight: 20 },
      { hex: '#009e73', weight: 1 },
    ]);
    expect(p.slots.map((s) => s.default)).toEqual(['#e69f00', '#0072b2', '#009e73']);
    expect(p.slots.map((s) => s.label)).toEqual(['Primary', 'Secondary', 'Tertiary']);
  });

  it('calls a family of light neutrals Neutral, not Outline', () => {
    const p = planSlots([
      { hex: '#ffffff', weight: 1 },
      { hex: '#e69f00', weight: 5 },
    ]);
    expect(p.slots.map((s) => s.id)).toEqual(['s1', 'neutral']);
  });

  it('falls back to whole-icon recolouring past four families', () => {
    const hues = ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#cc79a7', '#7f3c8d'];
    const p = planSlots(hues.map((hex, i) => ({ hex, weight: i + 1 })));
    expect(p.recolor).toBe('whole');
    expect(p.slots).toEqual([{ id: 'all', label: 'Colour', default: '#7f3c8d' }]);
    for (const h of hues) expect(p.map.get(h)).toEqual({ slot: 'all', tone: 0, hex: h });
  });

  it('reproduces every colour within the tolerance (default look = app render)', () => {
    const colours = ['#f5765d', '#f44d32', '#e12a19', '#f9bba6', '#fefefe', '#333333'];
    const p = planSlots(colours.map((hex, i) => ({ hex, weight: 6 - i })));
    expect(p.recolor).toBe('slots');
    expect(p.maxError).toBeLessThanOrEqual(TOLERANCE);
    for (const c of colours) {
      const a = p.map.get(c)!;
      const def = p.slots.find((s) => s.id === a.slot)!;
      expect(a.hex).toBe(a.tone === 0 ? def.default : shiftLightness(def.default, a.tone));
    }
  });
});
