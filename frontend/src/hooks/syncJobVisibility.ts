import { FireflySyncJob } from '../types';

export const COMPLETED_BANNER_TTL_MS = 5 * 60 * 1000;

export const isSyncJobActive = (job: FireflySyncJob): boolean =>
  job.status === 'queued' || job.status === 'running';

export const isSyncJobError = (job: FireflySyncJob): boolean =>
  job.status === 'failed' || job.status === 'completed_with_errors';

export function getCompletedBannerExpiryMs(job: FireflySyncJob): number | null {
  if (job.status !== 'completed' || job.dismissed_at) {
    return null;
  }
  const refTimestamp = job.finished_at || job.created_at;
  if (!refTimestamp) {
    return null;
  }
  const parsedMs = Date.parse(refTimestamp);
  return Number.isFinite(parsedMs) ? parsedMs + COMPLETED_BANNER_TTL_MS : null;
}

export function isJobBannerVisible(
  job: FireflySyncJob,
  nowMs: number = Date.now()
): boolean {
  if (isSyncJobActive(job)) {
    return true;
  }
  if (job.dismissed_at) {
    return false;
  }
  if (job.status === 'completed') {
    const expiryMs = getCompletedBannerExpiryMs(job);
    return expiryMs !== null && nowMs <= expiryMs;
  }
  return true;
}

export function getNextBannerExpiryDelayMs(
  jobs: FireflySyncJob[],
  nowMs: number = Date.now()
): number | null {
  let earliestExpiryMs: number | null = null;
  for (const job of jobs) {
    const expiryMs = getCompletedBannerExpiryMs(job);
    if (expiryMs === null) {
      continue;
    }
    if (earliestExpiryMs === null || expiryMs < earliestExpiryMs) {
      earliestExpiryMs = expiryMs;
    }
  }
  if (earliestExpiryMs === null) {
    return null;
  }
  if (earliestExpiryMs < nowMs) {
    return 0;
  }
  // Small buffer ensures Date.now() is strictly past expiryMs when the timer runs.
  return earliestExpiryMs - nowMs + 50;
}

export function countUnacknowledgedErrors(jobs: FireflySyncJob[]): number {
  return jobs.filter(job => !job.dismissed_at && isSyncJobError(job)).length;
}

export function hasDismissibleFinishedJobs(jobs: FireflySyncJob[]): boolean {
  return jobs.some(job => !isSyncJobActive(job) && !job.dismissed_at);
}
