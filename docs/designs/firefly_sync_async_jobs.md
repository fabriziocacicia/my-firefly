# Spec Delta: Asynchronous Firefly Sync Jobs & Progress Tracking

* **Status:** Approved (Implementing)
* **Date:** 2026-11-26
* **Base Spec:** [`canonical_items_hierarchical_tags_and_firefly_sync.md`](./canonical_items_hierarchical_tags_and_firefly_sync.md)

---

## 1. Objective

Eliminate `504 Gateway Time-out` failures when linking or propagating large sets of Firefly III splits (100–500+ transactions) by converting bulk Firefly rewrite operations into asynchronous background jobs with controlled concurrency, incremental persistence, and real-time Server-Sent Events (SSE) progress visibility across both the **Catalog Item cards** and the **Firefly Backlog (`To Associate` / `Associated`)** views.

---

## 2. Current Behavior

Today (`canonical_items_hierarchical_tags_and_firefly_sync.md`, Tasks 5 & 6):
- `POST /api/v1/firefly-sync/backlog/link` and `POST /api/v1/products/{product_id}/propagate-firefly` run `rewrite_firefly_splits_for_product()` **synchronously** inside the HTTP request handler.
- Every distinct `firefly_transaction_id` runs sequentially (`GET` → `PUT`) one after another before returning `RewriteResultResponse`.
- Rewriting 105–500 transactions requires 210–1,000+ sequential Firefly III HTTP calls inside one request, exceeding reverse-proxy/gateway timeouts (`504 Gateway Time-out`) and leaving the UI unaware of partial progress.

---

## 3. Assumptions

1. **Single-process FastAPI runtime:** The backend runs as a single ASGI process (`uvicorn app.main:app`), so in-process `asyncio.create_task` workers backed by SQLite state (`firefly_sync_job`) accurately reflect active work without requiring an external broker (Redis/Celery).
2. **Firefly III safe concurrency ceiling:** Firefly III (PHP + DB) handles up to **4 concurrent** `GET`/`PUT` transaction pairs reliably via `asyncio.Semaphore(4)` without exhausting PHP-FPM workers or SQLite/DB locks.
3. **One active rewrite job per product:** Preventing two simultaneous rewrite jobs targeting the same `product_id` avoids conflicting `PUT` races and keeps the per-item status indicator unambiguous.
4. **Immediate 202 contract transition:** Both `POST /api/v1/firefly-sync/backlog/link` and `POST /api/v1/products/{product_id}/propagate-firefly` only serve the companion web UI and can transition cleanly to returning `202 Accepted` with the created job resource.

---

## 4. New Behavior

### 4.1 Persistence (`firefly_sync_job` Table via Alembic Migration `0010`)
Add SQLModel table `FireflySyncJob` (`firefly_sync_job`):
- `id: int` (PK)
- `job_type: str` (`"backlog_link"` | `"product_propagate"`)
- `product_id: int` (indexed, FK → `product.id` with `ON DELETE CASCADE`)
- `product_name: str` (snapshot for display even if item is later renamed)
- `status: str` (`"queued"` | `"running"` | `"completed"` | `"completed_with_errors"` | `"failed"`)
- `total_transactions: int` (distinct Firefly transaction IDs to update)
- `processed_transactions: int` (completed + failed transaction count)
- `updated_transactions: int`
- `total_splits: int`
- `linked_splits: int`
- `updated_splits: int`
- `failed_count: int`
- `failed_transactions_json: str` (JSON list of `{ firefly_transaction_id, error }`, capped to e.g. 50 entries in detail list while `failed_count` stays exact)
- `target_journal_ids_json: str` (JSON list of target `transaction_journal_id`s for status correlation in backlog)
- `error_message: Optional[str]` (fatal/interrupt error if job itself crashed)
- `dismissed_at: Optional[datetime]`
- `created_at: datetime`, `started_at: Optional[datetime]`, `finished_at: Optional[datetime]`

**Startup Recovery:** During FastAPI lifespan startup, any leftover `"queued"` or `"running"` jobs (from a server restart/crash mid-job) are marked `"failed"` with `error_message = "Interrupted by server restart"`.

### 4.2 Backend API Contract
- **`POST /api/v1/firefly-sync/backlog/link`** → returns **HTTP `202 Accepted`** with `FireflySyncJobResponse`:
  - Records `ItemFireflyAlias` entries immediately (preserving existing alias behavior).
  - Enqueues a background `asyncio.Task` to rewrite the splits grouped by `firefly_transaction_id`.
  - If an active (`queued` / `running`) job already exists for `product_id`, returns **HTTP `409 Conflict`**.
- **`POST /api/v1/products/{product_id}/propagate-firefly`** → returns **HTTP `202 Accepted`** with `FireflySyncJobResponse`:
  - Validates the product has linked splits (or returns immediately completed job / 409 if an active job for `product_id` is already running).
- **`GET /api/v1/firefly-sync/jobs`** (query `include_dismissed: bool = False`, `limit: int = 20`) → returns active jobs plus recent non-dismissed finished jobs sorted newest first (used on initial mount and after reconnects).
- **`GET /api/v1/firefly-sync/jobs/{job_id}`** → returns single `FireflySyncJobResponse` (404 if missing).
- **`GET /api/v1/firefly-sync/jobs/stream`** → Server-Sent Events (`text/event-stream`) endpoint returning live job progress updates:
  - Sends response headers `Cache-Control: no-cache`, `Connection: keep-alive`, and `X-Accel-Buffering: no`.
  - Immediately emits an initial `snapshot` event containing current active + recent non-dismissed jobs.
  - Streams `jobs` update events immediately whenever any job transitions state or completes a transaction, via an in-process pub/sub signal (`asyncio.Event` / subscriber queues).
  - Sends an SSE heartbeat comment (`: keepalive\n\n`) every 15 seconds while open to keep reverse proxies alive, and closes cleanly once no jobs are active (or client disconnects).
- **`POST /api/v1/firefly-sync/jobs/{job_id}/dismiss`** → sets `dismissed_at` on finished jobs (`409` if still `queued`/`running`) so completed/error notices can be closed cleanly.

### 4.3 Background Worker Execution & Incremental Commits
- Inside the worker, `grouped_by_tx` (distinct `firefly_transaction_id`s) executes with `asyncio.Semaphore(4)`.
- Each transaction runs the existing safe `GET /api/v1/transactions/{id}` → `PUT /api/v1/transactions/{id}` logic (preserving untouched sibling splits, existing `group_title`, omitting empty `category_name`, and formatting detailed `HTTP {code}: ...` errors).
- Database updates for each completed Firefly transaction (`FireflySyncedSplit.linked_product_id`, normalized description/tags, `PriceRecord` upsert for `backlog_link`, and incrementing `FireflySyncJob` counters) are committed **incrementally per completed transaction** using the request engine bind (`session.get_bind()`), then broadcast to active SSE subscribers so:
  1. Connected browsers immediately receive live transaction-by-transaction progress (`processed_transactions / total_transactions`).
  2. Successfully rewritten splits immediately become `linked` in SQLite and are not lost if the server restarts partway through.

### 4.4 Frontend Live Status & SSE (`CatalogPage`, Catalog Cards, & `FireflyBacklogTab`)
- **Centralized SSE subscription in `CatalogPage.tsx` (or `useFireflyJobs` hook):**
  - Fetches `GET /api/v1/firefly-sync/jobs` on mount.
  - Whenever any job is `queued` or `running`, opens a native `EventSource('/api/v1/firefly-sync/jobs/stream')` subscription (closing automatically once all active jobs reach terminal states; relying on native `EventSource` auto-reconnect + initial snapshot if a proxy resets a long-lived stream).
  - Triggers silent background refreshes of `products` and backlog data when a job reaches a terminal state (and throttled silent refreshes every ~5s during active runs so `To Associate` / `Associated` counts update smoothly without blocking spinners).
- **Catalog Item Card (`CatalogPage.tsx`):**
  - When a `Product` has an active job (`queued`/`running`), displays a compact progress strip inside the card (`Syncing Firefly: 42 / 105 tx` + slim progress bar + live failure badge if `failed_count > 0`) and disables `Sync N FF` / `Delete` until finished.
  - When finished (`completed` / `completed_with_errors` / `failed`), displays a compact dismissible result pill inside the card (`Synced 105 tx` or `98/105 synced · 7 failed` with error tooltip/detail + dismiss `×`).
- **Firefly Backlog Tab (`FireflyBacklogTab.tsx`, visible on both `To Associate` and `Associated`):**
  - Displays an **Active & Recent Sync Jobs** status bar showing progress bar (`42 / 105 tx · 120 splits`), target item name, and error summary/dismiss control.
  - Specifically under the **`Associated`** sub-tab: any grouped item row whose `linked_product_id` matches an active or recently finished job displays an inline status pill (`Syncing 42/105...`, `Synced`, or `Failed (N): ...`) directly on the card/row.
- **Modals (`FireflyBacklogTab` Link Modal & `ItemEditorModal`):**
  - Launching `Link to Item`, `Create New Item` from backlog, or `Propagate to Firefly` immediately closes/submits cleanly on `202 Accepted` and registers the new job into the shared status state so the user never blocks waiting on a long HTTP request.

---

## 5. Success Criteria

1. Linking or propagating a group of 100–500+ Firefly transactions returns `HTTP 202` in `< 500ms` (never triggering `504 Gateway Time-out`).
2. Background execution processes Firefly `GET`+`PUT` pairs with bounded concurrency (`Semaphore(4)`), preserves untouched sibling splits and original `group_title`, and commits local DB state (`linked_product_id`, `PriceRecord`, job counters) incrementally per transaction.
3. Duplicate concurrent link/propagate triggers for the same active `product_id` return `409 Conflict`.
4. Startup recovery marks stale `"queued"`/`"running"` jobs as `"failed"` cleanly.
5. UI displays live progress (`processed / total`) and final success/error summaries simultaneously in:
   - the matching **Catalog Item Card**, and
   - **Firefly Backlog** (including inline status badges on **Associated** rows),
   staying consistent when switching between `Catalog Items`, `To Associate`, and `Associated`.
6. All backend `unittest` tests pass and `cd frontend && bun run build` (`tsc && vite build`) builds with 0 errors.

---

## 6. Boundaries

- **Always:** Keep unit tests fast and deterministic (mocking `firefly_client`, running real `asyncio` job tasks against the test DB engine). Keep existing single-split `PUT` safety invariants intact.
- **Ask first:** Adding external worker infrastructure (Celery/Redis) or changing Firefly III rate limits beyond `4` concurrent requests.
- **Never:** Leave orphaned `"running"` jobs indefinitely after restart, overwrite existing Firefly `group_title`s on multi-split transactions, or block UI interaction during long-running syncs.

---

## 7. Out of Scope (Deferred)

- **Cancel / Retry failed button per job:** Deferred unless requested now (failed splits remain unassociated in `To Associate`, so clicking **Link to Item** again naturally retries only the remaining unassociated splits).
