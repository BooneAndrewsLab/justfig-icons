/**
 * Thumbnails (plan §3): every icon rendered with resvg into sprite sheets
 * per category, THUMB_PER_SHEET icons each, at 96 px cells and 2× (192 px),
 * encoded as WebP with sharp. Icons are centred in their cell with a small
 * margin, on transparency. A sheet is always THUMB_COLUMNS cells wide.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

import { THUMB_COLUMNS, THUMB_PER_SHEET, THUMB_SIZE } from './format.ts';

export interface ThumbIcon {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
}

const MARGIN = 0.08;

async function renderCell(icon: ThumbIcon, cell: number): Promise<Buffer> {
  const inner = Math.round(cell * (1 - 2 * MARGIN));
  const wide = icon.width >= icon.height;
  const r = new Resvg(icon.svg, {
    fitTo: { mode: wide ? 'width' : 'height', value: inner },
    background: 'rgba(0,0,0,0)',
    font: { loadSystemFonts: false },
  });
  const png = r.render().asPng();
  return sharp(png)
    .resize(cell, cell, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** Writes `<prefix>-<n>.webp` and `<prefix>-<n>@2x.webp`; returns the sheet names (no ext). */
export async function writeSprites(
  dir: string,
  prefix: string,
  icons: readonly ThumbIcon[],
): Promise<string[]> {
  const sheets: string[] = [];
  for (let s = 0; s * THUMB_PER_SHEET < icons.length; s += 1) {
    const batch = icons.slice(s * THUMB_PER_SHEET, (s + 1) * THUMB_PER_SHEET);
    const name = `${prefix}-${String(s)}`;
    for (const scale of [1, 2]) {
      const cell = THUMB_SIZE * scale;
      const rows = Math.ceil(batch.length / THUMB_COLUMNS);
      // Always the full width, so the app can size any sheet from the manifest alone.
      const cols = THUMB_COLUMNS;
      const tiles = await Promise.all(batch.map((icon) => renderCell(icon, cell)));
      const img = await sharp({
        create: {
          width: cols * cell,
          height: rows * cell,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(
          tiles.map((input, i) => ({
            input,
            left: (i % THUMB_COLUMNS) * cell,
            top: Math.floor(i / THUMB_COLUMNS) * cell,
          })),
        )
        .webp({ quality: 82, alphaQuality: 90, effort: 5 })
        .toBuffer();
      writeFileSync(join(dir, `${name}${scale === 2 ? '@2x' : ''}.webp`), img);
    }
    sheets.push(name);
  }
  return sheets;
}
