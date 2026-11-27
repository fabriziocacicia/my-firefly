import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../../api/client';
import {
  FireflySyncJob,
  ImplicationImpactResponse,
  Tag,
  TagImplication,
} from '../../types';
import { TagCombobox } from '../common/TagCombobox';
import { getEffectiveTagsForIds } from '../workbench/productUtils';

interface TagHierarchyTabProps {
  tags: Tag[];
  implications: TagImplication[];
  onRefresh: () => Promise<void>;
  onJobsStarted?: (jobs: FireflySyncJob[]) => void;
}

export const TagHierarchyTab: React.FC<TagHierarchyTabProps> = ({
  tags,
  implications,
  onRefresh,
  onJobsStarted,
}) => {
  const modalTitleId = useId();

  const [syncing, setSyncing] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);

  const [childTagId, setChildTagId] = useState<number | null>(null);
  const [parentTagId, setParentTagId] = useState<number | null>(null);
  const [savingEdge, setSavingEdge] = useState(false);
  const [deletingEdgeKey, setDeletingEdgeKey] = useState<string | null>(null);
  const [pendingImpact, setPendingImpact] = useState<ImplicationImpactResponse | null>(null);
  const [applyingImpact, setApplyingImpact] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const tagsById = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags]);

  useEffect(() => {
    if (!pendingImpact) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !applyingImpact) {
        setPendingImpact(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingImpact, applyingImpact]);

  const handleSyncTags = async () => {
    setSyncing(true);
    setBanner(null);
    try {
      const res = await api.tags.syncFirefly();
      await onRefresh();
      setBanner({
        type: 'success',
        text: `Synced ${res.synced_count} Firefly tags (${res.created_count} new, ${res.updated_count} updated).`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to sync Firefly tags',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;
    setCreatingTag(true);
    setBanner(null);
    try {
      const created = await api.tags.create({ name: newTagName.trim() });
      setNewTagName('');
      await onRefresh();
      setBanner({
        type: 'success',
        text: `Tag "${created.name}" synced with Firefly ID #${created.firefly_tag_id ?? '—'}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to create tag',
      });
    } finally {
      setCreatingTag(false);
    }
  };

  const applyImplicationChange = async (
    impact: ImplicationImpactResponse,
    syncFirefly: boolean
  ) => {
    setApplyingImpact(true);
    setBanner(null);
    try {
      if (impact.action === 'add') {
        await api.tags.createImplication(impact.child_tag_id, impact.parent_tag_id);
        setChildTagId(null);
        setParentTagId(null);
      } else {
        await api.tags.deleteImplication(impact.child_tag_id, impact.parent_tag_id);
      }

      let startedCount = 0;
      let skippedCount = 0;
      if (syncFirefly) {
        const targetProductIds = impact.affected_items
          .filter(item => item.affected_firefly_transactions > 0)
          .map(item => item.product_id);
        if (targetProductIds.length > 0) {
          const batch = await api.products.propagateFireflyBatch(targetProductIds);
          startedCount = batch.jobs.length;
          skippedCount = batch.skipped_active_product_ids.length;
          if (batch.jobs.length > 0) {
            onJobsStarted?.(batch.jobs);
          }
        }
      }

      setPendingImpact(null);
      await onRefresh();

      const actionLabel =
        impact.action === 'add'
          ? `Rule "${impact.child_tag_name} -> ${impact.parent_tag_name}" saved`
          : `Rule "${impact.child_tag_name} -> ${impact.parent_tag_name}" removed`;
      if (syncFirefly && startedCount > 0) {
        const skippedSuffix =
          skippedCount > 0
            ? ` (${skippedCount} item(s) already had an active sync job)`
            : '';
        setBanner({
          type: 'success',
          text: `${actionLabel}. Firefly sync started for ${startedCount} item(s)${skippedSuffix}.`,
        });
      } else if (syncFirefly && skippedCount > 0) {
        setBanner({
          type: 'success',
          text: `${actionLabel}. Affected items already had active Firefly sync jobs.`,
        });
      } else {
        setBanner({
          type: 'success',
          text:
            impact.total_affected_splits > 0
              ? `${actionLabel} locally. Linked Firefly items can still be synced from the Catalog tab.`
              : `${actionLabel}.`,
        });
      }
      setModalError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to apply implication change';
      if (pendingImpact) {
        setModalError(message);
      } else {
        setBanner({ type: 'error', text: message });
      }
    } finally {
      setApplyingImpact(false);
    }
  };

  const initiateImplicationChange = async (
    action: 'add' | 'remove',
    childId: number,
    parentId: number
  ) => {
    setBanner(null);
    setModalError(null);
    const impact = await api.tags.previewImplicationImpact(action, childId, parentId);
    if (impact.total_affected_items === 0) {
      await applyImplicationChange(impact, false);
    } else {
      setPendingImpact(impact);
    }
  };

  const handleAddImplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (childTagId == null || parentTagId == null) return;
    setSavingEdge(true);
    try {
      await initiateImplicationChange('add', childTagId, parentTagId);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to check implication impact',
      });
    } finally {
      setSavingEdge(false);
    }
  };

  const handleDeleteImplication = async (childId: number, parentId: number) => {
    const key = `${childId}-${parentId}`;
    setDeletingEdgeKey(key);
    try {
      await initiateImplicationChange('remove', childId, parentId);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to check implication impact',
      });
    } finally {
      setDeletingEdgeKey(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            Firefly III Tag Sync &amp; Implication Hierarchy
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Define semantic rules like <strong>Mele → Frutta</strong> on top of permanent
            Firefly tag IDs. Items tagged with <strong>Mele</strong> automatically inherit{' '}
            <strong>Frutta</strong> on Firefly III and in companion analytics.
          </p>
        </div>

        <button
          type="button"
          disabled={syncing}
          onClick={handleSyncTags}
          className="inline-flex items-center px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync Tags from Firefly'}
        </button>
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Add Implication Rule + Create Tag */}
        <div className="space-y-4">
          <form
            onSubmit={handleAddImplication}
            className="bg-white rounded-xl border border-slate-200 p-4 space-y-3"
          >
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Add Implication Rule (Child → Parent)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-11 gap-2 items-center">
              <TagCombobox
                tags={tags}
                value={childTagId}
                excludeTagId={parentTagId}
                onChange={setChildTagId}
                onTagCreated={() => {
                  onRefresh();
                }}
                placeholder="Child tag (e.g. Mele)..."
                ariaLabel="Child tag"
                className="sm:col-span-5"
              />
              <div className="sm:col-span-1 flex justify-center text-slate-400">
                <ArrowRight className="w-4 h-4" />
              </div>
              <TagCombobox
                tags={tags}
                value={parentTagId}
                excludeTagId={childTagId}
                onChange={setParentTagId}
                onTagCreated={() => {
                  onRefresh();
                }}
                placeholder="Implies parent (e.g. Frutta)..."
                ariaLabel="Parent tag"
                className="sm:col-span-5"
              />
            </div>
            <button
              type="submit"
              disabled={savingEdge || childTagId == null || parentTagId == null}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-semibold"
            >
              {savingEdge ? 'Saving...' : 'Add Implication'}
            </button>
          </form>

          <form
            onSubmit={handleCreateTag}
            className="bg-white rounded-xl border border-slate-200 p-4 space-y-3"
          >
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Create Tag in Firefly III
            </h3>
            <div className="flex space-x-2">
              <input
                type="text"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                placeholder="New tag name (e.g. Bio, Frutta, Mele)..."
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
              <button
                type="submit"
                disabled={creatingTag || !newTagName.trim()}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-lg text-xs font-semibold inline-flex items-center"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                {creatingTag ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>

          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Active Implication Rules ({implications.length})
            </h3>
            {implications.length === 0 ? (
              <p className="text-xs text-slate-400">No hierarchy rules defined yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {implications.map(imp => {
                  const child = tagsById.get(imp.child_tag_id);
                  const parent = tagsById.get(imp.parent_tag_id);
                  return (
                    <div
                      key={`${imp.child_tag_id}-${imp.parent_tag_id}`}
                      className="py-2 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-slate-800 bg-blue-50 px-2 py-0.5 rounded">
                          {child?.name || `#${imp.child_tag_id}`}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                          {parent?.name || `#${imp.parent_tag_id}`}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={
                          deletingEdgeKey === `${imp.child_tag_id}-${imp.parent_tag_id}`
                        }
                        onClick={() =>
                          handleDeleteImplication(imp.child_tag_id, imp.parent_tag_id)
                        }
                        className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 disabled:opacity-40"
                        title="Remove rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* All Synced Tags & Transitive Ancestors */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
            Synced Firefly Tags ({tags.length})
          </h3>
          {tags.length === 0 ? (
            <p className="text-xs text-slate-400">
              No tags found. Click &quot;Sync Tags from Firefly&quot; to pull tags.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
              {tags.map(t => {
                const { implied } = getEffectiveTagsForIds([t.id], tags, implications);
                return (
                  <div
                    key={t.id}
                    className="py-2.5 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-900">{t.name}</span>
                      <span className="ml-2 text-[10px] text-slate-400 font-mono">
                        {t.firefly_tag_id ? `FF #${t.firefly_tag_id}` : 'Local only'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {implied.map(anc => (
                        <span
                          key={anc.id}
                          className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
                        >
                          → {anc.name}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {pendingImpact && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalTitleId}
          onClick={e => {
            if (e.target === e.currentTarget && !applyingImpact) {
              setPendingImpact(null);
            }
          }}
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div className="p-2 rounded-lg bg-amber-50 text-amber-700 shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 id={modalTitleId} className="text-base font-bold text-slate-900">
                    {pendingImpact.action === 'add'
                      ? 'Confirm Implication Rule & Firefly Sync'
                      : 'Confirm Rule Removal & Firefly Sync'}
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {pendingImpact.action === 'add' ? 'Adding' : 'Removing'}{' '}
                    <strong>{pendingImpact.child_tag_name}</strong>{' '}
                    <ArrowRight className="w-3 h-3 inline mx-0.5 text-slate-400" />{' '}
                    <strong>{pendingImpact.parent_tag_name}</strong> affects{' '}
                    <strong>{pendingImpact.total_affected_items}</strong> catalog item(s)
                    {pendingImpact.total_affected_splits > 0
                      ? ` and ${pendingImpact.total_affected_splits} Firefly split(s) across ${pendingImpact.total_affected_transactions} transaction(s).`
                      : ' (no linked Firefly splits).'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={applyingImpact}
                onClick={() => setPendingImpact(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 disabled:opacity-40"
                aria-label="Close impact confirmation modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
              {pendingImpact.affected_items.map(item => (
                <div
                  key={item.product_id}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">
                      {item.product_name}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      {item.before_tags.length > 0 ? item.before_tags.join(', ') : '—'} →{' '}
                      <span className="font-medium text-slate-800">
                        {item.after_tags.length > 0 ? item.after_tags.join(', ') : '—'}
                      </span>
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    {item.has_active_sync_job && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                        Sync active
                      </span>
                    )}
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      {item.affected_firefly_splits > 0
                        ? `${item.affected_firefly_splits} split${item.affected_firefly_splits === 1 ? '' : 's'}`
                        : 'Local only'}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {modalError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {modalError}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={applyingImpact}
                onClick={() => setPendingImpact(null)}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
              >
                Cancel
              </button>

              {pendingImpact.total_affected_splits > 0 ? (
                <>
                  <button
                    type="button"
                    disabled={applyingImpact}
                    onClick={() => applyImplicationChange(pendingImpact, false)}
                    className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Save Rule Only
                  </button>
                  <button
                    type="button"
                    disabled={applyingImpact}
                    onClick={() => applyImplicationChange(pendingImpact, true)}
                    className="inline-flex items-center px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 mr-1.5 ${applyingImpact ? 'animate-spin' : ''}`}
                    />
                    {applyingImpact
                      ? 'Syncing...'
                      : `Confirm & Sync ${pendingImpact.total_affected_splits} Split(s)`}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={applyingImpact}
                  onClick={() => applyImplicationChange(pendingImpact, false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white"
                >
                  {applyingImpact ? 'Applying...' : 'Confirm'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
