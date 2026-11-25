import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { AssetAccountType } from '../../types';
import {
  ASSET_TYPE_META,
  AssetBalanceSummary as AssetBalanceSummaryData,
  formatCents,
} from './assetTypeUtils';

interface AssetBalanceSummaryProps {
  summary: AssetBalanceSummaryData;
  activeFilter: 'all' | AssetAccountType;
  onFilterSelect: (filter: 'all' | AssetAccountType) => void;
}

export const AssetBalanceSummary: React.FC<AssetBalanceSummaryProps> = ({
  summary,
  activeFilter,
  onFilterSelect,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [primaryTotal, ...secondaryTotals] = summary.grandTotals;

  return (
    <section
      aria-label="Asset balance summary"
      className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Total Active Assets
            </span>
            <span className="text-xs text-slate-400 tabular-nums">
              ({summary.totalActiveCount} in net worth)
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            {primaryTotal && (
              <span className="text-xl font-bold text-slate-900 tabular-nums">
                {formatCents(primaryTotal.cents, primaryTotal.currency)}
              </span>
            )}
            {secondaryTotals.map((t) => (
              <span
                key={t.currency}
                className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md tabular-nums"
              >
                {formatCents(t.cents, t.currency)}
              </span>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-controls="asset-balance-breakdown"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition cursor-pointer"
        >
          <span>{expanded ? 'Hide breakdown' : 'Show breakdown'}</span>
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {expanded && (
        <div
          id="asset-balance-breakdown"
          className="mt-3.5 pt-3.5 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2.5"
        >
          {summary.categorized.map((item) => {
            const meta = ASSET_TYPE_META[item.type];
            const Icon = meta.icon;
            const isSelected = activeFilter === item.type;
            const isEmpty = item.activeCount === 0;
            const [primaryAmount, ...secondaryAmounts] = item.totals;

            return (
              <button
                key={item.type}
                type="button"
                onClick={() => onFilterSelect(isSelected ? 'all' : item.type)}
                aria-pressed={isSelected}
                className={`flex flex-col justify-start p-3 rounded-xl border text-left focus:outline-none focus:ring-2 focus:ring-indigo-500 transition cursor-pointer ${
                  isSelected
                    ? meta.summaryRingClass
                    : 'border-slate-200/90 bg-slate-50/40 hover:bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5 w-full">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className={`p-1 rounded-md shrink-0 ${meta.iconWrapperClass}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-slate-700 leading-tight">
                      {meta.label}
                    </span>
                  </div>
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-200/70 text-slate-600 tabular-nums shrink-0"
                    title={`${item.activeCount} active ${
                      item.activeCount === 1 ? 'account' : 'accounts'
                    }`}
                  >
                    {item.activeCount}
                    <span className="sr-only">
                      {' '}
                      active {item.activeCount === 1 ? 'account' : 'accounts'}
                    </span>
                  </span>
                </div>

                <div className="mt-2.5 flex flex-col gap-0.5">
                  {primaryAmount && (
                    <span
                      className={`text-[15px] font-bold tabular-nums leading-tight ${
                        isEmpty ? 'text-slate-400' : 'text-slate-900'
                      }`}
                    >
                      {formatCents(primaryAmount.cents, primaryAmount.currency)}
                    </span>
                  )}
                  {secondaryAmounts.map((t) => (
                    <span
                      key={t.currency}
                      className="text-[11px] font-medium text-slate-500 tabular-nums leading-tight"
                    >
                      + {formatCents(t.cents, t.currency)}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
