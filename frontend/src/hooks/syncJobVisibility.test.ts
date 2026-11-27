import { describe, expect, it } from 'bun:test';
import { FireflySyncJob } from '../types';
import {
  COMPLETED_BANNER_TTL_MS,
  countUnacknowledgedErrors,
  getNextBannerExpiryDelayMs,
  hasDismissibleFinishedJobs,
  isJobBannerVisible,
} from './syncJobVisibility';

function makeJob(overrides: Partial<FireflySyncJob> = {}): FireflySyncJob {
  return {
    id: 1,
    job_type: 'backlog_link',
    product_id: 10,
    product_name: 'Mele Rosse Bio',
    status: 'completed',
    total_transactions: 5,
    processed_transactions: 5,
    updated_transactions: 5,
    total_splits: 5,
    processed_splits: 5,
    linked_splits: 5,
    updated_splits: 5,
    failed_count: 0,
    failed_transactions: [],
    target_journal_ids: [101],
    error_message: null,
    dismissed_at: null,
    created_at: '2026-11-27T10:00:00.000Z',
    started_at: '2026-11-27T10:00:01.000Z',
    finished_at: '2026-11-27T10:01:00.000Z',
    ...overrides,
  };
}

describe('syncJobVisibility', () => {
  const finishedAtMs = Date.parse('2026-11-27T10:01:00.000Z');

  it('always keeps queued and running jobs visible regardless of age or dismissed_at', () => {
    const nowMs = finishedAtMs + COMPLETED_BANNER_TTL_MS * 10;
    expect(isJobBannerVisible(makeJob({ status: 'queued' }), nowMs)).toBe(true);
    expect(isJobBannerVisible(makeJob({ status: 'running' }), nowMs)).toBe(true);
  });

  it('shows completed banners within the 5-minute TTL and hides them once expired', () => {
    const job = makeJob({ status: 'completed' });
    expect(isJobBannerVisible(job, finishedAtMs + 60_000)).toBe(true);
    expect(isJobBannerVisible(job, finishedAtMs + COMPLETED_BANNER_TTL_MS)).toBe(true);
    expect(isJobBannerVisible(job, finishedAtMs + COMPLETED_BANNER_TTL_MS + 1)).toBe(false);
  });

  it('falls back to created_at when finished_at is missing on completed jobs', () => {
    const createdAtMs = Date.parse('2026-11-27T10:00:00.000Z');
    const job = makeJob({ status: 'completed', finished_at: null });
    expect(isJobBannerVisible(job, createdAtMs + COMPLETED_BANNER_TTL_MS - 1000)).toBe(true);
    expect(isJobBannerVisible(job, createdAtMs + COMPLETED_BANNER_TTL_MS + 1000)).toBe(false);
  });

  it('keeps failed and completed_with_errors jobs visible beyond TTL until dismissed', () => {
    const farLater = finishedAtMs + 24 * 60 * 60 * 1000;
    expect(isJobBannerVisible(makeJob({ status: 'failed' }), farLater)).toBe(true);
    expect(
      isJobBannerVisible(makeJob({ status: 'completed_with_errors', failed_count: 1 }), farLater)
    ).toBe(true);
    expect(
      isJobBannerVisible(
        makeJob({ status: 'failed', dismissed_at: '2026-11-27T10:02:00.000Z' }),
        farLater
      )
    ).toBe(false);
  });

  it('hides dismissed completed jobs immediately even inside TTL', () => {
    const job = makeJob({
      status: 'completed',
      dismissed_at: '2026-11-27T10:01:30.000Z',
    });
    expect(isJobBannerVisible(job, finishedAtMs + 60_000)).toBe(false);
  });

  it('computes the shortest positive delay until the next completed banner expires', () => {
    const jobSoon = makeJob({
      id: 1,
      status: 'completed',
      finished_at: '2026-11-27T10:01:00.000Z',
    });
    const jobLater = makeJob({
      id: 2,
      status: 'completed',
      finished_at: '2026-11-27T10:03:00.000Z',
    });
    const failed = makeJob({
      id: 3,
      status: 'failed',
      finished_at: '2026-11-27T10:00:30.000Z',
    });

    const nowMs = finishedAtMs + 120_000; // 180s left on jobSoon
    const delay = getNextBannerExpiryDelayMs([jobLater, failed, jobSoon], nowMs);
    expect(delay).toBe(180_050);

    // Once past TTL, delay is 0 so open tabs clean up immediately
    expect(getNextBannerExpiryDelayMs([jobSoon], finishedAtMs + COMPLETED_BANNER_TTL_MS + 5)).toBe(0);
    expect(getNextBannerExpiryDelayMs([failed], nowMs)).toBeNull();
  });

  it('counts unacknowledged errors and checks dismissible finished jobs accurately', () => {
    const jobs = [
      makeJob({ id: 1, status: 'running' }),
      makeJob({ id: 2, status: 'completed' }),
      makeJob({ id: 3, status: 'failed' }),
      makeJob({ id: 4, status: 'completed_with_errors', failed_count: 2 }),
      makeJob({ id: 5, status: 'failed', dismissed_at: '2026-11-27T10:02:00.000Z' }),
    ];
    expect(countUnacknowledgedErrors(jobs)).toBe(2);
    expect(hasDismissibleFinishedJobs(jobs)).toBe(true);
    expect(hasDismissibleFinishedJobs([makeJob({ id: 1, status: 'running' })])).toBe(false);
  });
});
