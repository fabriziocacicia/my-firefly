import React, { useEffect, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Link2,
  Plus,
  RotateCcw,
  Sparkles,
  Store,
  Unlink,
} from 'lucide-react';
import {
  AliasScope,
  BacklogChainBucket,
  BacklogSplitsResponse,
  BacklogStoreBucket,
  BacklogStatusFilter,
} from '../../types';
import { SplitPriceEditor } from './SplitPriceEditor';

export interface SubsetActionRequest {
  label: string;
  journalIds: number[];
  suggestedProductId?: number | null;
  aliasScope: AliasScope;
}

interface BacklogSplitDrilldownProps {
  data: BacklogSplitsResponse;
  statusFilter: Exclude<BacklogStatusFilter, 'needs_attention'>;
  rowJobActive: boolean;
  onQuickLink: (
    productId: number,
    journalIds: number[],
    aliasScope: AliasScope,
    label: string
  ) => void;
  onOpenLinkModal: (req: SubsetActionRequest) => void;
  onOpenNewItemModal: (req: SubsetActionRequest) => void;
  onIgnore: (journalIds: number[], ignored: boolean) => void;
  onUnlink: (journalIds: number[], label: string) => void;
  onPriceUpdated: () => void | Promise<void>;
}

const ScopeBadge: React.FC<{ scope?: string | null }> = ({ scope }) => {
  if (!scope) return null;
  const label =
    scope === 'store'
      ? 'store'
      : scope === 'chain'
      ? 'chain'
      : scope === 'global'
      ? 'alias'
      : 'name';
  return (
    <span className="ml-1 text-[10px] uppercase tracking-wide opacity-75">
      ({label})
    </span>
  );
};

export const BacklogSplitDrilldown: React.FC<BacklogSplitDrilldownProps> = ({
  data,
  statusFilter,
  rowJobActive,
  onQuickLink,
  onOpenLinkModal,
  onOpenNewItemModal,
  onIgnore,
  onUnlink,
  onPriceUpdated,
}) => {
  const [expandedChains, setExpandedChains] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    data.chains.forEach(c => {
      init[c.company_id] = true;
    });
    return init;
  });
  const [expandedStores, setExpandedStores] = useState<Record<string, boolean>>({});
  const [selectedJids, setSelectedJids] = useState<Set<number>>(new Set());

  useEffect(() => {
    const validJids = new Set<number>();
    for (const chain of data.chains) {
      for (const store of chain.stores) {
        for (const jid of store.journal_ids) validJids.add(jid);
      }
    }
    for (const store of data.unchained_stores) {
      for (const jid of store.journal_ids) validJids.add(jid);
    }
    setSelectedJids(prev => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<number>();
      for (const jid of prev) {
        if (validJids.has(jid)) next.add(jid);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [data]);

  const toggleChain = (companyId: number) =>
    setExpandedChains(prev => ({ ...prev, [companyId]: !prev[companyId] }));

  const toggleStore = (storeKey: string) =>
    setExpandedStores(prev => ({ ...prev, [storeKey]: !prev[storeKey] }));

  const toggleSplit = (jid: number) => {
    setSelectedJids(prev => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  };

  const toggleStoreSplits = (store: BacklogStoreBucket) => {
    const allSelected =
      store.journal_ids.length > 0 &&
      store.journal_ids.every(jid => selectedJids.has(jid));
    setSelectedJids(prev => {
      const next = new Set(prev);
      for (const jid of store.journal_ids) {
        if (allSelected) next.delete(jid);
        else next.add(jid);
      }
      return next;
    });
  };

  const selectedArray = Array.from(selectedJids);

  const renderBucketActions = (
    label: string,
    journalIds: number[],
    aliasScope: AliasScope,
    suggestedProductId?: number | null,
    suggestedProductName?: string | null,
    suggestedScope?: string | null
  ) => {
    if (statusFilter === 'unassociated') {
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {suggestedProductId && suggestedProductName && (
            <button
              type="button"
              disabled={rowJobActive}
              onClick={() =>
                onQuickLink(suggestedProductId, journalIds, aliasScope, label)
              }
              className="inline-flex items-center px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-semibold"
              title={`Link ${journalIds.length} split(s) to ${suggestedProductName}`}
            >
              <Sparkles className="w-3 h-3 mr-1" />
              Link {suggestedProductName}
              <ScopeBadge scope={suggestedScope} />
            </button>
          )}
          <button
            type="button"
            disabled={rowJobActive}
            onClick={() =>
              onOpenLinkModal({
                label,
                journalIds,
                suggestedProductId,
                aliasScope,
              })
            }
            className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-700 text-[11px] font-semibold"
          >
            <Link2 className="w-3 h-3 mr-1" />
            {suggestedProductId ? 'Change' : 'Link'}
          </button>
          <button
            type="button"
            disabled={rowJobActive}
            onClick={() =>
              onOpenNewItemModal({
                label,
                journalIds,
                aliasScope,
              })
            }
            className="inline-flex items-center px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 text-emerald-700 text-[11px] font-semibold"
          >
            <Plus className="w-3 h-3 mr-1" />
            New
          </button>
          <button
            type="button"
            disabled={rowJobActive}
            onClick={() => onIgnore(journalIds, true)}
            className="inline-flex items-center px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-600 text-[11px] font-medium"
            title="Ignore these splits"
          >
            <EyeOff className="w-3 h-3" />
          </button>
        </div>
      );
    }

    if (statusFilter === 'linked') {
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={rowJobActive}
            onClick={() =>
              onOpenLinkModal({
                label,
                journalIds,
                aliasScope,
              })
            }
            className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-700 text-[11px] font-semibold"
          >
            <Link2 className="w-3 h-3 mr-1" />
            Re-link
          </button>
          <button
            type="button"
            disabled={rowJobActive}
            onClick={() => onUnlink(journalIds, label)}
            className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-rose-50 disabled:opacity-50 text-slate-700 hover:text-rose-700 text-[11px] font-semibold"
          >
            <Unlink className="w-3 h-3 mr-1" />
            Unlink
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={() => onIgnore(journalIds, false)}
        className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-semibold"
      >
        <RotateCcw className="w-3 h-3 mr-1" />
        Restore
      </button>
    );
  };

  const renderStoreBucket = (store: BacklogStoreBucket, keyPrefix: string) => {
    const storeKey = `${keyPrefix}::${store.firefly_account_id ?? store.store_name}`;
    const isOpen = !!expandedStores[storeKey];
    const allChecked =
      store.journal_ids.length > 0 &&
      store.journal_ids.every(jid => selectedJids.has(jid));

    return (
      <div
        key={storeKey}
        className="rounded-lg border border-slate-200 bg-white overflow-hidden"
      >
        <div className="p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => toggleStore(storeKey)}
              className="inline-flex items-center gap-1.5 font-semibold text-slate-800 hover:text-blue-700 text-left min-w-0"
            >
              {isOpen ? (
                <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              )}
              <Store className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{store.store_name}</span>
            </button>
            <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold shrink-0">
              {store.occurrence_count}×
            </span>
            <span className="text-slate-500 text-[11px] shrink-0">
              €{store.total_amount.toFixed(2)}
            </span>
          </div>

          {renderBucketActions(
            store.store_name,
            store.journal_ids,
            'store',
            store.suggested_product_id,
            store.suggested_product_name,
            store.suggested_scope
          )}
        </div>

        {isOpen && (
          <div className="border-t border-slate-100 bg-slate-50/70 divide-y divide-slate-100">
            <div className="px-3 py-1.5 flex items-center justify-between text-[11px] text-slate-500">
              <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() => toggleStoreSplits(store)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Select all {store.splits.length} splits in store</span>
              </label>
              <span>Individual splits</span>
            </div>

            {store.splits.map(sp => {
              const checked = selectedJids.has(sp.transaction_journal_id);
              return (
                <div
                  key={sp.transaction_journal_id}
                  className="p-2.5 px-3 space-y-2 text-xs bg-white/80"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <label className="flex items-start sm:items-center gap-2 cursor-pointer min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSplit(sp.transaction_journal_id)}
                        className="mt-0.5 sm:mt-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="font-mono text-[11px] text-slate-500 shrink-0">
                        {sp.tx_date}
                      </span>
                      <strong className="text-slate-900 shrink-0">
                        €{sp.amount.toFixed(2)}
                      </strong>
                      <span className="text-slate-600 truncate">{sp.description}</span>
                      {sp.linked_product_name && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold shrink-0">
                          {sp.linked_product_name}
                        </span>
                      )}
                    </label>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {sp.tags.slice(0, 3).map(t => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700"
                        >
                          #{t}
                        </span>
                      ))}
                      {statusFilter === 'unassociated' && (
                        <button
                          type="button"
                          disabled={rowJobActive}
                          onClick={() =>
                            onOpenLinkModal({
                              label: `${sp.tx_date} (€${sp.amount.toFixed(2)})`,
                              journalIds: [sp.transaction_journal_id],
                              suggestedProductId: store.suggested_product_id,
                              aliasScope: 'none',
                            })
                          }
                          className="px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-blue-50 text-blue-700 text-[11px] font-semibold"
                        >
                          Link
                        </button>
                      )}
                    </div>
                  </div>

                  {sp.price_record && (
                    <div className="pl-6">
                      <SplitPriceEditor
                        priceRecordId={sp.price_record.id}
                        paidPrice={sp.price_record.paid_price}
                        regularPrice={sp.price_record.regular_price}
                        isDiscount={sp.price_record.is_discount}
                        quantity={sp.price_record.quantity}
                        unit={sp.price_record.unit}
                        packageSize={sp.price_record.package_size}
                        normalizedUnitPrice={sp.price_record.normalized_unit_price}
                        verificationStatus={sp.price_record.verification_status}
                        onSaved={onPriceUpdated}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderChainBucket = (chain: BacklogChainBucket) => {
    const isOpen = !!expandedChains[chain.company_id];
    return (
      <div
        key={chain.company_id}
        className="rounded-xl border border-slate-200 bg-slate-50/80 overflow-hidden"
      >
        <div className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => toggleChain(chain.company_id)}
              className="inline-flex items-center gap-1.5 font-bold text-slate-900 hover:text-blue-700 text-left"
            >
              {isOpen ? (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-500" />
              )}
              <Building2 className="w-3.5 h-3.5 text-blue-600" />
              <span>{chain.company_name}</span>
            </button>
            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[11px] font-bold">
              {chain.occurrence_count}× · {chain.stores.length}{' '}
              {chain.stores.length === 1 ? 'store' : 'stores'}
            </span>
            <span className="text-slate-600 font-medium">
              €{chain.total_amount.toFixed(2)}
            </span>
          </div>

          {renderBucketActions(
            chain.company_name,
            chain.journal_ids,
            'chain',
            chain.suggested_product_id,
            chain.suggested_product_name,
            chain.suggested_scope
          )}
        </div>

        {isOpen && (
          <div className="px-3 pb-3 space-y-2">
            {chain.stores.map(st => renderStoreBucket(st, `chain-${chain.company_id}`))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-200 space-y-2.5">
      {selectedArray.length > 0 && (
        <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-blue-900">
              {selectedArray.length} split{selectedArray.length === 1 ? '' : 's'} selected
            </span>
            <button
              type="button"
              onClick={() => setSelectedJids(new Set())}
              className="text-[11px] font-semibold text-blue-700 hover:underline"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {statusFilter === 'unassociated' && (
              <>
                <button
                  type="button"
                  disabled={rowJobActive}
                  onClick={() =>
                    onOpenLinkModal({
                      label: `${selectedArray.length} selected split(s)`,
                      journalIds: selectedArray,
                      aliasScope: 'none',
                    })
                  }
                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold"
                >
                  Link Selected
                </button>
                <button
                  type="button"
                  disabled={rowJobActive}
                  onClick={() =>
                    onOpenNewItemModal({
                      label: `${selectedArray.length} selected split(s)`,
                      journalIds: selectedArray,
                      aliasScope: 'none',
                    })
                  }
                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold"
                >
                  New Item from Selected
                </button>
                <button
                  type="button"
                  disabled={rowJobActive}
                  onClick={() => {
                    onIgnore(selectedArray, true);
                    setSelectedJids(new Set());
                  }}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-[11px] font-semibold"
                >
                  Ignore Selected
                </button>
              </>
            )}
            {statusFilter === 'linked' && (
              <>
                <button
                  type="button"
                  disabled={rowJobActive}
                  onClick={() =>
                    onOpenLinkModal({
                      label: `${selectedArray.length} selected split(s)`,
                      journalIds: selectedArray,
                      aliasScope: 'none',
                    })
                  }
                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold"
                >
                  Re-link Selected
                </button>
                <button
                  type="button"
                  disabled={rowJobActive}
                  onClick={() => {
                    onUnlink(selectedArray, `${selectedArray.length} selected split(s)`);
                    setSelectedJids(new Set());
                  }}
                  className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold"
                >
                  Unlink Selected
                </button>
              </>
            )}
            {statusFilter === 'ignored' && (
              <button
                type="button"
                onClick={() => {
                  onIgnore(selectedArray, false);
                  setSelectedJids(new Set());
                }}
                className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold"
              >
                Restore Selected
              </button>
            )}
          </div>
        </div>
      )}

      {data.chains.map(renderChainBucket)}
      {data.unchained_stores.map(st => renderStoreBucket(st, 'unchained'))}
    </div>
  );
};
