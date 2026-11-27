import { Product } from '../../types';

/**
 * Filters canonical catalog products for the Link Firefly Entry modal.
 * Matches multi-word queries strictly against product name and brand name.
 */
export function filterLinkModalProducts(
  products: Product[],
  query: string
): Product[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return products;

  return products.filter(product => {
    const nameLower = product.name.toLowerCase();
    const brandLower = product.brand?.name.toLowerCase() ?? '';
    return tokens.every(
      token => nameLower.includes(token) || brandLower.includes(token)
    );
  });
}
