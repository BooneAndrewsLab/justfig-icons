import { describe, expect, it } from 'vitest';
import { BRAND_TITLES } from './validate.ts';

describe('BRAND_TITLES', () => {
  it('flags product brands in titles, not generic equipment', () => {
    for (const t of ['Falcon 15', 'Illumina miseq', 'Tecan plate reader', 'Agilent HPLC'])
      expect(BRAND_TITLES.test(t)).toBe(true);
    for (const t of ['Conical tube 15 ml', 'Benchtop sequencer', 'Plate reader', 'HPLC system'])
      expect(BRAND_TITLES.test(t)).toBe(false);
  });
});
