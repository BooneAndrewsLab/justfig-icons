import { describe, expect, it } from 'vitest';

import {
  PathError,
  multiply,
  parsePath,
  parseTransform,
  pathBox,
  polygonOf,
  rectOf,
  serializePath,
  shapeToPath,
  transformPath,
} from './path.ts';

const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

describe('parsePath', () => {
  it('makes every command absolute and reduces to M/L/C/Q/Z', () => {
    const s = parsePath('m10 10 h5 v5 l-5 0 z M0 0 s 1 1 2 0 t 2 0');
    expect(s.map((x) => x.c).join('')).toBe('MLLLZMCQ');
    expect(s[1]).toEqual({ c: 'L', x: 15, y: 10 });
    expect(s[2]).toEqual({ c: 'L', x: 15, y: 15 });
  });

  it('treats extra moveto pairs as lineto', () => {
    expect(parsePath('M0 0 10 0 10 10').map((x) => x.c)).toEqual(['M', 'L', 'L']);
  });

  it('reads compact numbers and arc flags', () => {
    const s = parsePath('M0 0a5 5 0 1010 0');
    expect(s.every((x) => x.c === 'M' || x.c === 'C')).toBe(true);
    const last = s[s.length - 1]!;
    expect(last.c === 'C' && close(last.x, 10) && close(last.y, 0)).toBe(true);
    expect(parsePath('M.5.5L-1-1').slice(1)).toEqual([{ c: 'L', x: -1, y: -1 }]);
  });

  it('turns a half-circle arc into Béziers with the right extent', () => {
    const b = pathBox(parsePath('M0 0 A 5 5 0 0 1 10 0'));
    expect(close(b.x0, 0) && close(b.x1, 10)).toBe(true);
    expect(close(Math.min(b.y0, b.y1), -5, 1e-3)).toBe(true);
  });

  it('rejects malformed data', () => {
    expect(() => parsePath('L0 0')).toThrow(PathError);
    expect(() => parsePath('M0 0 X')).toThrow(PathError);
    expect(() => parsePath('M0')).toThrow(PathError);
  });
});

describe('transforms', () => {
  it('parses a transform list in order', () => {
    const m = parseTransform('translate(10 0) scale(2)');
    expect(m).toEqual([2, 0, 0, 2, 10, 0]);
    const r = parseTransform('rotate(90 5 5)');
    const [x, y] = [r[0] * 10 + r[2] * 5 + r[4], r[1] * 10 + r[3] * 5 + r[5]];
    expect(close(x, 5) && close(y, 10)).toBe(true);
  });

  it('flattens a matrix into the path data', () => {
    const s = transformPath(
      parsePath('M0 0L10 0'),
      multiply([1, 0, 0, -1, 0, 100], [2, 0, 0, 2, 0, 0]),
    );
    expect(s).toEqual([
      { c: 'M', x: 0, y: 100 },
      { c: 'L', x: 20, y: 100 },
    ]);
  });
});

describe('shapes', () => {
  it('converts every basic shape', () => {
    expect(pathBox(shapeToPath('rect', { x: 1, y: 2, width: 3, height: 4, rx: 1 })!)).toEqual({
      x0: 1,
      y0: 2,
      x1: 4,
      y1: 6,
    });
    const c = pathBox(shapeToPath('circle', { cx: 5, cy: 5, r: 5 })!);
    expect(close(c.x0, 0) && close(c.y1, 10)).toBe(true);
    expect(shapeToPath('polygon', { points: '0,0 10,0 10,10' })!.map((s) => s.c)).toEqual([
      'M',
      'L',
      'L',
      'Z',
    ]);
    expect(shapeToPath('rect', { width: 0, height: 5 })).toBeNull();
  });

  it('recognises axis-aligned rectangles (clip paths)', () => {
    const r = rectOf(polygonOf(parsePath('M2 7h214v208H2z'))!);
    expect(r).toEqual({ x0: 2, y0: 7, x1: 216, y1: 215 });
    expect(rectOf(polygonOf(parsePath('M0 0L10 0L10 10Z'))!)).toBeNull();
    expect(polygonOf(parsePath('M0 0C1 1 2 2 3 3Z'))).toBeNull();
  });
});

describe('serializePath', () => {
  it('round-trips within the precision', () => {
    const src = parsePath('M10.123 20.456C30 40 50 60 70.001 80Q90 100 110 120L5 5Z');
    const back = parsePath(serializePath(src, 2));
    expect(back.length).toBe(src.length);
    const a = pathBox(src);
    const b = pathBox(back);
    expect(Math.abs(a.x0 - b.x0) < 0.006 && Math.abs(a.y1 - b.y1) < 0.006).toBe(true);
  });

  it('is compact', () => {
    expect(serializePath(parsePath('M0 0L10 0L10 10L0 10Z'))).toBe('M0 0h10v10h-10z');
  });
});
