import { Banknote, Gift, Landmark, LucideIcon, Ticket, Wallet } from 'lucide-react';
import { AssetAccountType, FireflyAssetAccount } from '../../types';

export type CategorizedAssetAccountType = Exclude<AssetAccountType, 'standard'>;

export interface AssetTypeMeta {
  label: string;
  filterLabel: string;
  subtitle: string;
  icon: LucideIcon;
  badgeClass: string;
  iconWrapperClass: string;
  cardBorderClass: string;
  summaryRingClass: string;
  filterActiveClass: string;
  modalActiveClass: string;
  modalIconClass: string;
}

export const CATEGORIZED_ASSET_TYPES: CategorizedAssetAccountType[] = [
  'bank_account',
  'cash',
  'gift_card',
  'meal_voucher',
];

export const ASSET_TYPE_ORDER: AssetAccountType[] = [
  'standard',
  'bank_account',
  'cash',
  'gift_card',
  'meal_voucher',
];

export const ASSET_TYPE_META: Record<AssetAccountType, AssetTypeMeta> = {
  bank_account: {
    label: 'Bank Account',
    filterLabel: 'Bank',
    subtitle: 'Checking or savings',
    icon: Landmark,
    badgeClass: 'bg-sky-100 text-sky-800',
    iconWrapperClass: 'bg-sky-50 text-sky-600',
    cardBorderClass: 'border-sky-200/80 hover:border-sky-300',
    summaryRingClass: 'border-sky-500 bg-sky-50/40 ring-1 ring-sky-500/25',
    filterActiveClass: 'bg-white text-sky-800 shadow-xs',
    modalActiveClass: 'border-sky-600 bg-sky-50/40 text-sky-950 ring-2 ring-sky-500/20',
    modalIconClass: 'text-sky-600',
  },
  cash: {
    label: 'Cash',
    filterLabel: 'Cash',
    subtitle: 'Physical wallet or cash',
    icon: Banknote,
    badgeClass: 'bg-emerald-100 text-emerald-800',
    iconWrapperClass: 'bg-emerald-50 text-emerald-600',
    cardBorderClass: 'border-emerald-200/80 hover:border-emerald-300',
    summaryRingClass: 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500/25',
    filterActiveClass: 'bg-white text-emerald-800 shadow-xs',
    modalActiveClass: 'border-emerald-600 bg-emerald-50/40 text-emerald-950 ring-2 ring-emerald-500/20',
    modalIconClass: 'text-emerald-600',
  },
  gift_card: {
    label: 'Gift Card',
    filterLabel: 'Gift Card',
    subtitle: 'Store credit or voucher',
    icon: Gift,
    badgeClass: 'bg-violet-100 text-violet-800',
    iconWrapperClass: 'bg-violet-50 text-violet-600',
    cardBorderClass: 'border-violet-200/80 hover:border-violet-300',
    summaryRingClass: 'border-violet-500 bg-violet-50/40 ring-1 ring-violet-500/25',
    filterActiveClass: 'bg-white text-violet-800 shadow-xs',
    modalActiveClass: 'border-violet-600 bg-violet-50/40 text-violet-950 ring-2 ring-violet-500/20',
    modalIconClass: 'text-violet-600',
  },
  meal_voucher: {
    label: 'Meal Voucher',
    filterLabel: 'Meal Vouchers',
    subtitle: 'Whole-unit vouchers',
    icon: Ticket,
    badgeClass: 'bg-amber-100 text-amber-800',
    iconWrapperClass: 'bg-amber-50 text-amber-600',
    cardBorderClass: 'border-amber-200/80 hover:border-amber-300',
    summaryRingClass: 'border-amber-500 bg-amber-50/40 ring-1 ring-amber-500/25',
    filterActiveClass: 'bg-white text-amber-800 shadow-xs',
    modalActiveClass: 'border-amber-600 bg-amber-50/50 text-amber-950 ring-2 ring-amber-500/20',
    modalIconClass: 'text-amber-600',
  },
  standard: {
    label: 'Standard',
    filterLabel: 'Standard',
    subtitle: 'Default / unclassified asset',
    icon: Wallet,
    badgeClass: 'bg-slate-100 text-slate-600',
    iconWrapperClass: 'bg-slate-100 text-slate-600',
    cardBorderClass: 'border-slate-200 hover:border-slate-300',
    summaryRingClass: 'border-slate-500 bg-slate-50 ring-1 ring-slate-400/25',
    filterActiveClass: 'bg-white text-slate-800 shadow-xs',
    modalActiveClass: 'border-indigo-600 bg-indigo-50/40 text-indigo-900 ring-2 ring-indigo-500/20',
    modalIconClass: 'text-indigo-600',
  },
};

export interface CurrencyTotal {
  currency: string;
  cents: number;
}

export interface CategorizedTypeBalance {
  type: CategorizedAssetAccountType;
  activeCount: number;
  totals: CurrencyTotal[];
}

export interface AssetBalanceSummary {
  totalActiveCount: number;
  grandTotals: CurrencyTotal[];
  categorized: CategorizedTypeBalance[];
}

function toCents(val: string | number | null | undefined): number {
  if (val === null || val === undefined) return 0;
  const raw = typeof val === 'number' ? (Number.isFinite(val) ? String(val) : '') : String(val).trim();
  if (!raw) return 0;

  const match = /^([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))$/.exec(raw);
  if (!match) {
    const num = Number(raw);
    return Number.isFinite(num) ? Math.round(num * 100) : 0;
  }

  const sign = match[1] === '-' ? -1 : 1;
  const intPart = match[2] || '0';
  const fracPart = match[3] ?? match[4] ?? '';
  const padded = (fracPart + '000').slice(0, 3);
  const baseCents = Number(intPart) * 100 + Number(padded.slice(0, 2));
  const roundUp = Number(padded[2]) >= 5 ? 1 : 0;
  const total = sign * (baseCents + roundUp);
  return Object.is(total, -0) ? 0 : total;
}

function normalizeCurrency(currency?: string | null): string {
  const trimmed = (currency || '').trim().toUpperCase();
  return trimmed || 'EUR';
}

export function normalizeAssetType(assetType?: string | null): AssetAccountType {
  if (assetType && assetType in ASSET_TYPE_META) {
    return assetType as AssetAccountType;
  }
  return 'standard';
}

function sortCurrencyTotals(map: Map<string, number>): CurrencyTotal[] {
  if (map.size === 0) {
    return [{ currency: 'EUR', cents: 0 }];
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === 'EUR' && b !== 'EUR') return -1;
      if (b === 'EUR' && a !== 'EUR') return 1;
      return a.localeCompare(b);
    })
    .map(([currency, cents]) => ({ currency, cents }));
}

export function formatCents(cents: number, currency?: string | null): string {
  const sign = cents < 0 ? '-' : '';
  const absAmount = (Math.abs(cents) / 100).toFixed(2);
  const code = normalizeCurrency(currency);
  const symbol = code === 'EUR' ? '€' : `${code} `;
  return `${sign}${symbol}${absAmount}`;
}

export function formatAssetMoney(
  val: string | number | null | undefined,
  currency?: string | null
): string {
  return formatCents(toCents(val), currency);
}

/**
 * Computes active-only asset balance totals in integer cents, grouped per currency.
 * - `grandTotals` and `totalActiveCount` include only active accounts flagged
 *   `include_net_worth !== false` on Firefly III (across all types, including `standard`).
 * - `categorized` covers strictly the 4 categorized types (`bank_account`, `cash`,
 *   `gift_card`, `meal_voucher`), summing all active accounts of each type regardless
 *   of `include_net_worth` and preserving zero-count entries at `€0.00`.
 */
export function computeAssetBalanceSummary(
  accounts: FireflyAssetAccount[]
): AssetBalanceSummary {
  const grandMap = new Map<string, number>();
  const typeMaps = new Map<CategorizedAssetAccountType, Map<string, number>>();
  const typeCounts = new Map<CategorizedAssetAccountType, number>();

  for (const t of CATEGORIZED_ASSET_TYPES) {
    typeMaps.set(t, new Map<string, number>());
    typeCounts.set(t, 0);
  }

  let totalActiveCount = 0;

  for (const acc of accounts) {
    if (acc.active === false) continue;

    const currency = normalizeCurrency(acc.currency_code);
    const cents = toCents(acc.current_balance);
    const normalizedType = normalizeAssetType(acc.asset_type);

    if (acc.include_net_worth !== false) {
      totalActiveCount += 1;
      grandMap.set(currency, (grandMap.get(currency) ?? 0) + cents);
    }

    if (normalizedType !== 'standard') {
      const tMap = typeMaps.get(normalizedType);
      if (tMap) {
        tMap.set(currency, (tMap.get(currency) ?? 0) + cents);
        typeCounts.set(normalizedType, (typeCounts.get(normalizedType) ?? 0) + 1);
      }
    }
  }

  return {
    totalActiveCount,
    grandTotals: sortCurrencyTotals(grandMap),
    categorized: CATEGORIZED_ASSET_TYPES.map((type) => ({
      type,
      activeCount: typeCounts.get(type) ?? 0,
      totals: sortCurrencyTotals(typeMaps.get(type)!),
    })),
  };
}
