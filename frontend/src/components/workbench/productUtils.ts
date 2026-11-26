import { Product, SaleMode, Tag, TagImplication } from '../../types';

export type PriceInputMode = 'unit' | 'total';

export function formatPackagingLabel(
  saleMode: SaleMode | undefined,
  packCount: number | undefined,
  unitSize: number | undefined,
  packageSize: number,
  defaultUnit: string
): string {
  if (saleMode === 'loose_weight') {
    return `loose (${defaultUnit})`;
  }
  const count = packCount && packCount > 1 ? packCount : 1;
  const size = unitSize && unitSize > 0 ? unitSize : packageSize;
  if (count > 1) {
    return `${count}×${size} ${defaultUnit}`;
  }
  return `${size} ${defaultUnit}`;
}

export function formatProductBadge(product: Product): string {
  return formatPackagingLabel(
    product.sale_mode,
    product.pack_count,
    product.unit_size,
    product.package_size,
    product.default_unit
  );
}

function formatCleanNumber(val: number): string {
  if (Math.abs(val - Math.round(val)) < 1e-6) {
    return String(Math.round(val));
  }
  return Number(val.toFixed(4)).toString();
}

export function formatFireflyDescriptionPreview(params: {
  name: string;
  brandName?: string | null;
  saleMode: SaleMode;
  packCount: number;
  unitSize: number;
  defaultUnit: string;
}): string {
  const parts: string[] = [];
  const cleanName = params.name.trim();
  if (cleanName) parts.push(cleanName);
  const cleanBrand = params.brandName?.trim();
  if (cleanBrand) parts.push(cleanBrand);

  if (params.saleMode !== 'loose_weight') {
    const unit = (params.defaultUnit || 'pcs').trim();
    const count = Math.max(1, Math.round(params.packCount || 1));
    const size = params.unitSize > 0 ? params.unitSize : 1;
    if (unit === 'pcs') {
      parts.push(`x${formatCleanNumber(count * size)}`);
    } else {
      const token = `${formatCleanNumber(size)}${unit}`;
      parts.push(count > 1 ? `${count}x${token}` : token);
    }
  }
  return parts.join(' ');
}

export function computePriceFromInput(
  priceMode: PriceInputMode,
  rawPrice: string,
  qty: number
): { paidPrice: number; totalPrice?: number; lineTotal: number } | null {
  const parsed = parseFloat(rawPrice);
  if (isNaN(parsed) || parsed < 0 || qty <= 0) return null;
  if (priceMode === 'total') {
    const unitPrice = Math.round((parsed / qty) * 10000) / 10000;
    return {
      paidPrice: unitPrice,
      totalPrice: Math.round(parsed * 100) / 100,
      lineTotal: Math.round(parsed * 100) / 100,
    };
  }
  return {
    paidPrice: parsed,
    totalPrice: undefined,
    lineTotal: Math.round(qty * parsed * 100) / 100,
  };
}

export function expandTagIdsLocal(
  directTagIds: number[],
  implications: TagImplication[]
): Set<number> {
  const map = new Map<number, number[]>();
  for (const imp of implications) {
    const list = map.get(imp.child_tag_id) || [];
    list.push(imp.parent_tag_id);
    map.set(imp.child_tag_id, list);
  }
  const expanded = new Set<number>();
  const stack = [...directTagIds];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (expanded.has(curr)) continue;
    expanded.add(curr);
    const parents = map.get(curr) || [];
    for (const p of parents) stack.push(p);
  }
  return expanded;
}

export function getEffectiveTagsForIds(
  directTagIds: number[],
  allTags: Tag[],
  implications: TagImplication[]
): { direct: Tag[]; implied: Tag[] } {
  const expandedIds = expandTagIdsLocal(directTagIds, implications);
  const directSet = new Set(directTagIds);
  const byId = new Map(allTags.map(t => [t.id, t]));
  const direct = directTagIds.map(id => byId.get(id)).filter((t): t is Tag => Boolean(t));
  const implied: Tag[] = [];
  for (const id of expandedIds) {
    if (!directSet.has(id)) {
      const t = byId.get(id);
      if (t) implied.push(t);
    }
  }
  implied.sort((a, b) => a.name.localeCompare(b.name));
  return { direct, implied };
}
