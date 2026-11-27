import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { isSyncJobActive } from '../../hooks/syncJobVisibility';
import { FireflySyncJob } from '../../types';

interface SyncHistoryItemRowProps {
  job: FireflySyncJob;
}

function formatRelativeTime(isoString: string, nowMs: number = Date.now()): string {
  const ts = Date.parse(isoString);
  if (!Number.isFinite(ts)) return isoString;
  const diffSec = Math.max(0, Math.round((nowMs - ts) / 1000));
  if (diffSec < 45) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(ts).toLocaleDateString();
}

function getStatusBadge(job: FireflySyncJob) {
  if (isSyncJobActive(job)) {
    return {
      icon: <RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin shrink-0" />,
      label: job.status === 'queued' ? 'Queued' : 'Syncing',
      badgeClass: 'bg-blue-50 text-blue-800 border-blue-200',
    };
  }
  if (job.status === 'completed') {
    return {
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />,
      label: 'Completed',
      badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    };
  }
  if (job.status === 'completed_with_errors') {
    return {
      icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />,
      label: 'Completed with errors',
      badgeClass: 'bg-amber-50 text-amber-900 border-amber-200',
    };
  }
  return {
    icon: <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />,
    label: 'Failed',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-200',
  };
}

export const SyncHistoryItemRow: React.FC<SyncHistoryItemRowProps> = ({ job }) => {
  const [errorsExpanded, setErrorsExpanded] = useState(false);

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

  const refTimestamp = job.finished_at || job.created_at;
  const exactTimestamp = Number.isFinite(Date.parse(refTimestamp))
    ? new Date(refTimestamp).toLocaleString()
    : refTimestamp;

  const statusMeta = getStatusBadge(job);
  const hasErrorDetails =
    Boolean(job.error_message) || (job.failed_transactions?.length ?? 0) > 0;

  return (
    <li className="p-3.5 bg-white rounded-xl border border-slate-200 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-slate-900 truncate">
              {job.product_name}
            </span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              {job.job_type === 'backlog_link' ? 'Backlog Link' : 'Propagate'}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1">
            {active ? (
              <>
                {processedEntries} / {totalEntries} entries ({pct}%)
              </>
            ) : (
              <>
                {succeededEntries}/{totalEntries} entries synced
                {hasGroupedReceipts
                  ? ` across ${job.total_transactions} Firefly receipts`
                  : ''}
                {job.failed_count > 0 ? ` · ${job.failed_count} failed` : ''}
              </>
            )}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${statusMeta.badgeClass}`}
          >
            {statusMeta.icon}
            <span>{statusMeta.label}</span>
          </span>
          <time
            dateTime={refTimestamp}
            title={exactTimestamp}
            className="text-[11px] text-slate-400"
          >
            {formatRelativeTime(refTimestamp)}
          </time>
        </div>
      </div>

      {active && (
        <div className="w-full h-1.5 bg-blue-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all duration-300"
            style={{ width: `${Math.max(pct, 6)}%` }}
          />
        </div>
      )}

      {hasErrorDetails && (
        <div className="pt-1">
          <button
            type="button"
            aria-expanded={errorsExpanded}
            onClick={() => setErrorsExpanded(prev => !prev)}
            className="inline-flex items-center text-[11px] font-semibold text-rose-700 hover:text-rose-900"
          >
            {errorsExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 mr-1 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 mr-1 shrink-0" />
            )}
            {errorsExpanded ? 'Hide error details' : 'Show error details'}
          </button>

          {errorsExpanded && (
            <div className="mt-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-900 space-y-1 break-words">
              {job.error_message && <p className="font-medium">{job.error_message}</p>}
              {job.failed_transactions?.map(err => (
                <p key={err.firefly_transaction_id}>
                  <span className="font-semibold">tx #{err.firefly_transaction_id}:</span>{' '}
                  {err.error}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
};
