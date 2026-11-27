import React from 'react';
import { AlertTriangle, Building2, Store } from 'lucide-react';
import {
  BacklogResponse,
  BacklogStatusFilter,
  ChainFilterOption,
  StoreFilterOption,
} from '../../types';

interface BacklogFiltersBarProps {
  statusFilter: BacklogStatusFilter;
  onStatusFilterChange: (next: BacklogStatusFilter) => void;
  unassociatedCount: number;
  needsAttentionCount: number;
  linkedCount: number;
  ignoredCount: number;
  selectedCompanyId: number | null;
  onCompanyChange: (companyId: number | null) => void;
  selectedAccountId: number | null;
  onAccountChange: (accountId: number | null) => void;
  availableChains: ChainFilterOption[];
  allAvailableStores: StoreFilterOption[];
  selectedCategory: string | null;
  onCategoryChange: (category: string | null) => void;
  backlog: BacklogResponse | null;
}

export const BacklogFiltersBar: React.FC<BacklogFiltersBarProps> = ({
  statusFilter,
  onStatusFilterChange,
  unassociatedCount,
  needsAttentionCount,
  linkedCount,
  ignoredCount,
  selectedCompanyId,
  onCompanyChange,
  selectedAccountId,
  onAccountChange,
  availableChains,
  allAvailableStores,
  selectedCategory,
  onCategoryChange,
  backlog,
}) => {
  const visibleStores =
    selectedCompanyId !== null
      ? allAvailableStores.filter(st => st.company_id === selectedCompanyId)
      : allAvailableStores;

  const hasStrandedChain =
    selectedCompanyId !== null && !availableChains.some(c => c.id === selectedCompanyId);
  const hasStrandedStore =
    selectedAccountId !== null && !visibleStores.some(st => st.account_id === selectedAccountId);

  return (
    <div className="space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              onStatusFilterChange('unassociated');
              onCategoryChange(null);
            }}
            className={`px-3 py-1.5 rounded-lg transition ${
              statusFilter === 'unassociated'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            To Associate ({unassociatedCount})
          </button>
          <button
            type="button"
            onClick={() => {
              onStatusFilterChange('needs_attention');
              onCategoryChange(null);
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
              statusFilter === 'needs_attention'
                ? 'bg-white text-amber-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <AlertTriangle
              className={`w-3.5 h-3.5 ${
                needsAttentionCount > 0 ? 'text-amber-600' : 'text-slate-400'
              }`}
            />
            Missing &amp; To Review ({needsAttentionCount})
          </button>
          <button
            type="button"
            onClick={() => {
              onStatusFilterChange('linked');
              onCategoryChange(null);
            }}
            className={`px-3 py-1.5 rounded-lg transition ${
              statusFilter === 'linked'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Associated ({linkedCount})
          </button>
          <button
            type="button"
            onClick={() => {
              onStatusFilterChange('ignored');
              onCategoryChange(null);
            }}
            className={`px-3 py-1.5 rounded-lg transition ${
              statusFilter === 'ignored'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Ignored ({ignoredCount})
          </button>
        </div>

        {/* Chain & Store Filters */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <select
              aria-label="Filter by chain"
              value={selectedCompanyId ?? ''}
              onChange={e => {
                const nextCid = e.target.value ? Number(e.target.value) : null;
                onCompanyChange(nextCid);
                if (nextCid !== null && selectedAccountId !== null) {
                  const st = allAvailableStores.find(s => s.account_id === selectedAccountId);
                  if (st && st.company_id !== nextCid) {
                    onAccountChange(null);
                  }
                }
              }}
              className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none"
            >
              <option value="">All Chains ({availableChains.length})</option>
              {hasStrandedChain && (
                <option value={selectedCompanyId!}>Chain #{selectedCompanyId} (0)</option>
              )}
              {availableChains.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
          </div>

          <div className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
            <Store className="w-3.5 h-3.5 text-slate-400" />
            <select
              aria-label="Filter by store"
              value={selectedAccountId ?? ''}
              onChange={e => onAccountChange(e.target.value ? Number(e.target.value) : null)}
              className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none max-w-[220px]"
            >
              <option value="">All Stores ({visibleStores.length})</option>
              {hasStrandedStore && (
                <option value={selectedAccountId!}>Account #{selectedAccountId} (0)</option>
              )}
              {visibleStores.map(st => (
                <option key={st.account_id} value={st.account_id}>
                  {st.name} ({st.count})
                </option>
              ))}
            </select>
          </div>

          {(selectedCompanyId !== null || selectedAccountId !== null) && (
            <button
              type="button"
              onClick={() => {
                onCompanyChange(null);
                onAccountChange(null);
              }}
              className="px-2 py-1.5 rounded-lg text-[11px] font-semibold text-blue-600 hover:bg-blue-50"
            >
              Clear store filters
            </button>
          )}
        </div>
      </div>

      {statusFilter !== 'needs_attention' && backlog && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onCategoryChange(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
              selectedCategory === null
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All Categories (
            {backlog.category_counts.reduce((acc, c) => acc + c.count, 0)})
          </button>
          {backlog.category_counts.map(cat => {
            const key = cat.category_name === null ? '__uncategorized__' : cat.category_name;
            const active = selectedCategory === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onCategoryChange(active ? null : key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
                }`}
              >
                {cat.category_name || 'Uncategorized'} ({cat.count})
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
