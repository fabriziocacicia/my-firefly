import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { FireflySyncJob } from '../types';

export const isSyncJobActive = (job: FireflySyncJob): boolean =>
  job.status === 'queued' || job.status === 'running';

function mergeJobs(prev: FireflySyncJob[], incoming: FireflySyncJob[]): FireflySyncJob[] {
  const byId = new Map<number, FireflySyncJob>();
  for (const job of prev) {
    if (!job.dismissed_at) byId.set(job.id, job);
  }
  for (const job of incoming) {
    if (job.dismissed_at) {
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
  const lastSilentRefreshRef = useRef<number>(0);

  const applyJobList = useCallback((nextList: FireflySyncJob[], emitRefresh: boolean) => {
    setJobs(nextList);

    const nextActiveIds = new Set(
      nextList.filter(isSyncJobActive).map(j => j.id)
    );
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
    try {
      const list = await api.fireflySync.listJobs(false);
      applyJobList(list, false);
    } catch (err) {
      console.error('Failed to load Firefly sync jobs', err);
    }
  }, [applyJobList]);

  useEffect(() => {
    refreshJobs();
  }, [refreshJobs]);

  const registerJob = useCallback((job: FireflySyncJob) => {
    setJobs(prev => {
      const merged = mergeJobs(prev, [job]);
      if (isSyncJobActive(job)) {
        prevActiveIdsRef.current.add(job.id);
      }
      return merged;
    });
  }, []);

  const dismissJob = useCallback(
    async (jobId: number) => {
      setJobs(prev => prev.filter(j => j.id !== jobId));
      try {
        await api.fireflySync.dismissJob(jobId);
      } catch (err) {
        console.error('Failed to dismiss sync job', err);
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
          applyJobList(parsed, true);
        }
      } catch (err) {
        console.error('Failed to parse SSE jobs payload', err);
      }
    };

    es.addEventListener('snapshot', handleEvent as EventListener);
    es.addEventListener('jobs', handleEvent as EventListener);

    return () => {
      es.close();
    };
  }, [hasActiveJobs, applyJobList]);

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
