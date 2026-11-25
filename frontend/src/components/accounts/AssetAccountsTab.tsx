import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Plus,
  Search,
  Settings2,
  Ticket,
  Wallet,
} from 'lucide-react';
import { FireflyAssetAccount } from '../../types';

interface AssetAccountsTabProps {
  assetAccounts: FireflyAssetAccount[];
  loading: boolean;
  onConfigure: (account: FireflyAssetAccount) => void;
  onRecharge: (account: FireflyAssetAccount) => void;
}

export const AssetAccountsTab: React.FC<AssetAccountsTabProps> = ({
  assetAccounts,
  loading,
  onConfigure,
  onRecharge,
}) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'meal_voucher' | 'standard'>('all');

  const counts = useMemo(() => {
    let mealVoucher = 0;
    let standard = 0;
    let mismatches = 0;
    for (const acc of assetAccounts) {
      if (acc.asset_type === 'meal_voucher') {
        mealVoucher++;
        if (!acc.is_exact_multiple) mismatches++;
      } else {
        standard++;
      }
    }
    return { all: assetAccounts.length, mealVoucher, standard, mismatches };
  }, [assetAccounts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assetAccounts.filter((acc) => {
      if (filter !== 'all' && acc.asset_type !== filter) return false;
      if (!q) return true;
      return (
        acc.name.toLowerCase().includes(q) ||
        String(acc.id).includes(q) ||
        (acc.default_revenue_account_name || '').toLowerCase().includes(q)
      );
    });
  }, [assetAccounts, filter, search]);

  const formatMoney = (val: string | number | null | undefined, currency?: string | null) => {
    const num = Number(val ?? 0);
    const symbol = !currency || currency === 'EUR' ? '€' : `${currency} `;
    return `${symbol}${Number.isFinite(num) ? num.toFixed(2) : '0.00'}`;
  };

  return (
    <div className="mt-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search asset accounts or employer..."
            aria-label="Search asset accounts"
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-100 p-1 rounded-lg text-xs font-semibold gap-1">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1.5 rounded-md transition cursor-pointer ${
                filter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({counts.all})
            </button>
            <button
              type="button"
              onClick={() => setFilter('meal_voucher')}
              className={`px-2.5 py-1.5 rounded-md transition cursor-pointer ${
                filter === 'meal_voucher'
                  ? 'bg-white text-amber-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Meal Vouchers ({counts.mealVoucher})
            </button>
            <button
              type="button"
              onClick={() => setFilter('standard')}
              className={`px-2.5 py-1.5 rounded-md transition cursor-pointer ${
                filter === 'standard'
                  ? 'bg-white text-slate-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Standard ({counts.standard})
            </button>
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
        <div className="py-16 text-center text-slate-400 text-sm">Loading Firefly III asset accounts...</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm bg-white border border-slate-200 rounded-xl mt-6">
          No asset accounts match the current filter.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((acc) => {
            const isVoucher = acc.asset_type === 'meal_voucher';
            const hasMismatch = isVoucher && !acc.is_exact_multiple;

            return (
              <div
                key={acc.id}
                className={`p-4 rounded-xl border bg-white shadow-xs transition flex flex-col justify-between ${
                  hasMismatch
                    ? 'border-amber-300 ring-1 ring-amber-200/70'
                    : isVoucher
                    ? 'border-amber-200/80 hover:border-amber-300'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div
                        className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                          isVoucher ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {isVoucher ? <Ticket className="w-4 h-4" /> : <Wallet className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm text-slate-900 truncate" title={acc.name}>
                          {acc.name}
                        </h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-slate-400 font-mono">#{acc.id}</span>
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                              isVoucher
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {isVoucher ? 'Meal Voucher' : 'Standard'}
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
                      <span className="text-sm font-bold text-slate-900">
                        {formatMoney(acc.current_balance, acc.currency_code)}
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
                            €{(acc.voucher_unit_value ?? 0).toFixed(2)}
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
                            <strong>€{Math.abs(acc.balance_discrepancy).toFixed(2)}</strong> from an exact
                            multiple of €{(acc.voucher_unit_value ?? 0).toFixed(2)}. Check Firefly transactions.
                          </span>
                        </div>
                      )}
                    </div>
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
