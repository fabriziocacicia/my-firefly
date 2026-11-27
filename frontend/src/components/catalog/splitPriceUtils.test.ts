import { describe, expect, it } from 'bun:test';
import {
  computeNormalizedUnitPrice,
  computeQuantityFromUnitPrice,
  formatQuantityInput,
  getNormalizedUnitSuffix,
} from './splitPriceUtils';

describe('splitPriceUtils', () => {
  it('computes normalized unit price across g, kg, ml, l, and pcs', () => {
    expect(computeNormalizedUnitPrice(2.4, 800, 'g', 1)).toBe(3);
    expect(computeNormalizedUnitPrice(2.4, 0.8, 'kg', 1)).toBe(3);
    expect(computeNormalizedUnitPrice(50, 28.59, 'l', 1)).toBe(1.749);
    expect(computeNormalizedUnitPrice(1.5, 500, 'ml', 1)).toBe(3);
    expect(computeNormalizedUnitPrice(4.0, 2, 'g', 500)).toBe(4);
    expect(computeNormalizedUnitPrice(3.0, 2, 'pcs', 1)).toBe(1.5);
    expect(computeNormalizedUnitPrice(2.4, 0, 'g', 1)).toBeNull();
  });

  it('computes quantity from target unit price across units and package sizes', () => {
    expect(computeQuantityFromUnitPrice(2.4, 3.0, 'g', 1)).toBe(800);
    expect(computeQuantityFromUnitPrice(2.4, 3.0, 'kg', 1)).toBe(0.8);
    expect(computeQuantityFromUnitPrice(50.0, 1.749, 'l', 1)).toBe(28.588);
    expect(computeQuantityFromUnitPrice(1.5, 3.0, 'ml', 1)).toBe(500);
    expect(computeQuantityFromUnitPrice(4.0, 4.0, 'g', 500)).toBe(2);
    expect(computeQuantityFromUnitPrice(50.0, 0, 'l', 1)).toBeNull();
  });

  it('formats unit suffixes and quantity inputs cleanly', () => {
    expect(getNormalizedUnitSuffix('g')).toBe('/ kg');
    expect(getNormalizedUnitSuffix('kg')).toBe('/ kg');
    expect(getNormalizedUnitSuffix('ml')).toBe('/ L');
    expect(getNormalizedUnitSuffix('l')).toBe('/ L');
    expect(getNormalizedUnitSuffix('pcs')).toBe('/ pc');
    expect(formatQuantityInput(800, 'g')).toBe('800');
    expect(formatQuantityInput(28.59, 'l')).toBe('28.59');
  });
});
