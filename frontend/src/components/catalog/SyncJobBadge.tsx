import React from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, X, XCircle } from 'lucide-react';
import { FireflySyncJob } from '../../types';
import { isSyncJobActive } from '../../hooks/useFireflySyncJobs';

interface SyncJobBadgeProps {
  job: FireflySyncJob;
  onDismiss?: (jobId: number) => void;
  showProductName?: boolean;
  compact?: boolean;
  variant?: 'card' | 'inline';
}

export const SyncJobBadge: React.FC<SyncJobBadgeProps> = ({
  job,
  onDismiss,
  showProductName = false,
  compact = false,
  variant = 'card',
}) => {
  const active = isSyncJobActive(job);
  const totalEntries = job.total_splits > 0 ? job.total_splits : job.total_transactions;
  const processedEntries =
    job.total_splits > 0 ? job.processed_splits : job.processed_transactions;
  const succeededEntries =
    job.total_splits > 0 ? job.linked_splits : job.updated_transactions;
  const pct = active
    ? Math.min(100, Math.round((processedEntries / Math.max(totalEntries, 1)) * 100))
    : 100;
  const hasGroupedReceipts =
    job.total_transactions > 0 && job.total_transactions !== totalEntries;
  const receiptHint = hasGroupedReceipts
    ? `across ${job.total_transactions} Firefly receipts`
    : undefined;

  const firstError = job.failed_transactions?.[0];
  const errorText = job.error_message
    ? job.error_message
    : firstError
    ? `tx #${firstError.firefly_transaction_id}: ${firstError.error}`
    : null;

  if (variant === 'inline') {
    if (active) {
      return (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-semibold"
          title={receiptHint}
        >
          <RefreshCw className="w-3 h-3 mr-1 text-blue-600 animate-spin shrink-0" />
          {job.status === 'queued'
            ? `Queued (${totalEntries})`
            : `Syncing ${processedEntries}/${totalEntries}`}
        </span>
      );
    }

    if (job.status === 'completed') {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-semibold"
          title={
            hasGroupedReceipts
              ? `Synced ${succeededEntries} entries (${receiptHint})`
              : `Synced ${succeededEntries} entries`
          }
        >
          <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
          <span>{succeededEntries} synced</span>
          {onDismiss && (
            <button
              type="button"
              onClick={() => onDismiss(job.id)}
              className="p-0.5 -mr-1 rounded-full hover:bg-emerald-100 text-emerald-600"
              aria-label="Dismiss sync status"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </span>
      );
    }

    const isPartial = job.status === 'completed_with_errors';
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${
          isPartial
            ? 'bg-amber-50 border-amber-200 text-amber-900'
            : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}
        title={errorText || undefined}
      >
        {isPartial ? (
          <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
        ) : (
          <XCircle className="w-3 h-3 text-rose-600 shrink-0" />
        )}
        <span>
          {succeededEntries}/{totalEntries} synced · {job.failed_count} failed
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={() => onDismiss(job.id)}
            className={`p-0.5 -mr-1 rounded-full ${
              isPartial
                ? 'hover:bg-amber-100 text-amber-700'
                : 'hover:bg-rose-100 text-rose-700'
            }`}
            aria-label="Dismiss sync status"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        )}
      </span>
    );
  }

  if (active) {
    return (
      <div
        className={`rounded-lg border border-blue-200 bg-blue-50/90 text-blue-900 ${
          compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
        } space-y-1.5`}
      >
        <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
          <span className="inline-flex items-center min-w-0 truncate">
            <RefreshCw className="w-3 h-3 mr-1.5 text-blue-600 animate-spin shrink-0" />
            <span className="truncate">
              {showProductName ? `${job.product_name}: ` : ''}
              {job.status === 'queued'
                ? `Queued ${totalEntries} entries`
                : `Syncing ${processedEntries} / ${totalEntries} entries`}
            </span>
          </span>
          <span className="shrink-0 font-bold text-blue-700">
            {pct}%{job.failed_count > 0 ? ` · ${job.failed_count} err` : ''}
          </span>
        </div>
        <div className="w-full h-1.5 bg-blue-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all duration-300"
            style={{ width: `${Math.max(pct, 6)}%` }}
          />
        </div>
      </div>
    );
  }

  if (job.status === 'completed') {
    return (
      <div
        className={`rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 ${
          compact ? 'px-2.5 py-1.5' : 'px-3 py-2'
        } flex items-center justify-between gap-2 text-[11px]`}
      >
        <span className="inline-flex items-center min-w-0">
          <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-600 shrink-0" />
          <span className="truncate font-medium">
            {showProductName ? <strong>{job.product_name}: </strong> : null}
            {succeededEntries} entries synced
            {hasGroupedReceipts && (
              <span className="text-emerald-700/75 ml-1">
                ({receiptHint})
              </span>
            )}
          </span>
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={() => onDismiss(job.id)}
            className="p-0.5 rounded hover:bg-emerald-100 text-emerald-600 shrink-0"
            aria-label="Dismiss sync status"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  const isPartial = job.status === 'completed_with_errors';
  return (
    <div
      className={`rounded-lg border ${
        isPartial
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-rose-200 bg-rose-50 text-rose-800'
      } ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} flex items-start justify-between gap-2 text-[11px]`}
    >
      <span className="inline-flex items-start min-w-0">
        {isPartial ? (
          <AlertTriangle className="w-3.5 h-3.5 mr-1.5 mt-0.5 text-amber-600 shrink-0" />
        ) : (
          <XCircle className="w-3.5 h-3.5 mr-1.5 mt-0.5 text-rose-600 shrink-0" />
        )}
        <span className="min-w-0 break-words">
          {showProductName ? <strong>{job.product_name}: </strong> : null}
          {succeededEntries}/{totalEntries} entries synced · {job.failed_count} receipt error(s)
          {errorText ? ` (${errorText})` : ''}
        </span>
      </span>
      {onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(job.id)}
          className={`p-0.5 rounded shrink-0 ${
            isPartial
              ? 'hover:bg-amber-100 text-amber-700'
              : 'hover:bg-rose-100 text-rose-700'
          }`}
          aria-label="Dismiss sync status"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
