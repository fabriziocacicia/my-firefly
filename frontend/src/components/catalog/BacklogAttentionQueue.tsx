import React from 'react';
import { AlertTriangle, Building2, CheckCircle2, Store } from 'lucide-react';
import { AttentionQueueResponse } from '../../types';
import { SplitPriceEditor } from './SplitPriceEditor';

interface BacklogAttentionQueueProps {
  loading: boolean;
  data: AttentionQueueResponse | null;
  statusSubFilter: 'all' | 'missing' | 'needs_review';
  onStatusSubFilterChange: (next: 'all' | 'missing' | 'needs_review') => void;
  onPriceUpdated: () => void | Promise<void>;
}

export const BacklogAttentionQueue: React.FC<BacklogAttentionQueueProps> = ({
  loading,
  data,
  statusSubFilter,
  onStatusSubFilterChange,
  onPriceUpdated,
}) => {
  if (loading && !data) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 py-12 text-center text-xs text-slate-400">
        Loading missing &amp; review queue...
      </div>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-50/70 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Splits here are already linked to an item, but either have{' '}
            <strong>no quantity yet</strong> (<code>€/unit = null</code>) or were
            historically synced with a default <code>1.0</code> and need review.
          </span>
        </div>
        <div className="flex items-center gap-1 bg-white rounded-lg p-0.5 border border-amber-200 text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => onStatusSubFilterChange('all')}
            className={`px-2.5 py-1 rounded-md transition ${
              statusSubFilter === 'all'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({(data?.missing_count ?? 0) + (data?.needs_review_count ?? 0)})
          </button>
          <button
            type="button"
            onClick={() => onStatusSubFilterChange('missing')}
            className={`px-2.5 py-1 rounded-md transition ${
              statusSubFilter === 'missing'
                ? 'bg-amber-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Missing qty ({data?.missing_count ?? 0})
          </button>
          <button
            type="button"
            onClick={() => onStatusSubFilterChange('needs_review')}
            className={`px-2.5 py-1 rounded-md transition ${
              statusSubFilter === 'needs_review'
                ? 'bg-sky-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Needs review ({data?.needs_review_count ?? 0})
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {items.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            <span>No splits missing quantity or awaiting review under current filters.</span>
          </div>
        ) : (
          items.map(item => (
            <div
              key={item.price_record_id}
              className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-slate-50/70 transition"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-sm text-slate-900">
                    {item.product_name}
                  </span>
                  {item.brand_name && (
                    <span className="text-[11px] font-bold uppercase tracking-wide text-blue-600">
                      {item.brand_name}
                    </span>
                  )}
                  {item.category_name && (
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-medium">
                      {item.category_name}
                    </span>
                  )}
                  <strong className="text-sm text-slate-900 tabular-nums">
                    €{item.paid_price.toFixed(2)}
                  </strong>
                </div>
                <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="font-mono">{item.recorded_date}</span>
                  {item.company_name && (
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="w-3 h-3 text-slate-400" />
                      {item.company_name}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Store className="w-3 h-3 text-slate-400" />
                    {item.store_name}
                  </span>
                  {item.split_description && item.split_description !== item.product_name && (
                    <span className="text-slate-400 truncate">
                      FF: {item.split_description}
                    </span>
                  )}
                </div>
              </div>

              <div className="lg:min-w-[360px]">
                <SplitPriceEditor
                  priceRecordId={item.price_record_id}
                  paidPrice={item.paid_price}
                  regularPrice={item.regular_price}
                  isDiscount={item.is_discount}
                  quantity={item.quantity}
                  unit={item.unit}
                  packageSize={item.package_size}
                  normalizedUnitPrice={item.normalized_unit_price}
                  verificationStatus={item.verification_status}
                  defaultExpanded={item.verification_status === 'missing'}
                  onSaved={onPriceUpdated}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
