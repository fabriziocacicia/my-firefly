import React from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, X, XCircle } from 'lucide-react';
import { FireflySyncJob } from '../../types';
import { isSyncJobActive } from '../../hooks/useFireflySyncJobs';

interface SyncJobBadgeProps {
  job: FireflySyncJob;
  onDismiss?: (jobId: number) => void;
  showProductName?: boolean;
  compact?: boolean;
}

export const SyncJobBadge: React.FC<SyncJobBadgeProps> = ({
  job,
  onDismiss,
  showProductName = false,
  compact = false,
}) => {
  const active = isSyncJobActive(job);
  const totalTx = Math.max(job.total_transactions, 1);
  const pct = active
    ? Math.min(100, Math.round((job.processed_transactions / totalTx) * 100))
    : 100;
  const firstError = job.failed_transactions?.[0];
  const errorText = job.error_message
    ? job.error_message
    : firstError
    ? `tx #${firstError.firefly_transaction_id}: ${firstError.error}`
    : null;

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
                ? `Queued (${job.total_transactions} tx)`
                : `Syncing Firefly ${job.processed_transactions} / ${job.total_transactions} tx`}
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
            Synced {job.updated_transactions} Firefly tx ({job.linked_splits} splits)
          </span>
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={() => onDismiss(job.id)}
            className="p-0.5 rounded hover:bg-emerald-100 text-emerald-600 shrink-0"
            title="Dismiss status"
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
          {job.updated_transactions}/{job.total_transactions} tx synced ·{' '}
          {job.failed_count} failed
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
          title="Dismiss status"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
