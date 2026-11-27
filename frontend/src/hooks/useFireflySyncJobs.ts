import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { FireflySyncJob } from '../types';
import {
  countUnacknowledgedErrors,
  getNextBannerExpiryDelayMs,
  isJobBannerVisible,
  isSyncJobActive,
} from './syncJobVisibility';

export { isSyncJobActive };

function mergeJobs(
  prev: FireflySyncJob[],
  incoming: FireflySyncJob[],
  dismissedIds: Set<number>,
  nowMs: number = Date.now()
): FireflySyncJob[] {
  const byId = new Map<number, FireflySyncJob>();
  for (const job of prev) {
    if (!dismissedIds.has(job.id) && isJobBannerVisible(job, nowMs)) {
      byId.set(job.id, job);
    }
  }
  for (const job of incoming) {
    if (dismissedIds.has(job.id) || !isJobBannerVisible(job, nowMs)) {
      byId.delete(job.id);
    } else {
      byId.set(job.id, job);
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.id - a.id);
}

interface UseFireflySyncJobsOptions {
  onJobsChanged?: (isFinalUpdate: boolean) => void | Promise<void>;
}

export function useFireflySyncJobs(options?: UseFireflySyncJobsOptions) {
  const [jobs, setJobs] = useState<FireflySyncJob[]>([]);
  const [isDismissingAll, setIsDismissingAll] = useState(false);
  const onJobsChangedRef = useRef(options?.onJobsChanged);
  onJobsChangedRef.current = options?.onJobsChanged;

  const prevActiveIdsRef = useRef<Set<number>>(new Set());
  const dismissedIdsRef = useRef<Set<number>>(new Set());
  const registeredAtRef = useRef<number>(0);
  const lastSilentRefreshRef = useRef<number>(0);

  const applyJobList = useCallback((nextList: FireflySyncJob[], emitRefresh: boolean, mergeWithRegistered: boolean = false) => {
    const nowMs = Date.now();
    const filtered = nextList.filter(
      j => !dismissedIdsRef.current.has(j.id) && isJobBannerVisible(j, nowMs)
    );
    setJobs(prev =>
      mergeWithRegistered ? mergeJobs(prev, filtered, dismissedIdsRef.current, nowMs) : filtered
    );

    const nextActiveIds = new Set(filtered.filter(isSyncJobActive).map(j => j.id));
    let anyJustFinished = false;
    for (const prevId of prevActiveIdsRef.current) {
      if (!nextActiveIds.has(prevId)) {
        anyJustFinished = true;
        break;
      }
    }
    prevActiveIdsRef.current = nextActiveIds;

    if (!emitRefresh) return;
    if (anyJustFinished) {
      lastSilentRefreshRef.current = Date.now();
      Promise.resolve(onJobsChangedRef.current?.(true)).catch(() => {});
    } else if (nextActiveIds.size > 0) {
      const now = Date.now();
      if (now - lastSilentRefreshRef.current >= 4500) {
        lastSilentRefreshRef.current = now;
        Promise.resolve(onJobsChangedRef.current?.(false)).catch(() => {});
      }
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    const startedAt = Date.now();
    try {
      const list = await api.fireflySync.listJobs(false);
      applyJobList(list, false, registeredAtRef.current > startedAt);
    } catch (err) {
      console.error('Failed to load Firefly sync jobs', err);
    }
  }, [applyJobList]);

  useEffect(() => {
    refreshJobs();
  }, [refreshJobs]);

  // Automatically clear completed inline banners once their 5-minute TTL elapses.
  useEffect(() => {
    const delayMs = getNextBannerExpiryDelayMs(jobs);
    if (delayMs === null) {
      return;
    }
    const timerId = window.setTimeout(() => {
      const nowMs = Date.now();
      setJobs(prev => prev.filter(job => isJobBannerVisible(job, nowMs)));
    }, delayMs);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [jobs]);

  const registerJob = useCallback((job: FireflySyncJob) => {
    registeredAtRef.current = Date.now();
    dismissedIdsRef.current.delete(job.id);
    setJobs(prev => {
      const merged = mergeJobs(prev, [job], dismissedIdsRef.current);
      if (isSyncJobActive(job)) {
        prevActiveIdsRef.current.add(job.id);
      }
      return merged;
    });
  }, []);

  const dismissJob = useCallback(
    async (jobId: number) => {
      dismissedIdsRef.current.add(jobId);
      setJobs(prev => prev.filter(j => j.id !== jobId));
      try {
        await api.fireflySync.dismissJob(jobId);
      } catch (err) {
        console.error('Failed to dismiss sync job', err);
        dismissedIdsRef.current.delete(jobId);
        await refreshJobs();
      }
    },
    [refreshJobs]
  );

  const dismissAllJobs = useCallback(async () => {
    const finishedIds = jobs.filter(j => !isSyncJobActive(j)).map(j => j.id);
    for (const id of finishedIds) {
      dismissedIdsRef.current.add(id);
    }
    setJobs(prev => prev.filter(isSyncJobActive));
    setIsDismissingAll(true);
    try {
      await api.fireflySync.dismissAllJobs();
    } catch (err) {
      console.error('Failed to dismiss all sync jobs', err);
      for (const id of finishedIds) {
        dismissedIdsRef.current.delete(id);
      }
      await refreshJobs();
    } finally {
      setIsDismissingAll(false);
    }
  }, [jobs, refreshJobs]);

  const hasActiveJobs = useMemo(() => jobs.some(isSyncJobActive), [jobs]);

  useEffect(() => {
    if (!hasActiveJobs || typeof EventSource === 'undefined') {
      return;
    }

    const es = new EventSource(api.fireflySync.jobsStreamUrl);

    const handleEvent = (ev: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(ev.data) as FireflySyncJob[];
        if (Array.isArray(parsed)) {
          applyJobList(parsed, true, false);
        }
      } catch (err) {
        console.error('Failed to parse SSE jobs payload', err);
      }
    };

    es.addEventListener('snapshot', handleEvent as EventListener);
    es.addEventListener('jobs', handleEvent as EventListener);
    es.onerror = () => {
      // Re-sync snapshot cleanly if SSE connection drops temporarily
      refreshJobs();
    };

    return () => {
      es.close();
    };
  }, [hasActiveJobs, applyJobList, refreshJobs]);

  const jobsByProductId = useMemo(() => {
    const map: Record<number, FireflySyncJob> = {};
    for (const job of jobs) {
      if (!map[job.product_id]) {
        map[job.product_id] = job;
      }
    }
    return map;
  }, [jobs]);

  const activeJobs = useMemo(() => jobs.filter(isSyncJobActive), [jobs]);
  const unacknowledgedErrorCount = useMemo(
    () => countUnacknowledgedErrors(jobs),
    [jobs]
  );

  return {
    jobs,
    activeJobs,
    jobsByProductId,
    hasActiveJobs,
    unacknowledgedErrorCount,
    isDismissingAll,
    refreshJobs,
    registerJob,
    dismissJob,
    dismissAllJobs,
  };
}
