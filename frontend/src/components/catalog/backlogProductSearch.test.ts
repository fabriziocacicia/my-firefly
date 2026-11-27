import { describe, expect, it } from 'bun:test';
import { Product } from '../../types';
import { filterLinkModalProducts } from './backlogProductSearch';

function makeProduct(
  overrides: Partial<Product> & { id: number; name: string }
): Product {
  return {
    sale_mode: 'packaged',
    pack_count: 1,
    unit_size: 500,
    default_unit: 'g',
    package_size: 500,
    firefly_category_name: 'Groceries',
    tags: [{ id: 1, name: 'Pasta', group: 'food', color: '#000000' }],
    firefly_description: `${overrides.name} 500g`,
    ...overrides,
  };
}

const sampleCatalog: Product[] = [
  makeProduct({
    id: 1,
    name: 'Fusilli Integrali Bio',
    brand_id: 10,
    brand: { id: 10, name: 'Alce Nero', is_private_label: false },
    firefly_description: 'Fusilli Integrali Bio Alce Nero 500g',
  }),
  makeProduct({
    id: 2,
    name: 'Fusilli Integrali Bio',
    brand_id: 11,
    brand: { id: 11, name: 'Conad Verso Natura', is_private_label: true },
    firefly_description: 'Fusilli Integrali Bio Conad Verso Natura 500g',
  }),
  makeProduct({
    id: 3,
    name: 'Riso Basmati Integrale Bio',
    brand_id: 12,
    brand: { id: 12, name: 'Scotti', is_private_label: false },
    unit_size: 5,
    default_unit: 'kg',
    package_size: 5,
    firefly_category_name: 'Pantry',
    tags: [{ id: 2, name: 'Riso', group: 'food', color: '#111111' }],
    firefly_description: 'Riso Basmati Integrale Bio Scotti 5kg',
  }),
];

describe('filterLinkModalProducts', () => {
  it('returns all products when query is empty or whitespace', () => {
    expect(filterLinkModalProducts(sampleCatalog, '')).toHaveLength(3);
    expect(filterLinkModalProducts(sampleCatalog, '   ')).toHaveLength(3);
  });

  it('matches by product name case-insensitively', () => {
    const res = filterLinkModalProducts(sampleCatalog, '  RISO basmati ');
    expect(res.map(p => p.id)).toEqual([3]);
  });

  it('matches by brand name so items sharing the same name can be filtered', () => {
    const res = filterLinkModalProducts(sampleCatalog, 'alce nero');
    expect(res.map(p => p.id)).toEqual([1]);
  });

  it('matches multi-word queries spanning product name and brand name', () => {
    const res = filterLinkModalProducts(sampleCatalog, 'fusilli conad');
    expect(res.map(p => p.id)).toEqual([2]);
  });

  it('does not match against category, tags, or firefly description', () => {
    expect(filterLinkModalProducts(sampleCatalog, 'Groceries')).toEqual([]);
    expect(filterLinkModalProducts(sampleCatalog, 'Pantry')).toEqual([]);
    expect(filterLinkModalProducts(sampleCatalog, 'Pasta')).toEqual([]);
    expect(filterLinkModalProducts(sampleCatalog, '500g')).toEqual([]);
  });
});
