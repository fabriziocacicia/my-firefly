import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Plus,
  Search,
  Settings2,
  Wallet,
  X,
} from 'lucide-react';
import { AssetAccountType, FireflyAssetAccount } from '../../types';
import { AssetBalanceSummary } from './AssetBalanceSummary';
import {
  ASSET_TYPE_META,
  computeAssetBalanceSummary,
  formatAssetMoney,
  normalizeAssetType,
} from './assetTypeUtils';

interface AssetAccountsTabProps {
  assetAccounts: FireflyAssetAccount[];
  loading: boolean;
  onConfigure: (account: FireflyAssetAccount) => void;
  onRecharge: (account: FireflyAssetAccount) => void;
}

const FILTER_TYPE_ORDER: AssetAccountType[] = [
  'bank_account',
  'cash',
  'digital_credit',
  'investment_account',
  'meal_voucher',
  'standard',
];

export const AssetAccountsTab: React.FC<AssetAccountsTabProps> = ({
  assetAccounts,
  loading,
  onConfigure,
  onRecharge,
}) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | AssetAccountType>('all');

  const counts = useMemo(() => {
    const byType: Record<AssetAccountType, number> = {
      standard: 0,
      bank_account: 0,
      cash: 0,
      digital_credit: 0,
      investment_account: 0,
      meal_voucher: 0,
    };
    let mismatches = 0;
    for (const acc of assetAccounts) {
      const typeKey = normalizeAssetType(acc.asset_type);
      byType[typeKey] += 1;
      if (typeKey === 'meal_voucher' && !acc.is_exact_multiple) {
        mismatches += 1;
      }
    }
    return { all: assetAccounts.length, byType, mismatches };
  }, [assetAccounts]);

  const balanceSummary = useMemo(
    () => computeAssetBalanceSummary(assetAccounts),
    [assetAccounts]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assetAccounts.filter((acc) => {
      if (filter !== 'all' && normalizeAssetType(acc.asset_type) !== filter) return false;
      if (!q) return true;
      return (
        acc.name.toLowerCase().includes(q) ||
        String(acc.id).includes(q) ||
        (acc.default_revenue_account_name || '').toLowerCase().includes(q)
      );
    });
  }, [assetAccounts, filter, search]);

  return (
    <div className="mt-6">
      {!loading && assetAccounts.length > 0 && (
        <AssetBalanceSummary
          summary={balanceSummary}
          activeFilter={filter}
          onFilterSelect={setFilter}
        />
      )}

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="relative flex-1 lg:max-w-xs xl:max-w-sm">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search asset accounts or employer..."
            aria-label="Search asset accounts"
            className="w-full pl-9 pr-8 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap bg-slate-100 p-1 rounded-lg text-xs font-semibold gap-1">
            <button
              type="button"
              onClick={() => setFilter('all')}
              aria-pressed={filter === 'all'}
              className={`px-2.5 py-1.5 rounded-md transition cursor-pointer ${
                filter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({counts.all})
            </button>
            {FILTER_TYPE_ORDER.map((typeKey) => {
              const meta = ASSET_TYPE_META[typeKey];
              return (
                <button
                  key={typeKey}
                  type="button"
                  onClick={() => setFilter(typeKey)}
                  aria-pressed={filter === typeKey}
                  className={`px-2.5 py-1.5 rounded-md transition cursor-pointer ${
                    filter === typeKey
                      ? meta.filterActiveClass
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {meta.filterLabel} ({counts.byType[typeKey]})
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {counts.mismatches > 0 && (
        <div
          role="alert"
          className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            {counts.mismatches} meal-voucher {counts.mismatches === 1 ? 'account has' : 'accounts have'} a Firefly balance that is not an exact multiple of the configured voucher value.
          </span>
        </div>
      )}

      {loading ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading asset accounts"
          className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="h-32 rounded-xl border border-slate-200 bg-white p-4 animate-pulse"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-slate-100" />
                  <div className="space-y-2">
                    <div className="h-3.5 w-28 rounded bg-slate-100" />
                    <div className="h-3 w-16 rounded bg-slate-100" />
                  </div>
                </div>
                <div className="h-4 w-16 rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div
          role="status"
          className="py-12 px-4 text-center bg-white border border-slate-200 rounded-xl mt-6"
        >
          <Wallet className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-700">
            No asset accounts match the current filter.
          </p>
          {(search.trim() !== '' || filter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setFilter('all');
              }}
              className="mt-3 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((acc) => {
            const normalizedType = normalizeAssetType(acc.asset_type);
            const typeMeta = ASSET_TYPE_META[normalizedType];
            const TypeIcon = typeMeta.icon;
            const isVoucher = normalizedType === 'meal_voucher';
            const hasMismatch = isVoucher && !acc.is_exact_multiple;

            return (
              <div
                key={acc.id}
                className={`p-4 rounded-xl border bg-white shadow-xs transition flex flex-col justify-between ${
                  hasMismatch
                    ? 'border-amber-300 ring-1 ring-amber-200/70'
                    : typeMeta.cardBorderClass
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className={`p-2 rounded-lg shrink-0 mt-0.5 ${typeMeta.iconWrapperClass}`}>
                        <TypeIcon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm text-slate-900 truncate" title={acc.name}>
                          {acc.name}
                        </h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-slate-400 font-mono">#{acc.id}</span>
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${typeMeta.badgeClass}`}
                          >
                            {typeMeta.label}
                          </span>
                          {acc.active === false && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                              Inactive
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                        Firefly Balance
                      </span>
                      <span className="text-sm font-bold text-slate-900 tabular-nums">
                        {formatAssetMoney(acc.current_balance, acc.currency_code)}
                      </span>
                    </div>
                  </div>

                  {isVoucher && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-2 text-xs">
                      <div className="grid grid-cols-2 gap-2 bg-slate-50 rounded-lg p-2.5">
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                            Unit Value
                          </span>
                          <span className="font-semibold text-slate-800">
                            {formatAssetMoney(acc.voucher_unit_value ?? 0, acc.currency_code)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                            Available Units
                          </span>
                          <span className="font-bold text-amber-700">
                            {acc.usable_vouchers ?? 0}{' '}
                            {acc.usable_vouchers === 1 ? 'voucher' : 'vouchers'}
                          </span>
                        </div>
                      </div>

                      {acc.default_revenue_account_name && (
                        <div className="flex items-center gap-1.5 text-slate-600 truncate">
                          <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">Employer: {acc.default_revenue_account_name}</span>
                        </div>
                      )}

                      {hasMismatch && (
                        <div
                          role="alert"
                          className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-1.5"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                          <span>
                            Balance is off by{' '}
                            <strong>{formatAssetMoney(Math.abs(acc.balance_discrepancy), acc.currency_code)}</strong> from an exact
                            multiple of {formatAssetMoney(acc.voucher_unit_value ?? 0, acc.currency_code)}. Check Firefly transactions.
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {acc.notes && (
                    <p className="mt-2.5 text-xs text-slate-500 line-clamp-2" title={acc.notes}>
                      {acc.notes}
                    </p>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onConfigure(acc)}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition cursor-pointer"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    Configure
                  </button>
                  {isVoucher && (
                    <button
                      type="button"
                      onClick={() => onRecharge(acc)}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Recharge
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
