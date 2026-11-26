import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  EyeOff,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Unlink,
} from 'lucide-react';
import { api } from '../../api/client';
import { isSyncJobActive } from '../../hooks/useFireflySyncJobs';
import {
  BacklogGroup,
  BacklogResponse,
  BacklogStatusFilter,
  FireflySyncJob,
  FireflySyncStatus,
  Product,
} from '../../types';
import { ItemEditorModal } from './ItemEditorModal';
import { SyncJobBadge } from './SyncJobBadge';

interface FireflyBacklogTabProps {
  products: Product[];
  jobs: FireflySyncJob[];
  jobsByProductId: Record<number, FireflySyncJob>;
  onJobStarted: (job: FireflySyncJob) => void;
  onDismissJob: (jobId: number) => void;
  onDataChanged: () => void | Promise<void>;
  onUnassociatedCountChange?: (count: number) => void;
}

export const FireflyBacklogTab: React.FC<FireflyBacklogTabProps> = ({
  products,
  jobs,
  jobsByProductId,
  onJobStarted,
  onDismissJob,
  onDataChanged,
  onUnassociatedCountChange,
}) => {
  const [status, setStatus] = useState<FireflySyncStatus | null>(null);
  const [backlog, setBacklog] = useState<BacklogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingMode, setSyncingMode] = useState<'incremental' | 'full' | null>(null);
  const [requiresInitialFullSync, setRequiresInitialFullSync] = useState(false);

  const [statusFilter, setStatusFilter] = useState<BacklogStatusFilter>('unassociated');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Link-to-existing modal state
  const [linkingGroup, setLinkingGroup] = useState<BacklogGroup | null>(null);
  const [linkSearch, setLinkSearch] = useState('');
  const [selectedLinkProductId, setSelectedLinkProductId] = useState<number | null>(null);
  const [submittingLink, setSubmittingLink] = useState(false);

  // Create-new-item-and-link modal state
  const [creatingFromGroup, setCreatingFromGroup] = useState<BacklogGroup | null>(null);

  const loadStatusAndBacklog = useCallback(
    async (silent: boolean = false) => {
      if (!silent) setLoading(true);
      try {
        const [statusData, backlogData] = await Promise.all([
          api.fireflySync.getStatus(),
          api.fireflySync.getBacklog({
            status: statusFilter,
            category: selectedCategory,
            search: search.trim() || undefined,
          }),
        ]);
        setStatus(statusData);
        setBacklog(backlogData);
        setRequiresInitialFullSync(!statusData.last_full_sync_at);
        onUnassociatedCountChange?.(backlogData.total_unassociated);
      } catch (err) {
        if (!silent) {
          setBanner({
            type: 'error',
            text: err instanceof Error ? err.message : 'Failed to load backlog',
          });
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [statusFilter, selectedCategory, search, onUnassociatedCountChange]
  );

  useEffect(() => {
    loadStatusAndBacklog();
  }, [loadStatusAndBacklog]);

  // Keep To Associate / Associated counts & rows fresh while SSE jobs run or finish
  const prevJobSignatureRef = useRef<string>('');
  const lastBacklogSilentRefreshRef = useRef<number>(0);
  useEffect(() => {
    const signature = jobs
      .map(j => `${j.id}:${j.status}:${j.updated_transactions}`)
      .join('|');
    if (prevJobSignatureRef.current === signature) return;
    const hadPrev = prevJobSignatureRef.current !== '';
    prevJobSignatureRef.current = signature;
    if (!hadPrev) return;

    const anyActive = jobs.some(isSyncJobActive);
    const now = Date.now();
    if (!anyActive || now - lastBacklogSilentRefreshRef.current >= 4000) {
      lastBacklogSilentRefreshRef.current = now;
      loadStatusAndBacklog(true);
    }
  }, [jobs, loadStatusAndBacklog]);

  // Run lightweight incremental sync on mount/open after initial cache renders
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
          loadStatusAndBacklog();
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

  const handleIgnoreGroup = async (group: BacklogGroup, ignored: boolean = true) => {
    setBanner(null);
    try {
      await api.fireflySync.ignoreBacklog(group.journal_ids, ignored);
      await loadStatusAndBacklog();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update entry',
      });
    }
  };

  const handleUnlinkGroup = async (group: BacklogGroup) => {
    setBanner(null);
    try {
      await api.fireflySync.unlinkBacklog(group.journal_ids);
      await Promise.all([loadStatusAndBacklog(), Promise.resolve(onDataChanged())]);
      setBanner({
        type: 'success',
        text: `Unlinked "${group.sample_description}" back to the unassociated queue.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to unlink entry',
      });
    }
  };

  const openLinkModal = (group: BacklogGroup) => {
    setLinkingGroup(group);
    setLinkSearch('');
    setSelectedLinkProductId(group.suggested_product_id ?? null);
  };

  const handleConfirmLink = async () => {
    if (!linkingGroup || !selectedLinkProductId) return;
    setSubmittingLink(true);
    setBanner(null);
    try {
      const job = await api.fireflySync.linkBacklog(
        selectedLinkProductId,
        linkingGroup.journal_ids
      );
      onJobStarted(job);
      setLinkingGroup(null);
      await Promise.all([loadStatusAndBacklog(true), Promise.resolve(onDataChanged())]);
      setBanner({
        type: 'success',
        text: `Started background sync for "${job.product_name}" (${job.total_transactions} Firefly transaction(s)). Watch live progress below or on the catalog card.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to link transactions',
      });
    } finally {
      setSubmittingLink(false);
    }
  };

  const filteredModalProducts = products.filter(p =>
    linkSearch.trim()
      ? p.name.toLowerCase().includes(linkSearch.trim().toLowerCase())
      : true
  );

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
          className={`p-3 rounded-xl border text-xs flex items-center ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          {banner.type === 'success' && <CheckCircle2 className="w-4 h-4 mr-2 shrink-0" />}
          <span>{banner.text}</span>
        </div>
      )}

      {/* Status Segmentation + Category Filter Pills */}
      {backlog && (
        <div className="space-y-3">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setStatusFilter('unassociated');
                setSelectedCategory(null);
              }}
              className={`px-3 py-1.5 rounded-lg transition ${
                statusFilter === 'unassociated'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              To Associate ({backlog.total_unassociated})
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('linked');
                setSelectedCategory(null);
              }}
              className={`px-3 py-1.5 rounded-lg transition ${
                statusFilter === 'linked'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Associated ({backlog.linked_count})
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('ignored');
                setSelectedCategory(null);
              }}
              className={`px-3 py-1.5 rounded-lg transition ${
                statusFilter === 'ignored'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Ignored ({backlog.ignored_count})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedCategory(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                selectedCategory === null
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              All Categories (
              {statusFilter === 'linked'
                ? backlog.linked_count
                : statusFilter === 'ignored'
                ? backlog.ignored_count
                : backlog.total_unassociated}
              )
            </button>
            {backlog.category_counts.map(cat => {
              const key = cat.category_name === null ? '__uncategorized__' : cat.category_name;
              const active = selectedCategory === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedCategory(active ? null : key)}
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
        </div>
      )}

      {/* Active & Recent Firefly Sync Jobs */}
      {jobs.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700">
            <span>
              Firefly Background Sync Status ({jobs.filter(isSyncJobActive).length} active)
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {jobs.map(job => (
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
          placeholder="Search unassociated Firefly descriptions (e.g. mele, barilla)..."
          className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Grouped Backlog List */}
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">
            Loading Firefly backlog...
          </div>
        ) : !backlog || backlog.groups.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">
            No unassociated Firefly entries match this filter.
          </div>
        ) : (
          backlog.groups.map(group => {
            const groupJidSet = new Set(group.journal_ids);
            const matchingJob =
              (group.linked_product_id && jobsByProductId[group.linked_product_id]) ||
              jobs.find(j => j.target_journal_ids.some(jid => groupJidSet.has(jid))) ||
              null;
            const rowJobActive = matchingJob ? isSyncJobActive(matchingJob) : false;
            return (
              <div
                key={`${group.normalized_description}::${group.category_name ?? ''}::${group.linked_product_id ?? ''}`}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition"
              >
                <div className="min-w-0 space-y-1 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900">
                      {group.sample_description}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[11px] font-bold">
                      {group.occurrence_count}×
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-medium">
                      {group.category_name || 'Uncategorized'}
                    </span>
                    {group.linked_product_name && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold">
                        → {group.linked_product_name}
                      </span>
                    )}
                    {group.suggested_product_name && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-medium">
                        <Sparkles className="w-3 h-3 mr-1" />
                        Match: {group.suggested_product_name}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>
                      Total: <strong>€{group.total_amount.toFixed(2)}</strong>
                    </span>
                    <span>Latest: {group.latest_date}</span>
                    {group.sample_stores.length > 0 && (
                      <span>Stores: {group.sample_stores.join(', ')}</span>
                    )}
                  </div>
                  {group.sample_tags && group.sample_tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
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
                  {matchingJob && (statusFilter === 'linked' || rowJobActive) && (
                    <div className="pt-1.5 max-w-md">
                      <SyncJobBadge
                        job={matchingJob}
                        onDismiss={onDismissJob}
                        compact
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
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
                        onClick={() => setCreatingFromGroup(group)}
                        className="inline-flex items-center px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 text-emerald-700 text-xs font-semibold"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        New Item
                      </button>
                      <button
                        type="button"
                        disabled={rowJobActive}
                        onClick={() => handleIgnoreGroup(group, true)}
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
                      onClick={() => handleUnlinkGroup(group)}
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
                      onClick={() => handleIgnoreGroup(group, false)}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold"
                      title="Restore to To Associate queue"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" />
                      Restore
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Link to Existing Item Modal */}
      {linkingGroup && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-xl border border-slate-200 space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Link Firefly Entry to Canonical Item
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Linking <strong>"{linkingGroup.sample_description}"</strong> (
                {linkingGroup.occurrence_count} occurrence(s)) will rewrite those Firefly
                splits with the chosen item&apos;s name, category, and expanded tags.
              </p>
            </div>

            <input
              type="text"
              autoFocus
              value={linkSearch}
              onChange={e => setLinkSearch(e.target.value)}
              placeholder="Search existing items..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />

            <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
              {filteredModalProducts.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">
                  No matching items in catalog.
                </div>
              ) : (
                filteredModalProducts.map(prod => {
                  const selected = selectedLinkProductId === prod.id;
                  return (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => setSelectedLinkProductId(prod.id)}
                      className={`w-full text-left px-3 py-2.5 text-xs flex items-center justify-between transition ${
                        selected ? 'bg-blue-50 text-blue-900' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div>
                        <div className="font-semibold">{prod.name}</div>
                        <div className="text-[11px] text-slate-400">
                          {prod.firefly_category_name || 'No category'}
                        </div>
                      </div>
                      {selected && (
                        <span className="text-[11px] font-bold text-blue-600">Selected</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setLinkingGroup(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!selectedLinkProductId || submittingLink}
                onClick={handleConfirmLink}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-semibold"
              >
                {submittingLink ? 'Linking & Updating Firefly...' : 'Link & Rewrite Firefly'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create New Item & Auto-Link Backlog Group */}
      <ItemEditorModal
        isOpen={creatingFromGroup !== null}
        initialName={creatingFromGroup?.sample_description || ''}
        initialCategoryName={creatingFromGroup?.category_name ?? null}
        initialTagNames={creatingFromGroup?.sample_tags ?? []}
        onClose={() => setCreatingFromGroup(null)}
        onSaved={async created => {
          const targetGroup = creatingFromGroup;
          if (!targetGroup) return;
          setBanner(null);
          try {
            const job = await api.fireflySync.linkBacklog(
              created.id,
              targetGroup.journal_ids
            );
            onJobStarted(job);
            await Promise.all([loadStatusAndBacklog(true), Promise.resolve(onDataChanged())]);
            setBanner({
              type: 'success',
              text: `Created "${created.name}" and started background Firefly sync (${job.total_transactions} transaction(s)). Watch live progress below or on the catalog card.`,
            });
          } catch (err) {
            await Promise.all([loadStatusAndBacklog(true), Promise.resolve(onDataChanged())]);
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
