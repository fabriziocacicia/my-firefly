# Spec Delta: Enforce Parent Tags on Items & Implication Impact Sync

* **Status:** Implemented
* **Date:** 2026-11-27
* **Issue:** [#30 — feat: child tags on items must enforce parent ones](https://github.com/fabriziocacicia/my-firefly/issues/30)
* **Base Spec:** [`canonical_items_hierarchical_tags_and_firefly_sync.md`](./canonical_items_hierarchical_tags_and_firefly_sync.md)

---

## 1. Objective

Ensure that whenever a child tag (e.g., `Mele`) is assigned to a catalog `Product`, its implied parent tags (e.g., `Frutta` via `TagImplication`) are visibly enforced as present, non-duplicable, and unremovable until the child tag is removed first — including for items whose tags existed before the implication rule or before the companion app.

In addition, when adding or removing a `TagImplication` rule in **Tag Hierarchy**, give the user a pre-flight impact check showing which catalog items and how many Firefly III splits/transactions will be affected, and let confirmation immediately start the Firefly III sync jobs for those splits.

---

## 2. Current Behavior

Per [`canonical_items_hierarchical_tags_and_firefly_sync.md`](./canonical_items_hierarchical_tags_and_firefly_sync.md):
- [`ProductTagLink`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/backend/app/models/tag.py) stores direct tags on a `Product`, while [`expand_tags_ordered`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/backend/app/services/taxonomy.py#L86-L112) computes `effective_tags` transitively for display, analytics, receipt pushes ([`receipts.py`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/backend/app/api/v1/receipts.py#L236-L238)), and Firefly rewrites ([`firefly_sync_jobs.py`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/backend/app/services/firefly_sync_jobs.py#L593-L595)).
- In [`TagMultiCombobox.tsx`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/frontend/src/components/common/TagMultiCombobox.tsx):
  - Selecting `Mele` places only `#Mele` in the chip box and shows `+Frutta` separately underneath (`Auto-implied on Firefly`).
  - `Frutta` remains selectable in the dropdown, allowing `Frutta` to be added a second time into `selectedTagIds`.
  - When an item already has both `Mele` and `Frutta` directly (e.g., created from Firefly Backlog `sample_tags` or before an implication existed), removing `#Mele` leaves `#Frutta` behind as a direct tag, and removing `#Frutta` appears to remove it while `effective_tags` silently keeps it.
- In [`TagHierarchyTab.tsx`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/frontend/src/components/catalog/TagHierarchyTab.tsx#L87-L90), adding or deleting a `TagImplication` rule saves locally without checking impacted items/splits or offering to sync those splits to Firefly III from that view.

---

## 3. Assumptions

1. **Option B (Minimal Direct Tags + Implied Ancestors) is the canonical model:** `ProductTagLink` stores only *minimal* direct tags (no redundant ancestors already implied by another tag on the same item). `effective_tags` remains the source of truth sent to Firefly III and analytics.
2. **Subsumption semantics on existing/combined tags:** If an item has both `Mele` and `Frutta` (from legacy data, Firefly Backlog import, or user selection order), `Mele` subsumes `Frutta` into the implied state so that removing `Mele` removes `Frutta` as well. If the user wants `Frutta` alone, they remove `Mele` first and then select `Frutta`.
3. **Firefly visibility:** Expanding `effective_tags` on receipt push and `FireflySyncJob` rewrites already sends `["Mele", "Frutta"]` to Firefly III; no changes to Firefly III client payload format are required.
4. **Sequential/existing job queue safety:** Multi-product propagation reuses the existing [`FireflySyncJob`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/backend/app/services/firefly_sync_jobs.py#L572-L649) (`job_type="product_propagate"`) pipeline and live SSE updates in `CatalogPage`.

---

## 4. Tech Stack & Commands

- **Backend:** Python 3.13, FastAPI, SQLModel, Alembic, SQLite (`backend/`)
  - Test: `python3 -m unittest discover -s tests` (from `backend/`)
- **Frontend:** React 18, TypeScript, Tailwind CSS 3.4, Lucide icons, Vite, Bun (`frontend/`)
  - Test: `bun test` (from `frontend/`)
  - Build / Type-check: `bun run build` (`tsc && vite build`, from `frontend/`)

---

## 5. New Behavior

### 5.1 Minimal Direct Tag Normalization & Sanitization (Backend)

1. **Taxonomy helper ([`taxonomy.py`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/backend/app/services/taxonomy.py)):**
   - Add `prune_redundant_ancestor_tag_ids(tag_ids: Iterable[int], implications: dict[int, set[int]]) -> list[int]`:
     - Preserves original order and uniqueness (`dict.fromkeys`).
     - Computes the set of strictly implied ancestor IDs across all `tag_ids` (for each `tid`, all ancestors reachable via `implications` excluding `tid` itself).
     - Filters out any `tid` that appears in the union of strict ancestors of the other tags in `tag_ids`. (Because `implications` is a validated DAG, no two distinct tags can be mutual ancestors.)
2. **Product writes ([`products.py`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/backend/app/api/v1/products.py)):**
   - Both `create_product` (`POST /api/v1/products`) and `update_product` (`PATCH /api/v1/products/{id}`) pass `tag_ids` through `prune_redundant_ancestor_tag_ids(..., implications)` before creating `ProductTagLink` rows.
3. **Implication creation ([`tags.py`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/backend/app/api/v1/tags.py)):**
   - After committing a new `TagImplication(child_tag_id, parent_tag_id)`, prune any redundant `ProductTagLink` rows across existing products whose direct tags now contain redundant implied ancestors (e.g., products having both `Mele` and `Frutta` drop direct `ProductTagLink(Frutta)` while keeping `Mele`).
4. **Alembic data migration (`backend/migrations/versions/0011_sanitize_redundant_product_tags.py`):**
   - One-time idempotent data migration (`down_revision = "0010_firefly_sync_jobs"`): scans `tag_implication` and `producttaglink`, removes any `producttaglink` row whose `tag_id` is an implied ancestor of another `tag_id` on the same `product_id`. Leaves `effective_tags` unchanged and performs no Firefly API calls.

### 5.2 Implication Impact Preview & Immediate Batch Sync (Backend)

1. **Impact preview endpoint (`GET /api/v1/tags/implications/impact`):**
   - Query params: `action: Literal["add", "remove"]`, `child_tag_id: int`, `parent_tag_id: int`.
   - Validates both tags exist (`404` otherwise). For `action="add"`, validates no cycle via `would_create_cycle` (`422` if cyclic).
   - Simulates the implication graph *before* and *after* applying/removing `(child_tag_id, parent_tag_id)` (including redundant-ancestor pruning for `add`).
   - Identifies all `Product` rows whose direct tags contain `child_tag_id` or any descendant of `child_tag_id` (`get_descendant_tag_ids`), including items whose local `effective_tags` did not change (e.g., parent tag was already directly on the item) whenever any linked `FireflySyncedSplit.tags_json` is missing an expected tag from `after_tags`.
   - For each impacted product, computes:
     - `product_id`, `product_name`
     - `before_tags: list[str]` and `after_tags: list[str]` (resolved `effective_tags` names)
     - `affected_firefly_transactions: int` and `affected_firefly_splits: int` (across non-ignored `FireflySyncedSplit` + pushed `Receipt` transactions)
     - `has_active_sync_job: bool`
   - Returns `{ action, child_tag_id, parent_tag_id, affected_items, total_affected_items, total_affected_transactions, total_affected_splits }`.
2. **Batch propagation endpoint (`POST /api/v1/products/propagate-firefly-batch`):**
   - Body: `{ product_ids: list[int] }` (`status_code=202`).
   - Extracts a shared helper from `propagate_product_to_firefly` in [`products.py`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/backend/app/api/v1/products.py) so single-item and batch propagation share one code path.
   - Enqueues a `FireflySyncJob` (`job_type="product_propagate"`) for each requested product that has linked Firefly splits/receipts and no currently active job; skips items with 0 linked transactions and skips (or reports cleanly) items that already have an active job instead of failing the whole batch.
   - Returns `{ jobs: list[FireflySyncJobResponse], skipped_active_product_ids: list[int] }`.
   - Existing `POST /api/v1/tags/implications` (`200 TagImplicationRead`) and `DELETE /api/v1/tags/implications/{child_tag_id}/{parent_tag_id}` (`204`) keep their exact response shapes for backward compatibility.

### 5.3 Frontend Enforced Tag Picker & Implication Confirmation Modal

1. **Unified & locked chips in [`TagMultiCombobox.tsx`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/frontend/src/components/common/TagMultiCombobox.tsx):**
   - **Shared local helper** in [`productUtils.ts`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/frontend/src/components/workbench/productUtils.ts):
     - Add `pruneRedundantAncestorTagIds(tagIds, implications)` and `getImpliedParentSources(directTagIds, tags, implications)` (mapping each implied tag ID to the direct tag names that require it, e.g., `Frutta ← Mele`).
     - Normalize `onChange` additions so adding `Mele` when `Frutta` is already selected automatically prunes redundant `Frutta` from `selectedTagIds` (turning `Frutta` into an implied/locked chip).
   - **Unified chip box:** Render direct chips (`#Mele`, removable with `×`) and implied chips (`#Frutta`, styled distinctly with a lock icon and `title="Required by Mele — remove Mele first"`, non-removable) inside the same tag input container (removing the separate bottom `Auto-implied on Firefly` row so all active tags appear in one place).
   - **Prevent duplicate selection:** Filter `renderedOptions` and `exactExisting` matching against the full **effective** tag set (`direct ∪ implied`) so `Frutta` cannot be picked again while `Mele` is present.
   - **Keyboard (`Backspace`) enforcement:** Pressing `Backspace` with an empty query removes only the last *direct* tag (never an implied locked tag); if a user attempts to remove an implied tag or clicks its disabled indicator, show a brief inline hint (`"Remove Mele first to remove Frutta"`).
   - Normalize `initialTagNames` resolution in [`ItemEditorModal.tsx`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/frontend/src/components/catalog/ItemEditorModal.tsx) (and on load of `editingProduct`) through `pruneRedundantAncestorTagIds` so legacy/backlog items immediately reflect the same clean direct+implied state.
2. **Implication impact modal in [`TagHierarchyTab.tsx`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/frontend/src/components/catalog/TagHierarchyTab.tsx):**
   - On **Add rule** (`Mele → Frutta`) or **Delete rule** (`Trash2` button):
     - Call `api.tags.previewImplicationImpact(action, childId, parentId)`.
     - If `total_affected_items === 0` and `total_affected_splits === 0`, apply immediately without interrupting the user (for `add`; or lightweight apply for `delete`).
     - If any items or Firefly splits are impacted, open an accessible confirmation modal (`role="dialog"`, `aria-modal="true"`, `Escape` to close) showing:
       - Summary of the rule change (`Add Mele → Frutta` or `Remove Mele → Frutta`), total impacted items, and total Firefly splits/transactions.
       - Simple list of impacted items (`product_name`, `before_tags → after_tags`, and `affected_firefly_splits` / `affected_firefly_transactions` count).
       - Actions:
         - **Cancel** (makes no changes).
         - **Save rule only** (when Firefly splits > 0: applies rule locally without rewriting Firefly yet).
         - **Confirm & Sync to Firefly** (primary action when Firefly splits > 0, or **Confirm** when 0 Firefly splits): commits `createImplication` / `deleteImplication`, triggers `api.products.propagateFireflyBatch(affectedProductIds)` if any Firefly splits exist, registers the returned jobs via `onJobsStarted` (`registerJob` in [`CatalogPage.tsx`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/frontend/src/pages/CatalogPage.tsx)), and refreshes catalog/tags.

---

## 6. Testing Strategy

- **Backend (`backend/tests/test_tag_hierarchy.py`, `backend/tests/test_canonical_items_and_receipts.py`):**
  - Unit tests for `prune_redundant_ancestor_tag_ids` (single-hop, multi-hop `Mele → Frutta → Alimentari`, orthogonal `Bio` preserved, DAG diamond).
  - API tests for `POST /api/v1/products` and `PATCH /api/v1/products/{id}` pruning redundant parent tags while preserving `effective_tags`.
  - API tests for `POST /api/v1/tags/implications` pruning existing redundant `ProductTagLink` rows so removing `Mele` later also removes `Frutta`.
  - Migration test verifying `0011_sanitize_redundant_product_tags` removes redundant ancestor `product_tag_link` rows cleanly on a test SQLite DB.
  - API tests for `GET /api/v1/tags/implications/impact` (`add` and `remove`, cycle `422`, item & split/tx counts) and `POST /api/v1/products/propagate-firefly-batch` (enqueueing `FireflySyncJob`s, skipping 0-tx and active-job items).
- **Frontend (`bun test` + `bun run build`):**
  - Unit tests for `pruneRedundantAncestorTagIds` and `getImpliedParentSources` in `frontend/src/components/workbench/productUtils.test.ts`.
  - `bun run build` (`tsc && vite build`) passes with zero TypeScript or bundler errors.
  - Browser verification of `TagMultiCombobox` (unified chips, locked implied tag tooltip/disabled state, no duplicate dropdown option, `Backspace` behavior) and `TagHierarchyTab` impact confirmation modal + live job registration.

---

## 7. Boundaries

- **Always:**
  - Preserve `GET / PUT` sibling split safety in `FireflySyncJob` (never omit sibling `transaction_journal_id`s).
  - Keep `POST /api/v1/tags/implications` (`200`) and `DELETE /api/v1/tags/implications/{child}/{parent}` (`204`) response contracts backward-compatible.
  - Run `python3 -m unittest discover -s tests`, `bun test`, and `bun run build` before committing code.
- **Ask first:**
  - Before running live Firefly III bulk rewrites outside mocked unit tests.
  - Before changing how `TagImplication` deletion behaves if an item had manually added tags in the past (current design treats implied ancestors as subsumed).
- **Never:**
  - Silently rewrite Firefly III transactions on implication add/delete without explicit user confirmation in the modal.
  - Allow duplicate tag selection or allow removing an implied parent tag in the UI while a child tag remains active.

---

## 8. Success Criteria

1. On an item with `Mele` (where `Mele → Frutta`), `Frutta` appears as a locked/implied chip inside `TagMultiCombobox`, cannot be added a second time from the dropdown, and cannot be removed until `Mele` is removed first.
2. Existing items that previously held both `Mele` and `Frutta` directly (via migration, Backlog import, or prior edits) are sanitized to minimal direct tags (`Mele`), so removing `Mele` removes `Frutta` as well.
3. Adding or deleting a `TagImplication` rule in **Tag Hierarchy** checks impacted catalog items and Firefly splits, displays the simple item impact list in a confirmation dialog, and clicking **Confirm** both applies the rule and starts the `FireflySyncJob` propagation for those splits immediately.
4. All backend `unittest` tests, frontend `bun test` tests, and `bun run build` pass.

---

## 9. Out of Scope (Deferred)

- **Individual split-row listing inside the implication confirmation modal:** Deferred; V1 shows the simple per-item list with affected split/transaction counts.
- **Propagating implication changes directly inside Firefly III without companion-app sync:** Not supported by Firefly III's flat tag model.
