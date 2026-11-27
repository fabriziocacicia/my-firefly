export function getNormalizedUnitSuffix(unit: string): string {
  const clean = (unit || '').toLowerCase().trim();
  if (clean === 'g' || clean === 'kg') return '/ kg';
  if (clean === 'ml' || clean === 'l') return '/ L';
  return '/ pc';
}

export function computeNormalizedUnitPrice(
  price: number,
  quantity: number,
  unit: string,
  packageSize: number = 1
): number | null {
  const pkg = packageSize > 0 ? packageSize : 1;
  const totalUnits = quantity * pkg;
  if (!Number.isFinite(price) || !Number.isFinite(totalUnits) || price <= 0 || totalUnits <= 0) {
    return null;
  }

  const clean = (unit || 'pcs').toLowerCase().trim();
  if (clean === 'g' || clean === 'gr' || clean === 'gram' || clean === 'grams') {
    return Math.round((price / (totalUnits / 1000)) * 1000) / 1000;
  }
  if (clean === 'ml' || clean === 'milliliter') {
    return Math.round((price / (totalUnits / 1000)) * 1000) / 1000;
  }
  return Math.round((price / totalUnits) * 1000) / 1000;
}

export function computeQuantityFromUnitPrice(
  paidPrice: number,
  unitPrice: number,
  unit: string,
  packageSize: number = 1
): number | null {
  const pkg = packageSize > 0 ? packageSize : 1;
  if (
    !Number.isFinite(paidPrice) ||
    !Number.isFinite(unitPrice) ||
    paidPrice <= 0 ||
    unitPrice <= 0
  ) {
    return null;
  }

  const clean = (unit || 'pcs').toLowerCase().trim();
  let rawQty: number;
  if (clean === 'g' || clean === 'gr' || clean === 'gram' || clean === 'grams') {
    rawQty = ((paidPrice / unitPrice) * 1000) / pkg;
    return Math.max(1, Math.round(rawQty));
  }
  if (clean === 'ml' || clean === 'milliliter') {
    rawQty = ((paidPrice / unitPrice) * 1000) / pkg;
    return Math.max(1, Math.round(rawQty));
  }
  rawQty = paidPrice / unitPrice / pkg;
  return Math.round(rawQty * 1000) / 1000;
}

export function formatQuantityInput(quantity: number | null | undefined, unit: string): string {
  if (quantity === null || quantity === undefined || !Number.isFinite(quantity)) {
    return '';
  }
  const clean = (unit || '').toLowerCase().trim();
  if (clean === 'g' || clean === 'ml') {
    return String(Math.round(quantity * 100) / 100);
  }
  return String(Math.round(quantity * 1000) / 1000);
}
