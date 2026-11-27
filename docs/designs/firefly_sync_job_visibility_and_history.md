# Spec Delta: Sync Job Banner Auto-Expiry, Bulk Dismiss & Sync History Drawer

* **Status:** Approved
* **Date:** 2026-11-27
* **Issue:** [#33 — fix: synced items notifications remain visible forever](https://github.com/fabriziocacicia/my-firefly/issues/33)
* **Base Spec:** [`firefly_sync_async_jobs.md`](./firefly_sync_async_jobs.md)

---

## 1. Objective

Prevent completed Firefly sync notification banners from cluttering **Catalog Item cards** and **Firefly Backlog** views indefinitely across sessions and page refreshes, without losing visibility into past sync outcomes when the user wants to inspect them.

This delta combines three complementary behaviors:
1. **A1 — Automatic inline expiry for successful jobs:** `completed` jobs automatically disappear from inline banners after a short TTL (5 minutes from `finished_at`), while `failed` and `completed_with_errors` jobs remain visible until dismissed.
2. **A2 — Bulk dismissal:** A single **Dismiss all** action clears all finished notifications at once without clicking badges one by one.
3. **B1 — On-demand Sync History drawer:** A dedicated, accessible **Sync History** slide-over drawer in `CatalogPage` lets the user inspect all recent and past jobs (including auto-hidden and dismissed ones) at any time.

---

## 2. Current Behavior

Per [`firefly_sync_async_jobs.md`](./firefly_sync_async_jobs.md):
- [`list_visible_sync_jobs`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/backend/app/services/firefly_sync_jobs.py#L114-L127) (`GET /api/v1/firefly-sync/jobs?include_dismissed=false`) returns up to 20 active or non-dismissed jobs (`dismissed_at IS NULL`), regardless of how old `finished_at` is.
- [`useFireflySyncJobs`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/frontend/src/hooks/useFireflySyncJobs.ts) loads these jobs on mount and keeps rendering every non-dismissed finished [`SyncJobBadge`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/frontend/src/components/catalog/SyncJobBadge.tsx) across:
  - Product cards in [`CatalogPage.tsx`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/frontend/src/pages/CatalogPage.tsx#L562-L566)
  - The `Firefly Background Sync` panel in [`FireflyBacklogTab.tsx`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/frontend/src/components/catalog/FireflyBacklogTab.tsx#L494-L512)
  - Inline badges on `Associated` rows in [`FireflyBacklogTab.tsx`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/frontend/src/components/catalog/FireflyBacklogTab.tsx#L575-L581)
- Because `dismissed_at` is only written per job via `POST /api/v1/firefly-sync/jobs/{job_id}/dismiss`, finished banners stay visible forever across refreshes until dismissed one by one.

---

## 3. Assumptions

1. **Inline TTL = 5 minutes (`300s`) for `completed` jobs:** Enough time to see immediate feedback during a work session, while keeping cards and backlog clean on subsequent visits or after a short interval.
2. **Errors stay surfaced until acknowledged:** `failed` and `completed_with_errors` jobs remain visible inline until dismissed individually or via **Dismiss all**, so partial failures are never silently hidden.
3. **No schema migration needed:** Existing `FireflySyncJob.finished_at` and `FireflySyncJob.dismissed_at` columns already support both TTL filtering and full history retrieval (`include_dismissed=true`).
4. **Scope confined to `CatalogPage`:** All `FireflySyncJob` triggers (`backlog_link` and `product_propagate`) reside within `CatalogPage` and its tabs (`Catalog Items`, `Firefly Backlog`, `Tag Hierarchy`, `Tag Analytics`), so placing the **Sync History** trigger in `CatalogPage` makes history reachable across every relevant sub-view without polluting unrelated top-level pages.

---

## 4. Tech Stack & Commands

- **Backend:** Python, FastAPI, SQLModel, SQLite (`backend/`)
  - Test: `python3 -m unittest discover -s tests` (from `backend/`)
- **Frontend:** React 18, TypeScript, Tailwind CSS 3.4, Lucide icons, Vite (`frontend/`)
  - Test: `bun test` (from `frontend/`)
  - Build / Type-check: `bun run build` (`tsc && vite build`, from `frontend/`)

---

## 5. New Behavior

### 5.1 Backend API & Filtering (`firefly_sync_jobs.py`, `firefly_sync.py`)

1. **Active Banner Feed (`GET /api/v1/firefly-sync/jobs` with `include_dismissed=false`, default):**
   - Always includes:
     - Active jobs (`status IN ('queued', 'running')`)
     - Non-dismissed error jobs (`dismissed_at IS NULL AND status IN ('failed', 'completed_with_errors')`)
     - Non-dismissed `completed` jobs whose `finished_at` is within the last **5 minutes** (`COMPLETED_BANNER_TTL_SECONDS = 300`). If `finished_at` is `NULL` on a `completed` row, falls back to `created_at`.
   - `GET /api/v1/firefly-sync/jobs?include_dismissed=true&limit=50` continues to return **all** jobs (including dismissed and expired `completed` jobs) sorted newest-first (`created_at DESC, id DESC`) for the **Sync History** drawer.
   - `SSE /api/v1/firefly-sync/jobs/stream` uses the same `list_visible_sync_jobs(..., include_dismissed=False)` snapshot rules.

2. **Bulk Dismiss Endpoint (`POST /api/v1/firefly-sync/jobs/dismiss-all`):**
   - Marks `dismissed_at = datetime.now(timezone.utc)` on all jobs where `dismissed_at IS NULL` and `status NOT IN ('queued', 'running')`.
   - Never modifies `queued` or `running` jobs.
   - Broadcasts updated snapshot via `broadcast_jobs_snapshot(session)`.
   - Returns `{ "dismissed_count": <int> }`.

### 5.2 Frontend Hook & Auto-Expiry (`useFireflySyncJobs.ts` + `syncJobVisibility.ts`)

1. **Client-Side Expiry Synchronization:**
   - Pure helper module (e.g. `frontend/src/hooks/syncJobVisibility.ts`) computes whether a job should appear as an inline banner (`isJobBannerVisible(job, nowMs)`) using the same 5-minute TTL (`300_000 ms`) for `completed` jobs.
   - `useFireflySyncJobs` schedules a lightweight timeout for the next expiring `completed` job so open tabs automatically hide expired success banners after 5 minutes without requiring a manual page refresh.
   - Adds `dismissAllJobs()` calling `POST /api/v1/firefly-sync/jobs/dismiss-all`, optimistically removing finished jobs from the active banner state (`jobs`) while keeping active jobs intact (and rolling back via `refreshJobs()` on error).

2. **Bulk Dismiss in Backlog Panel (`FireflyBacklogTab.tsx`):**
   - When `topPanelJobs` contains at least one finished job, the `Firefly Background Sync` panel header renders a **`Dismiss all`** button (`aria-label` / clear text) alongside the active count.

### 5.3 Frontend Sync History Drawer (`SyncHistoryDrawer.tsx` & `CatalogPage.tsx`)

1. **Header / Tab-bar Trigger in `CatalogPage.tsx`:**
   - Adds a compact **`Sync History`** button in the `CatalogPage` header/tab-controls area (responsive across 320px–1440px).
   - Displays non-color-only state cues:
     - Active jobs running: spinner + count badge (`N active`)
     - Un-dismissed errors present: warning icon + count badge (`N errors`)
     - Otherwise: neutral `History` icon + `Sync History` label.

2. **Accessible Slide-Over Drawer (`SyncHistoryDrawer.tsx`):**
   - Follows WAI-ARIA Dialog pattern: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus moved to the drawer close button on open, `Escape` key and backdrop click close the drawer, and focus returns to the trigger button on close.
   - Fetches `GET /api/v1/firefly-sync/jobs?include_dismissed=true&limit=50` when opened (and refreshes when a live job finishes while open), merging live SSE progress from `activeJobs`.
   - Provides:
     - Filter segmented control: **`All`** | **`Errors & Warnings`**
     - **`Dismiss all banners`** action when any non-dismissed finished banners remain
     - **`Refresh`** button
     - Skeleton loading state, meaningful empty state, and error state with **`Retry`**.
   - Each job row displays:
     - Product name (`job.product_name`) and operation type (`Backlog Link` vs `Propagate`)
     - Status badge with icon + label (`Queued`, `Syncing X/Y`, `Completed`, `Completed with errors`, `Failed`)
     - Entry/receipt summary (e.g., `105/105 entries synced across 38 Firefly receipts`)
     - Relative timestamp (with full ISO/local timestamp in `title`)
     - Expandable error details (`error_message` and `failed_transactions` list) when errors exist.

---

## 6. Testing Strategy

- **Backend (`backend/tests/test_firefly_backlog_sync.py`):**
  - Verify `GET /api/v1/firefly-sync/jobs` hides `completed` jobs older than 5 minutes when `include_dismissed=false`, while keeping recent `completed` jobs, `queued`/`running` jobs, and un-dismissed `failed`/`completed_with_errors` jobs visible.
  - Verify `GET /api/v1/firefly-sync/jobs?include_dismissed=true` still returns expired and dismissed `completed` jobs.
  - Verify `POST /api/v1/firefly-sync/jobs/dismiss-all` dismisses all finished jobs, leaves active jobs untouched, and returns accurate `dismissed_count`.
- **Frontend (`bun test` + `bun run build`):**
  - Unit test `syncJobVisibility.ts` (TTL boundary for `completed`, persistence for `failed`/`completed_with_errors`, active jobs always visible, `dismissed_at` always hidden, next-expiry calculation).
  - Verify `bun run build` (`tsc && vite build`) passes with zero errors.
  - Manual/DevTools visual & keyboard verification of the `Sync History` drawer and auto-expiry behavior across breakpoints (320px, 768px, 1024px, 1440px).

---

## 7. Boundaries

- **Always:** Keep `FireflySyncJob` records persisted in SQLite so history is never lost; preserve all existing `GET / PUT` Firefly rewrite safety invariants; adhere to project Tailwind tokens (`slate`, `blue`, `emerald`, `amber`, `rose`) and WCAG 2.1 AA keyboard/ARIA standards.
- **Ask first:** Changing the default 5-minute TTL, adding a new database column/migration, or adding periodic server-side row pruning/deletion.
- **Never:** Delete sync job records automatically, dismiss `queued` or `running` jobs in `dismiss-all`, or rely on color alone to communicate job status.

---

## 8. Success Criteria

1. Refreshing `CatalogPage` or `FireflyBacklogTab` more than 5 minutes after a successful (`completed`) sync job finishes no longer shows stale green banners on product cards, backlog rows, or the top sync panel.
2. Open browser tabs automatically clear expired `completed` inline banners after 5 minutes without manual dismissal or reload.
3. `failed` and `completed_with_errors` jobs stay visible until acknowledged (individually or via **Dismiss all**).
4. Clicking **Dismiss all** clears all finished inline banners in a single request without touching active jobs.
5. Opening **Sync History** from `CatalogPage` displays all historical sync jobs (including auto-expired and dismissed ones) with live status, counts, timestamps, and expandable error details, with full keyboard (`Tab`, `Escape`) and screen-reader accessibility.
6. Backend `unittest` suite, frontend `bun test`, and `bun run build` all pass cleanly.

---

## 9. Out of Scope (Deferred)

- **Automatic database deletion/retention pruning of old `firefly_sync_job` rows:** Deferred; SQLite table stays compact enough with `limit=50` queries in UI.
- **Per-job "Retry failed splits" action inside Sync History:** Deferred per [`firefly_sync_async_jobs.md`](./firefly_sync_async_jobs.md#L120) (unassociated failed splits remain retryable from `To Associate`).
- **Global app-wide toast overlay in `Navbar.tsx`:** Deferred; sync jobs are triggered and managed within `CatalogPage`.

---

## 10. Confirmed Decisions

1. **TTL duration:** Confirmed at **5 minutes (`300s`)** for auto-hiding `completed` inline banners.
2. **History drawer limit:** Confirmed at **50** most recent sync jobs (`limit=50`).
