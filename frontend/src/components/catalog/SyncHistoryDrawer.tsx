import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCheck,
  History,
  RefreshCw,
  X,
} from 'lucide-react';
import { api } from '../../api/client';
import { isSyncJobActive, isSyncJobError } from '../../hooks/syncJobVisibility';
import { FireflySyncJob } from '../../types';
import { SyncHistoryItemRow } from './SyncHistoryItemRow';

type HistoryFilter = 'all' | 'errors';

interface SyncHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  liveJobs: FireflySyncJob[];
  hasDismissibleBanners: boolean;
  isDismissingAll: boolean;
  onDismissAll: () => void | Promise<void>;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export const SyncHistoryDrawer: React.FC<SyncHistoryDrawerProps> = ({
  isOpen,
  onClose,
  liveJobs,
  hasDismissibleBanners,
  isDismissingAll,
  onDismissAll,
  triggerRef,
}) => {
  const [historyJobs, setHistoryJobs] = useState<FireflySyncJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>('all');

  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);
  const loadSeqRef = useRef(0);

  const loadHistory = useCallback(async (silent: boolean = false) => {
    const seq = ++loadSeqRef.current;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const list = await api.fireflySync.listJobs(true, 50);
      if (seq !== loadSeqRef.current) return;
      setHistoryJobs(list);
      setError(null);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      if (!silent) {
        setError(
          err instanceof Error ? err.message : 'Failed to load sync history'
        );
      }
    } finally {
      if (seq === loadSeqRef.current && !silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
      closeButtonRef.current?.focus();
    } else if (wasOpenRef.current) {
      triggerRef?.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, loadHistory, triggerRef]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const liveSignature = useMemo(
    () =>
      liveJobs
        .map(j => `${j.id}:${j.status}:${j.processed_transactions}:${j.dismissed_at ?? ''}`)
        .join('|'),
    [liveJobs]
  );

  const prevLiveSignatureRef = useRef('');
  useEffect(() => {
    if (!isOpen) {
      prevLiveSignatureRef.current = liveSignature;
      return;
    }
    if (
      prevLiveSignatureRef.current !== '' &&
      prevLiveSignatureRef.current !== liveSignature
    ) {
      loadHistory(true);
    }
    prevLiveSignatureRef.current = liveSignature;
  }, [isOpen, liveSignature, loadHistory]);

  const mergedJobs = useMemo(() => {
    const byId = new Map<number, FireflySyncJob>();
    for (const job of historyJobs) {
      byId.set(job.id, job);
    }
    for (const job of liveJobs) {
      byId.set(job.id, job);
    }
    return Array.from(byId.values()).sort((a, b) => b.id - a.id);
  }, [historyJobs, liveJobs]);

  const errorJobsCount = useMemo(
    () => mergedJobs.filter(isSyncJobError).length,
    [mergedJobs]
  );
  const activeCount = useMemo(
    () => mergedJobs.filter(isSyncJobActive).length,
    [mergedJobs]
  );

  const visibleJobs = useMemo(
    () => (filter === 'errors' ? mergedJobs.filter(isSyncJobError) : mergedJobs),
    [filter, mergedJobs]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-history-drawer-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex justify-end"
    >
      <div className="w-full max-w-lg bg-slate-50 h-full shadow-2xl border-l border-slate-200 flex flex-col">
        <div className="bg-white border-b border-slate-200 px-4 sm:px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="sync-history-drawer-title"
              className="text-base font-bold text-slate-900 flex items-center gap-2"
            >
              <History className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Firefly Sync History</span>
              {activeCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  {activeCount} active
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Latest 50 background link and propagation jobs.
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => loadHistory()}
              disabled={loading}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50"
              aria-label="Refresh sync history"
              title="Refresh sync history"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              aria-label="Close sync history"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="bg-white border-b border-slate-200 px-4 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded-md transition ${
                filter === 'all'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({mergedJobs.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('errors')}
              className={`px-2.5 py-1 rounded-md transition ${
                filter === 'errors'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Errors &amp; Warnings ({errorJobsCount})
            </button>
          </div>

          {hasDismissibleBanners && (
            <button
              type="button"
              disabled={isDismissingAll}
              onClick={() => onDismissAll()}
              className="inline-flex items-center px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-50 text-xs font-semibold text-slate-700"
            >
              <CheckCheck className="w-3.5 h-3.5 mr-1 text-slate-500 shrink-0" />
              {isDismissingAll ? 'Clearing...' : 'Dismiss all banners'}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {loading && mergedJobs.length === 0 ? (
            <div
              className="space-y-3"
              role="status"
              aria-busy="true"
              aria-label="Loading sync history"
            >
              {Array.from({ length: 4 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-20 rounded-xl bg-slate-200/70 animate-pulse"
                />
              ))}
            </div>
          ) : error && mergedJobs.length === 0 ? (
            <div
              role="alert"
              className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 space-y-2"
            >
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Failed to load sync history</span>
              </div>
              <p>{error}</p>
              <button
                type="button"
                onClick={() => loadHistory()}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold"
              >
                Retry
              </button>
            </div>
          ) : visibleJobs.length === 0 ? (
            <div
              role="status"
              className="py-12 text-center space-y-2"
            >
              <History className="w-10 h-10 mx-auto text-slate-300" />
              <p className="text-sm font-medium text-slate-700">
                {filter === 'errors'
                  ? 'No sync errors recorded'
                  : 'No sync jobs recorded yet'}
              </p>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                {filter === 'errors'
                  ? 'All recent Firefly sync jobs completed without errors.'
                  : 'Link backlog entries or propagate item updates to Firefly III to see job history here.'}
              </p>
            </div>
          ) : (
            <ul role="list" className="space-y-2.5">
              {visibleJobs.map(job => (
                <SyncHistoryItemRow key={job.id} job={job} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
