import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Unlink,
  X,
} from 'lucide-react';
import { api } from '../../api/client';
import { hasDismissibleFinishedJobs } from '../../hooks/syncJobVisibility';
import { isSyncJobActive } from '../../hooks/useFireflySyncJobs';
import {
  AliasScope,
  AttentionQueueResponse,
  BacklogGroup,
  BacklogResponse,
  BacklogSplitsResponse,
  BacklogStatusFilter,
  FireflySyncJob,
  FireflySyncStatus,
  Product,
} from '../../types';
import { BacklogAttentionQueue } from './BacklogAttentionQueue';
import { BacklogFiltersBar } from './BacklogFiltersBar';
import { BacklogLinkModal, LinkTarget } from './BacklogLinkModal';
import { BacklogSplitDrilldown, SubsetActionRequest } from './BacklogSplitDrilldown';
import { ItemEditorModal } from './ItemEditorModal';
import { SyncJobBadge } from './SyncJobBadge';

interface FireflyBacklogTabProps {
  products: Product[];
  jobs: FireflySyncJob[];
  jobsByProductId: Record<number, FireflySyncJob>;
  onJobStarted: (job: FireflySyncJob) => void;
  onDismissJob: (jobId: number) => void;
  onDismissAllJobs?: () => void | Promise<void>;
  isDismissingAll?: boolean;
  onDataChanged: () => void | Promise<void>;
  onUnassociatedCountChange?: (count: number) => void;
}

interface CreateTarget {
  initialName: string;
  categoryName: string | null;
  sampleTags: string[];
  journalIds: number[];
  aliasScope: AliasScope;
}

interface ExpandedGroupState {
  loading: boolean;
  error: string | null;
  data: BacklogSplitsResponse | null;
  group: BacklogGroup;
}

function makeGroupKey(group: BacklogGroup): string {
  return `${group.normalized_description}::${group.category_name ?? ''}::${
    group.linked_product_id ?? ''
  }`;
}

export const FireflyBacklogTab: React.FC<FireflyBacklogTabProps> = ({
  products,
  jobs,
  jobsByProductId,
  onJobStarted,
  onDismissJob,
  onDismissAllJobs,
  isDismissingAll = false,
  onDataChanged,
  onUnassociatedCountChange,
}) => {
  const [status, setStatus] = useState<FireflySyncStatus | null>(null);
  const [backlog, setBacklog] = useState<BacklogResponse | null>(null);
  const [attentionData, setAttentionData] = useState<AttentionQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingMode, setSyncingMode] = useState<'incremental' | 'full' | null>(null);
  const [requiresInitialFullSync, setRequiresInitialFullSync] = useState(false);

  const [statusFilter, setStatusFilter] = useState<BacklogStatusFilter>('unassociated');
  const [attentionSubFilter, setAttentionSubFilter] = useState<'all' | 'missing' | 'needs_review'>(
    'all'
  );
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Lazy 3-level drill-down state & per-group race/abort guards
  const [expandedGroups, setExpandedGroups] = useState<Record<string, ExpandedGroupState>>({});
  const expandedGroupsRef = useRef(expandedGroups);
  expandedGroupsRef.current = expandedGroups;
  const groupFetchControllersRef = useRef<Record<string, AbortController>>({});
  const groupFetchSeqRef = useRef<Record<string, number>>({});

  // Link & Create modals
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);

  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadSeqRef = useRef(0);
  const activeAbortRef = useRef<AbortController | null>(null);

  const fetchGroupSplits = useCallback(
    async (
      group: BacklogGroup,
      targetStatus: Exclude<BacklogStatusFilter, 'needs_attention'>,
      companyId: number | null,
      accountId: number | null
    ) => {
      const key = makeGroupKey(group);
      groupFetchControllersRef.current[key]?.abort();
      const controller = new AbortController();
      groupFetchControllersRef.current[key] = controller;
      const reqSeq = (groupFetchSeqRef.current[key] ?? 0) + 1;
      groupFetchSeqRef.current[key] = reqSeq;

      setExpandedGroups(prev => ({
        ...prev,
        [key]: {
          loading: true,
          error: null,
          data: prev[key]?.data ?? null,
          group,
        },
      }));
      try {
        const res = await api.fireflySync.getBacklogSplits(
          {
            normalized_description: group.normalized_description,
            category_name: group.category_name,
            status: targetStatus,
            linked_product_id: group.linked_product_id ?? null,
            company_id: companyId,
            account_id: accountId,
          },
          { signal: controller.signal }
        );
        if (controller.signal.aborted || groupFetchSeqRef.current[key] !== reqSeq) return;
        setExpandedGroups(prev => {
          if (!prev[key]) return prev;
          return {
            ...prev,
            [key]: { loading: false, error: null, data: res, group },
          };
        });
      } catch (err) {
        if (controller.signal.aborted || groupFetchSeqRef.current[key] !== reqSeq) return;
        setExpandedGroups(prev => {
          if (!prev[key]) return prev;
          return {
            ...prev,
            [key]: {
              loading: false,
              error: err instanceof Error ? err.message : 'Failed to load splits',
              data: prev[key]?.data ?? null,
              group,
            },
          };
        });
      }
    },
    []
  );

  const loadStatusAndBacklog = useCallback(
    async (silent: boolean = false) => {
      activeAbortRef.current?.abort();
      const controller = new AbortController();
      activeAbortRef.current = controller;
      const reqId = ++loadSeqRef.current;

      if (!silent) setLoading(true);
      try {
        if (statusFilter === 'needs_attention') {
          const [statusData, attentionRes] = await Promise.all([
            api.fireflySync.getStatus(),
            api.fireflySync.getAttentionQueue(
              {
                company_id: selectedCompanyId,
                account_id: selectedAccountId,
                category: selectedCategory,
                search: debouncedSearch.trim() || undefined,
                verification_status:
                  attentionSubFilter === 'all' ? undefined : attentionSubFilter,
              },
              { signal: controller.signal }
            ),
          ]);
          if (controller.signal.aborted || reqId !== loadSeqRef.current) return;
          setStatus(statusData);
          setAttentionData(attentionRes);
          setRequiresInitialFullSync(!statusData.last_full_sync_at);
          onUnassociatedCountChange?.(statusData.unassociated_count);
          return;
        }

        const [statusData, backlogData] = await Promise.all([
          api.fireflySync.getStatus(),
          api.fireflySync.getBacklog(
            {
              status: statusFilter,
              category: selectedCategory,
              search: debouncedSearch.trim() || undefined,
              company_id: selectedCompanyId,
              account_id: selectedAccountId,
            },
            { signal: controller.signal }
          ),
        ]);
        if (controller.signal.aborted || reqId !== loadSeqRef.current) return;
        setStatus(statusData);
        setBacklog(backlogData);
        setRequiresInitialFullSync(!statusData.last_full_sync_at);
        onUnassociatedCountChange?.(backlogData.total_unassociated);

        const openEntries = Object.entries(expandedGroupsRef.current);
        const nextByKey = new Map(backlogData.groups.map(g => [makeGroupKey(g), g]));
        for (const [k, entry] of openEntries) {
          const matchedGroup = nextByKey.get(k);
          if (matchedGroup) {
            void fetchGroupSplits(
              matchedGroup,
              statusFilter,
              selectedCompanyId,
              selectedAccountId
            );
          } else if (!entry.loading) {
            setExpandedGroups(prev => {
              const copy = { ...prev };
              delete copy[k];
              return copy;
            });
          }
        }
      } catch (err) {
        if (controller.signal.aborted || reqId !== loadSeqRef.current) return;
        if (!silent) {
          setBanner({
            type: 'error',
            text: err instanceof Error ? err.message : 'Failed to load backlog',
          });
        }
      } finally {
        if (reqId === loadSeqRef.current && !silent) setLoading(false);
      }
    },
    [
      statusFilter,
      attentionSubFilter,
      selectedCategory,
      selectedCompanyId,
      selectedAccountId,
      debouncedSearch,
      onUnassociatedCountChange,
      fetchGroupSplits,
    ]
  );

  const refreshAfterMutation = useCallback(
    async (silent: boolean = true) => {
      await Promise.all([loadStatusAndBacklog(silent), Promise.resolve(onDataChanged())]);
    },
    [loadStatusAndBacklog, onDataChanged]
  );

  const loadStatusAndBacklogRef = useRef(loadStatusAndBacklog);
  loadStatusAndBacklogRef.current = loadStatusAndBacklog;

  useEffect(() => {
    loadStatusAndBacklog();
    return () => {
      activeAbortRef.current?.abort();
    };
  }, [loadStatusAndBacklog]);

  useEffect(() => {
    Object.values(groupFetchControllersRef.current).forEach(ctrl => ctrl.abort());
    groupFetchControllersRef.current = {};
    setExpandedGroups({});
  }, [statusFilter, selectedCompanyId, selectedAccountId]);

  useEffect(() => {
    return () => {
      Object.values(groupFetchControllersRef.current).forEach(ctrl => ctrl.abort());
    };
  }, []);

  // Keep counts & rows fresh while SSE jobs run or finish
  const prevJobSignatureRef = useRef<string | null>(null);
  const lastBacklogSilentRefreshRef = useRef<number>(0);
  useEffect(() => {
    const signature = jobs
      .map(j => `${j.id}:${j.status}:${j.updated_transactions}`)
      .join('|');
    if (prevJobSignatureRef.current === signature) return;
    const hadPrev = prevJobSignatureRef.current !== null;
    prevJobSignatureRef.current = signature;
    if (!hadPrev) return;

    const anyActive = jobs.some(isSyncJobActive);
    const now = Date.now();
    if (!anyActive || now - lastBacklogSilentRefreshRef.current >= 4000) {
      lastBacklogSilentRefreshRef.current = now;
      loadStatusAndBacklog(true);
    }
  }, [jobs, loadStatusAndBacklog]);

  // Lightweight incremental sync on mount
  useEffect(() => {
    let active = true;
    setSyncingMode('incremental');
    api.fireflySync
      .syncTransactions('incremental')
      .then(res => {
        if (!active) return;
        if (res.status === 'requires_full_sync') {
          setRequiresInitialFullSync(true);
        } else if (res.status === 'synced' && res.splits_upserted > 0) {
          loadStatusAndBacklogRef.current(true);
        }
      })
      .catch(() => {
        // Non-blocking background refresh failure leaves local cache usable
      })
      .finally(() => {
        if (active) setSyncingMode(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleFullSync = async () => {
    setSyncingMode('full');
    setBanner(null);
    try {
      const res = await api.fireflySync.syncTransactions('full');
      setRequiresInitialFullSync(false);
      await loadStatusAndBacklog();
      setBanner({
        type: 'success',
        text: `Full Sync complete: ${res.splits_upserted} Firefly splits synced.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Full sync failed',
      });
    } finally {
      setSyncingMode(null);
    }
  };

  const handleIgnoreSplits = async (journalIds: number[], ignored: boolean = true) => {
    setBanner(null);
    try {
      await api.fireflySync.ignoreBacklog(journalIds, ignored);
      await loadStatusAndBacklog();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update entry',
      });
    }
  };

  const handleUnlinkSplits = async (journalIds: number[], label: string) => {
    setBanner(null);
    try {
      await api.fireflySync.unlinkBacklog(journalIds);
      await refreshAfterMutation(false);
      setBanner({
        type: 'success',
        text: `Unlinked "${label}" back to the unassociated queue.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to unlink entry',
      });
    }
  };

  const handleQuickLink = async (
    productId: number,
    journalIds: number[],
    aliasScope: AliasScope,
    label: string
  ) => {
    setBanner(null);
    try {
      const job = await api.fireflySync.linkBacklog(productId, journalIds, aliasScope);
      onJobStarted(job);
      await refreshAfterMutation(true);
      setBanner({
        type: 'success',
        text: `Started Firefly link job for "${label}" (${journalIds.length} split(s)).`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to link transactions',
      });
    }
  };

  const toggleGroupExpand = (group: BacklogGroup) => {
    if (statusFilter === 'needs_attention') return;
    const key = makeGroupKey(group);
    if (expandedGroups[key]) {
      groupFetchControllersRef.current[key]?.abort();
      delete groupFetchControllersRef.current[key];
      setExpandedGroups(prev => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      return;
    }
    void fetchGroupSplits(group, statusFilter, selectedCompanyId, selectedAccountId);
  };

  const openLinkModal = (group: BacklogGroup, subset?: SubsetActionRequest) => {
    setLinkTarget({
      label: subset ? `${group.sample_description} · ${subset.label}` : group.sample_description,
      occurrenceCount: subset ? subset.journalIds.length : group.occurrence_count,
      journalIds: subset ? subset.journalIds : group.journal_ids,
      suggestedProductId: subset
        ? subset.suggestedProductId ?? group.suggested_product_id ?? null
        : group.suggested_product_id ?? null,
      aliasScope: subset ? subset.aliasScope : 'auto',
    });
  };

  const visibleLinkedProductIds = new Set(
    (statusFilter === 'linked' ? backlog?.groups || [] : [])
      .map(g => g.linked_product_id)
      .filter((id): id is number => id != null)
  );
  const topPanelJobs = jobs.filter(
    j =>
      isSyncJobActive(j) ||
      j.failed_count > 0 ||
      j.status === 'failed' ||
      !visibleLinkedProductIds.has(j.product_id)
  );

  const availableChains =
    (statusFilter === 'needs_attention'
      ? attentionData?.available_chains
      : backlog?.available_chains) ?? [];
  const allAvailableStores =
    (statusFilter === 'needs_attention'
      ? attentionData?.available_stores
      : backlog?.available_stores) ?? [];

  const unassociatedCount = backlog?.total_unassociated ?? status?.unassociated_count ?? 0;
  const linkedCount = backlog?.linked_count ?? status?.linked_count ?? 0;
  const ignoredCount = backlog?.ignored_count ?? status?.ignored_count ?? 0;
  const needsAttentionCount =
    backlog?.needs_attention_count ?? status?.needs_attention_count ?? 0;

  return (
    <div className="space-y-4">
      {/* Sync Header Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            Firefly Historical Transactions Backlog
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {status?.last_full_sync_at ? (
              <>
                Cached splits: <strong>{status.total_cached_splits}</strong> · Watermark:{' '}
                <strong>{status.high_watermark_date || '—'}</strong> · Ignored:{' '}
                <strong>{status.ignored_count}</strong>
              </>
            ) : (
              'No initial Firefly sync run yet. Run Full Sync to load existing transactions.'
            )}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {syncingMode === 'incremental' && (
            <span className="text-[11px] text-slate-500 inline-flex items-center">
              <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
              Checking recent...
            </span>
          )}
          <button
            type="button"
            disabled={syncingMode !== null}
            onClick={handleFullSync}
            className="inline-flex items-center px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1.5 ${syncingMode === 'full' ? 'animate-spin' : ''}`}
            />
            {syncingMode === 'full' ? 'Syncing...' : 'Full Sync from Firefly'}
          </button>
        </div>
      </div>

      {requiresInitialFullSync && (
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-between gap-3">
          <div className="text-xs text-blue-900">
            <strong>Initial Sync Required:</strong> Click{' '}
            <strong>Full Sync from Firefly</strong> to import your existing Firefly
            transactions once. Future page refreshes will run lightweight incremental
            updates automatically.
          </div>
          <button
            type="button"
            disabled={syncingMode !== null}
            onClick={handleFullSync}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shrink-0"
          >
            Run Full Sync
          </button>
        </div>
      )}

      {banner && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          <span className="inline-flex items-center min-w-0">
            {banner.type === 'success' && <CheckCircle2 className="w-4 h-4 mr-2 shrink-0" />}
            <span>{banner.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className={`p-0.5 rounded shrink-0 ${
              banner.type === 'success'
                ? 'hover:bg-emerald-100 text-emerald-700'
                : 'hover:bg-rose-100 text-rose-700'
            }`}
            aria-label="Dismiss banner"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Status Segmentation + Chain/Store Filters + Category Filter Pills */}
      {(backlog || status) && (
        <BacklogFiltersBar
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          unassociatedCount={unassociatedCount}
          needsAttentionCount={needsAttentionCount}
          linkedCount={linkedCount}
          ignoredCount={ignoredCount}
          selectedCompanyId={selectedCompanyId}
          onCompanyChange={setSelectedCompanyId}
          selectedAccountId={selectedAccountId}
          onAccountChange={setSelectedAccountId}
          availableChains={availableChains}
          allAvailableStores={allAvailableStores}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          backlog={backlog}
        />
      )}

      {/* Active & Unshown Firefly Sync Jobs */}
      {topPanelJobs.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-700">
            <span>
              Firefly Background Sync ({topPanelJobs.filter(isSyncJobActive).length} active)
            </span>
            {onDismissAllJobs && hasDismissibleFinishedJobs(topPanelJobs) && (
              <button
                type="button"
                disabled={isDismissingAll}
                onClick={() => onDismissAllJobs()}
                className="inline-flex items-center px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-50 text-[11px] font-semibold text-slate-700"
              >
                <CheckCheck className="w-3 h-3 mr-1 text-slate-500 shrink-0" />
                {isDismissingAll ? 'Clearing...' : 'Dismiss all'}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {topPanelJobs.map(job => (
              <SyncJobBadge
                key={job.id}
                job={job}
                showProductName
                onDismiss={onDismissJob}
              />
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={
            statusFilter === 'needs_attention'
              ? 'Search items or descriptions awaiting quantity/review...'
              : statusFilter === 'linked'
              ? 'Search associated Firefly descriptions...'
              : statusFilter === 'ignored'
              ? 'Search ignored Firefly descriptions...'
              : 'Search unassociated Firefly descriptions (e.g. mele, barilla)...'
          }
          className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Main List or Attention Queue */}
      {statusFilter === 'needs_attention' ? (
        <BacklogAttentionQueue
          loading={loading}
          data={attentionData}
          statusSubFilter={attentionSubFilter}
          onStatusSubFilterChange={setAttentionSubFilter}
          onPriceUpdated={() => refreshAfterMutation(true)}
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Loading Firefly backlog...
            </div>
          ) : !backlog || backlog.groups.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              {statusFilter === 'linked'
                ? 'No associated Firefly entries match this filter.'
                : statusFilter === 'ignored'
                ? 'No ignored Firefly entries match this filter.'
                : 'No unassociated Firefly entries match this filter.'}
            </div>
          ) : (
            backlog.groups.map(group => {
              const gKey = makeGroupKey(group);
              const expandedState = expandedGroups[gKey];
              const isExpanded = Boolean(expandedState);
              const groupJidSet = new Set(group.journal_ids);
              const matchingJob =
                jobs.find(j => j.target_journal_ids.some(jid => groupJidSet.has(jid))) ||
                (group.linked_product_id ? jobsByProductId[group.linked_product_id] : null) ||
                null;
              const rowJobActive = matchingJob ? isSyncJobActive(matchingJob) : false;

              return (
                <div key={gKey} className="p-4 hover:bg-slate-50/50 transition">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0 space-y-1 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleGroupExpand(group)}
                          className="inline-flex items-center gap-1 font-semibold text-sm text-slate-900 hover:text-blue-700 text-left"
                          title="Expand by Chain, Store, and Individual Splits"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-blue-600 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <span>{group.sample_description}</span>
                        </button>
                        <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[11px] font-bold">
                          {group.occurrence_count}×
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-medium">
                          {group.category_name || 'Uncategorized'}
                        </span>
                        {(group.store_count ?? 0) > 1 && (
                          <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[11px] font-medium">
                            {group.store_count} stores
                          </span>
                        )}
                        {group.linked_product_name && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold">
                            → {group.linked_product_name}
                          </span>
                        )}
                        {matchingJob && (statusFilter === 'linked' || rowJobActive) && (
                          <SyncJobBadge
                            job={matchingJob}
                            onDismiss={onDismissJob}
                            variant="inline"
                          />
                        )}
                        {group.suggested_product_name && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-medium">
                            <Sparkles className="w-3 h-3 mr-1" />
                            Match: {group.suggested_product_name}
                            {group.suggested_scope ? ` (${group.suggested_scope})` : ''}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5 pl-5">
                        <span>
                          Total: <strong>€{group.total_amount.toFixed(2)}</strong>
                        </span>
                        <span>Latest: {group.latest_date}</span>
                        {group.sample_stores.length > 0 && (
                          <span>Stores: {group.sample_stores.join(', ')}</span>
                        )}
                      </div>
                      {group.sample_tags && group.sample_tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5 pl-5">
                          {group.sample_tags.map(tName => (
                            <span
                              key={tName}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700"
                            >
                              #{tName}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleGroupExpand(group)}
                        className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold"
                      >
                        {isExpanded ? 'Hide splits' : 'Split / Stores'}
                      </button>

                      {statusFilter === 'unassociated' && (
                        <>
                          <button
                            type="button"
                            disabled={rowJobActive}
                            onClick={() => openLinkModal(group)}
                            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-700 text-xs font-semibold"
                          >
                            <Link2 className="w-3.5 h-3.5 mr-1" />
                            Link to Item
                          </button>
                          <button
                            type="button"
                            disabled={rowJobActive}
                            onClick={() =>
                              setCreateTarget({
                                initialName: group.sample_description,
                                categoryName: group.category_name,
                                sampleTags: group.sample_tags ?? [],
                                journalIds: group.journal_ids,
                                aliasScope: 'auto',
                              })
                            }
                            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 text-emerald-700 text-xs font-semibold"
                          >
                            <Plus className="w-3.5 h-3.5 mr-1" />
                            New Item
                          </button>
                          <button
                            type="button"
                            disabled={rowJobActive}
                            onClick={() => handleIgnoreSplits(group.journal_ids, true)}
                            className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-600 text-xs font-medium"
                            title="Ignore non-product entry"
                          >
                            <EyeOff className="w-3.5 h-3.5 mr-1" />
                            Ignore
                          </button>
                        </>
                      )}
                      {statusFilter === 'linked' && (
                        <button
                          type="button"
                          disabled={rowJobActive}
                          onClick={() =>
                            handleUnlinkSplits(group.journal_ids, group.sample_description)
                          }
                          className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 disabled:opacity-50 text-slate-700 hover:text-rose-700 text-xs font-semibold"
                          title={
                            rowJobActive
                              ? 'Wait for active Firefly sync to finish before unlinking'
                              : 'Unlink locally and return to To Associate'
                          }
                        >
                          <Unlink className="w-3.5 h-3.5 mr-1" />
                          Unlink
                        </button>
                      )}
                      {statusFilter === 'ignored' && (
                        <button
                          type="button"
                          onClick={() => handleIgnoreSplits(group.journal_ids, false)}
                          className="inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold"
                          title="Restore to To Associate queue"
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-1" />
                          Restore
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="pl-2 sm:pl-5">
                      {expandedState.loading && !expandedState.data && (
                        <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-400">
                          Loading chains, stores, and individual splits...
                        </div>
                      )}
                      {expandedState.error && (
                        <div className="mt-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                          {expandedState.error}
                        </div>
                      )}
                      {expandedState.data && (
                        <BacklogSplitDrilldown
                          data={expandedState.data}
                          statusFilter={statusFilter}
                          rowJobActive={rowJobActive}
                          onQuickLink={handleQuickLink}
                          onOpenLinkModal={req => openLinkModal(group, req)}
                          onOpenNewItemModal={req =>
                            setCreateTarget({
                              initialName: group.sample_description,
                              categoryName: group.category_name,
                              sampleTags: group.sample_tags ?? [],
                              journalIds: req.journalIds,
                              aliasScope: req.aliasScope,
                            })
                          }
                          onIgnore={handleIgnoreSplits}
                          onUnlink={handleUnlinkSplits}
                          onPriceUpdated={() => refreshAfterMutation(true)}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Link to Existing Item Modal */}
      <BacklogLinkModal
        target={linkTarget}
        products={products}
        jobsByProductId={jobsByProductId}
        onClose={() => setLinkTarget(null)}
        onJobStarted={onJobStarted}
        onLinked={() => refreshAfterMutation(true)}
      />

      {/* Create New Item & Auto-Link Backlog Target */}
      <ItemEditorModal
        isOpen={createTarget !== null}
        initialName={createTarget?.initialName || ''}
        initialCategoryName={createTarget?.categoryName ?? null}
        initialTagNames={createTarget?.sampleTags ?? []}
        onClose={() => setCreateTarget(null)}
        onSaved={async created => {
          const target = createTarget;
          if (!target) return;
          setBanner(null);
          try {
            const job = await api.fireflySync.linkBacklog(
              created.id,
              target.journalIds,
              target.aliasScope
            );
            onJobStarted(job);
            await refreshAfterMutation(true);
          } catch (err) {
            await refreshAfterMutation(true);
            setBanner({
              type: 'error',
              text:
                err instanceof Error
                  ? err.message
                  : 'Item created, but starting Firefly sync failed.',
            });
          }
        }}
      />
    </div>
  );
};
