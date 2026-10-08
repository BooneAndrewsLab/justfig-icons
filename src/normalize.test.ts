import { describe, expect, it } from 'vitest';

import { normalizeSvg } from './normalize.ts';
import { parsePath, pathBox } from './path.ts';
import { checkSvg } from './validate.ts';

const svg = (body: string, attrs = 'viewBox="0 0 200 100"'): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

function ok(text: string, opts = {}) {
  const r = normalizeSvg(text, opts);
  if (!r.ok) throw new Error(r.reason);
  expect(checkSvg(r.svg, r), r.svg).toEqual([]);
  return r;
}

function paths(out: string): string[] {
  return [...out.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]!);
}

describe('normalizeSvg', () => {
  it('crops to the geometry plus 2% and scales the longer side to 100', () => {
    const r = ok(svg('<rect x="50" y="25" width="100" height="50" fill="#e69f00"/>'));
    expect([r.width, r.height]).toEqual([100, 51.92]);
    const b = pathBox(parsePath(paths(r.svg)[0]!));
    expect(b.x0).toBeCloseTo(1.92, 1);
    expect(b.x1).toBeCloseTo(98.08, 1);
  });

  it('flattens transforms and <use>, and drops editor metadata', () => {
    const r = ok(
      svg(
        `<metadata><rdf:RDF/></metadata><sodipodi:namedview/>
         <defs><path id="p" d="M0 0h10v10H0z"/></defs>
         <g transform="translate(100 0) scale(2)"><use href="#p" x="5" fill="#0072b2"/></g>
         <path d="M0 0h10v10H0z" transform="matrix(1 0 0 -1 0 50)" fill="#0072b2"/>`,
      ),
    );
    expect(r.svg).not.toMatch(/transform|use|metadata|namedview/);
    expect(paths(r.svg)).toHaveLength(2);
  });

  it('resolves <style> and style= into attributes and pushes inherited paint down', () => {
    const r = ok(
      svg(
        `<style>.a{fill:#009e73} #b{stroke:#1f2933}</style>
         <g fill="#e69f00" stroke-width="4"><circle cx="20" cy="20" r="10"/>
         <rect class="a" x="40" y="10" width="20" height="20"/>
         <rect id="b" x="70" y="10" width="20" height="20" style="fill:none"/></g>`,
      ),
    );
    expect(r.svg).not.toMatch(/style|class|id=/);
    expect(r.svg).toContain('fill="#e69f00"');
    expect(r.svg).toContain('fill="#009e73"');
    expect(r.svg).toMatch(/fill="none" stroke="#1f2933" stroke-width="[\d.]+"/);
  });

  it('splits an element whose fill and stroke are in different slots', () => {
    const r = ok(
      svg('<circle cx="50" cy="50" r="40" fill="#e69f00" stroke="#1f2933" stroke-width="3"/>'),
    );
    expect(r.slots.map((s) => s.id)).toEqual(['s1', 'outline']);
    const els = r.svg.match(/<path [^>]+>/g)!;
    expect(els).toHaveLength(2);
    expect(els[0]).toContain('data-slot="s1"');
    expect(els[0]).not.toContain('stroke=');
    expect(els[1]).toContain('fill="none"');
    expect(els[1]).toContain('data-slot="outline"');
  });

  it('writes the app-rendered colour (base + tone) into the SVG', () => {
    const r = ok(
      svg(
        '<rect width="100" height="100" fill="#d55e00"/><rect x="100" width="50" height="50" fill="#b84a00"/>',
      ),
    );
    expect(r.slots).toHaveLength(1);
    expect(r.svg).toMatch(/data-slot="s1" data-tone="-0\.\d+"/);
  });

  it('maps currentColor to the given colour', () => {
    const r = ok(svg('<path d="M0 0h10v10z" fill="currentColor"/>'), { currentColor: '#333333' });
    expect(r.svg).toContain('fill="#333333"');
  });

  it('averages gradients and logs it', () => {
    const r = ok(
      svg(
        `<defs><linearGradient id="g"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>
         <rect width="10" height="10" fill="url(#g)"/>`,
      ),
    );
    expect(r.svg).toContain('fill="#808080"');
    expect(r.warnings).toContain('gradient replaced by its average colour');
  });

  it('drops a rectangular clip that contains its content', () => {
    const r = ok(
      svg(
        `<defs><clipPath id="c"><path d="M0 0H200V100H0Z"/></clipPath></defs>
         <g clip-path="url(#c)"><circle cx="50" cy="50" r="20" fill="#e69f00"/></g>`,
      ),
    );
    expect(paths(r.svg)).toHaveLength(1);
  });

  it.each([
    ['<image href="x.png" width="10" height="10"/>', 'embedded raster image'],
    ['<text x="0" y="10">DNA</text>', 'text'],
    ['<foreignObject><div/></foreignObject>', 'foreignObject'],
    ['<rect width="10" height="10" filter="url(#f)"/>', 'filter'],
    ['<rect width="10" height="10" mask="url(#m)"/>', 'mask'],
    [
      '<defs><clipPath id="c"><circle cx="5" cy="5" r="3"/></clipPath></defs><rect width="10" height="10" clip-path="url(#c)"/>',
      'clip path',
    ],
    ['<path d="M0 0L10 10" stroke="#000" marker-end="url(#a)"/>', 'markers'],
    ['<rect width="0" height="0"/>', 'nothing is drawn'],
  ])('rejects %s', (body, reason) => {
    const r = normalizeSvg(svg(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(reason);
  });

  it('keeps hand-written slots of house icons and bakes their tones', () => {
    const r = ok(
      svg(
        '<g data-part="body"><rect width="10" height="10" fill="#56b4e9" data-slot="s1" data-tone="-0.1"/></g>',
        'viewBox="0 0 100 100"',
      ),
      { slots: [{ id: 's1', label: 'Liquid', default: '#56b4e9' }] },
    );
    expect(r.svg).toContain('data-part="body"');
    expect(r.svg).toMatch(/fill="#(?!56b4e9)[0-9a-f]{6}" data-slot="s1" data-tone="-0.1"/);
  });

  it('rejects a house icon with an unslotted element', () => {
    const r = normalizeSvg(svg('<rect width="10" height="10"/>'), {
      slots: [{ id: 's1', label: 'A', default: '#000000' }],
    });
    expect(r.ok).toBe(false);
  });

  it('enforces the node limit', () => {
    const body = Array.from(
      { length: 30 },
      (_, i) => `<rect x="${String(i)}" width="1" height="1"/>`,
    ).join('');
    const r = normalizeSvg(svg(body), { maxNodes: 10 });
    expect(r.ok).toBe(false);
  });
});
