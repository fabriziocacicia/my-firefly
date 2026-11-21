# Store Mapping Removal, Optional Parent Company Metadata & Type-Ahead Store Pickers

* **Author:** Fabrizio
* **Date:** 2026-11-11

## Overview

`my-firefly` currently gates receipt entry, price recording, and Firefly III pushes behind a manual mapping step on `StoresPage.tsx`. Every Firefly III expense account sits in an `"Unmapped"` state until the user assigns a mandatory non-null `Company` (`Store.company_id`) via `POST /api/v1/companies/quick-map`. Across 290+ Firefly expense accounts—covering chains, independent local shops, utilities, and people—this forces manual one-by-one setup and creates redundant 1:1 `Company` rows for standalone shops. Meanwhile, store `<select>` dropdowns across the frontend prefix labels with `${store.company?.name || 'Company'} — ${store.name}` and load hundreds of unsorted options at once.

This concept removes the mandatory `"Unmapped"` gate by syncing Firefly III expense accounts into local `Store` rows over the REST API (on non-blocking startup and manual refresh), requires every store to originate from a Firefly III account, makes `Store.company_id` nullable so `Company` metadata can be assigned, cleared, or deleted on `StoresPage.tsx` ahead of future chain analytics, uses the Firefly account name (`Store.name`) directly everywhere outside `Company` management, and replaces `<select>` store dropdowns with filtered type-ahead pickers that do not query or suggest until 1+ character is entered.

## Analysis

### Reviewer Coverage
All 7 Goldfish lenses (`egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`, `egm-inventive-catalyst`) reviewed the concept directly against the repository, and the brief was finalized across the author's follow-up decisions.

### Core Contradictions & Resolved Mechanisms
1. **Remote Ledger Freshness vs. Local Speed, Offline Use & SQLite Locking:**
   * *Mechanism:* Keep Firefly III's REST API as the authoritative source (`NG4`), reuse one `httpx.AsyncClient` across paginated fetches in `FireflyClient._get_all_accounts_by_type`, and execute all HTTP calls before opening a short thread-dispatched SQLite write transaction guarded by an `asyncio.Lock`. Enable SQLite `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout`, and `PRAGMA foreign_keys=ON` in `backend/app/core/database.py`.
   * *Sync Trigger (Settled):* Use **non-blocking startup sync plus an explicit manual refresh endpoint/button**, avoiding periodic background daemon complexity and idle SQLite writes. Never hard-delete missing Firefly accounts; soft-archive them via `is_active = False` only after a complete, error-free paginated sweep so historical `Receipt` and `PriceRecord` foreign keys stay valid.
   * *Firefly Counterpart Enforcement (Settled):* Every store must have a Firefly III counterpart. Retire manual unlinked store creation (`POST /api/v1/companies/stores` creating `firefly_account_id = None` rows) so Firefly sync is the sole creator of stores, while keeping backend pre-push guards (`_validate_firefly_accounts` in `receipts.py`) for archived or legacy rows.
2. **Uniform `Store.name` Display vs. Legacy Stripped Branch Names & Firefly `group_title`:**
   * *Mechanism (Settled):* Only 3 mapped stores exist today, so backfilling `Store.name = Store.firefly_account_name` (and syncing Firefly `attributes.name` into `Store.name`) causes no broken labels. Remove all `Company —` / `Store —` / `Company (...)` display prefixes across `WorkbenchHeader.tsx`, `ReceiptWorkbenchPage.tsx`, `CatalogPage.tsx`, and `ProductPriceChart.tsx`, and update `_build_firefly_tx_payload` in `backend/app/api/v1/receipts.py` so Firefly `group_title` always uses `receipt.store.name` instead of `receipt.store.company.name`.
3. **Zero-Query-Until-Typing (`>= 1` char) vs. Draft Hydration & Type-Ahead Safety:**
   * *Mechanism (Settled):* Keep the type-ahead dropdown empty and issue **no list queries until 1+ characters are typed** (`GET /api/v1/companies/stores?search=...&limit=...` with `AbortController` / sequence guards, case/diacritic-insensitive matching, and explicit empty initial state instead of `stores[0]`/`exp[0]` defaults). When `ReceiptWorkbenchContext.tsx` restores a saved `storeId` from `localStorage`, run a single-row lookup (`GET /api/v1/companies/stores/{storeId}`) on hydration so `selectedStore` and `canPushToFirefly` populate without fetching all 290+ stores. Revert uncommitted typed text on blur and include an inline manual sync action on zero matches.
   * *Remaining Call Sites Included (Settled):* Also replace the two 290+ `<select>` dropdowns in `WorkflowsPage.tsx` (removing live `/firefly/expense-accounts` fetch and the `exp[0].id` default) with the shared `StoreCombobox`, and update `App.tsx` default `activeTab` from `'stores'` to `'workbench'`.
4. **Upfront `Company` Controls on `StoresPage.tsx` (Settled):**
   * *Trade-off Accepted:* Although chain-level price analytics are deferred and `Company` is hidden everywhere outside `StoresPage.tsx`, keep optional `Company` assignment, clearing (`company_id = null`), and company deletion (`DELETE /companies/{id}` nulling child stores) on `StoresPage.tsx` so chains (`Conad`, `Lidl`, etc.) can be tagged ahead of analytics. Replace `All / Unmapped / Mapped` warning tabs with neutral filtering (`All` / `In Company` / `No Company`), search/pagination for 290+ rows, trimmed/case-insensitive `Company` deduplication, and explicit sync status (`last_success_at`, `last_error`).

### Secondary Details & Observability
* **Schema Migration (`0003`):** Use Alembic `op.batch_alter_table("store")` (`render_as_batch=True`) to make `store.company_id` nullable, add `is_active` and `last_synced_at`, backfill `Store.name` from `firefly_account_name`, and provide a reversible `downgrade()` that handles `company_id IS NULL` rows before re-enforcing `NOT NULL`.
* **N+1 Query & Error Visibility:** Add `selectinload(Store.company)` on `get_stores` (`companies.py`) and `list_expense_accounts` (`firefly.py`), configure structured token-safe sync logging, and surface sync/fetch errors in the UI instead of `console.error`-only catches.

### Ideal Final Result (IFR)
Every active Firefly III expense account syncs automatically on startup or manual refresh into local `Store` rows under its exact Firefly account name with zero manual setup and zero `"Unmapped"` warnings; every store has a Firefly III counterpart; type-ahead pickers stay idle and issue no list queries until 1+ character is typed (while single-store hydration keeps reloaded drafts push-ready); `Store.name` is used uniformly across UI and Firefly transaction titles; `Company` metadata can be cleanly curated on `StoresPage.tsx` for upcoming analytics; and historical receipts/prices stay intact offline or across upstream Firefly changes.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Make `Store.company_id` nullable via Alembic `batch_alter_table` migration, add `is_active` / `last_synced_at`, backfill existing mapped `Store.name` values from `firefly_account_name`, and retire unlinked manual `Store` creation (`firefly_account_id = None`).
  * Sync Firefly III expense accounts via REST API (`NG4` preserved) on non-blocking startup and manual refresh with SQLite WAL mode, `busy_timeout`, `asyncio.Lock`, soft `is_active` archiving, and observable sync status.
  * Use `Store.name` uniformly across `WorkbenchHeader.tsx`, `ReceiptWorkbenchPage.tsx`, `CatalogPage.tsx`, `ProductPriceChart.tsx`, and `_build_firefly_tx_payload` (`receipts.py`).
  * Replace `<select>` store pickers in `WorkbenchHeader.tsx`, `CatalogPage.tsx`, and `WorkflowsPage.tsx` with a shared `StoreCombobox` that shows and queries nothing until 1+ character is typed, drops `stores[0]`/`exp[0]` defaults, and hydrates persisted draft `storeId` via single-row lookup; switch `App.tsx` default tab to `'workbench'`.
  * Simplify `StoresPage.tsx` by removing `Mapped` / `Unmapped` warning states, adding sync status/refresh and search/pagination across 290+ rows, and retaining optional `Company` assignment, clearing, and deletion controls.
* **Out-of-Scope Non-Goals:**
  * **Multi-target & liability-account receipt splitting / generic Firefly transaction editor:** Deferred to a separate follow-up item/issue (requires resolving Firefly `withdrawal` vs. `transfer` split constraints and `PriceRecord` store attribution).
  * **Chain-level (`Company`) price analytics & aggregation:** Deferred to a follow-up item/issue after `Company` metadata grouping is in place.
  * **Periodic background sync daemon:** Rejected; replaced with non-blocking startup sync + manual refresh.
  * **Direct Firefly III database access:** Rejected (`NG4`).
  * **Automatic company prefix guessing or allowlist/blocklist filtering of non-shop accounts:** Excluded.

## Alternatives Weighed

1. **Direct Firefly III Database Reads + Local Metadata Tables**
   * *Status:* Rejected by author and architecture (`NG4` in `docs/designs/receipt_workbench_and_price_analytics.md`). Breaks container/DB isolation, couples to Firefly internal tables, and prevents SQLite foreign keys and joins.
2. **Periodic Background Sync Daemon vs. Non-Blocking Startup + Manual Sync**
   * *Status:* Periodic daemon rejected (`egm-zoom-out` YAGNI finding + author confirmation). Startup sync + manual refresh eliminates background loop complexity and idle SQLite write contention.
3. **Eager Preload of 290+ Stores vs. Zero-Query-Until-Typing (`>= 1` char) + Single-Row Draft Hydration**
   * *Status:* Author chose zero-query-until-typing (`>= 1` char) so list queries are filtered from the first keystroke, paired with single-row `GET /stores/{id}` hydration for `localStorage` drafts in `ReceiptWorkbenchContext.tsx`.
4. **Deferring `Company` Controls on `StoresPage.tsx` vs. Keeping Them Now**
   * *Status:* `egm-zoom-out` suggested deferring `Company` UI until chain analytics exist; author chose to keep `Company` assignment/clearing/deletion controls on `StoresPage.tsx` now ahead of upcoming analytics.
5. **Local-Only Stores (`firefly_account_id = None`) vs. Firefly-Backed Only**
   * *Status:* Author confirmed every store must have a Firefly III counterpart, retiring unlinked local store creation (`POST /api/v1/companies/stores`).
6. **Generic Multi-Target / Liability Receipt Editor**
   * *Status:* Deferred by author to a separate follow-up item (`NG3`).

## Key Decisions & Staging for Next Steps

* Remove `Company` display prefixes everywhere (including Firefly `group_title` in `receipts.py`) and backfill `Store.name` from `firefly_account_name` for existing mapped stores.
* Use non-blocking startup sync + manual refresh instead of a periodic background daemon, backed by SQLite WAL mode, `busy_timeout`, `asyncio.Lock`, soft `is_active` archiving, and observable sync status.
* Require every new store to have a Firefly III counterpart (retire unlinked local store creation).
* Keep optional `Company` assignment, clearing, and deletion controls on `StoresPage.tsx` ahead of chain analytics.
* Do not query or show suggestions in the type-ahead picker until 1+ character is entered (pairing with single-row `GET /stores/{id}` hydration for restored `localStorage` drafts), apply the shared `StoreCombobox` across `WorkbenchHeader.tsx`, `CatalogPage.tsx`, and `WorkflowsPage.tsx`, and switch `App.tsx` default tab from `'stores'` to `'workbench'`.

