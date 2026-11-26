import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { FireflySyncJob } from '../types';

export const isSyncJobActive = (job: FireflySyncJob): boolean =>
  job.status === 'queued' || job.status === 'running';

function mergeJobs(
  prev: FireflySyncJob[],
  incoming: FireflySyncJob[],
  dismissedIds: Set<number>
): FireflySyncJob[] {
  const byId = new Map<number, FireflySyncJob>();
  for (const job of prev) {
    if (!job.dismissed_at && !dismissedIds.has(job.id)) byId.set(job.id, job);
  }
  for (const job of incoming) {
    if (job.dismissed_at || dismissedIds.has(job.id)) {
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
  const onJobsChangedRef = useRef(options?.onJobsChanged);
  onJobsChangedRef.current = options?.onJobsChanged;

  const prevActiveIdsRef = useRef<Set<number>>(new Set());
  const dismissedIdsRef = useRef<Set<number>>(new Set());
  const registeredAtRef = useRef<number>(0);
  const lastSilentRefreshRef = useRef<number>(0);

  const applyJobList = useCallback((nextList: FireflySyncJob[], emitRefresh: boolean, mergeWithRegistered: boolean = false) => {
    const filtered = nextList.filter(j => !dismissedIdsRef.current.has(j.id) && !j.dismissed_at);
    setJobs(prev => (mergeWithRegistered ? mergeJobs(prev, filtered, dismissedIdsRef.current) : filtered));

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

  return {
    jobs,
    activeJobs,
    jobsByProductId,
    hasActiveJobs,
    refreshJobs,
    registerJob,
    dismissJob,
  };
}
