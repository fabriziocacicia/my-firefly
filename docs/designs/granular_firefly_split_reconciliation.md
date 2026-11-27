# Spec: Granular Firefly Backlog Reconciliation & Verified Split Pricing — V1

* **Status:** Implemented
* **Date:** 2026-11-27
* **Issue:** [#41 — feat: granular Firefly backlog reconciliation (chain/store/split) and verified split pricing](https://github.com/fabriziocacicia/my-firefly/issues/41)
* **Base Specs:**
  * [`canonical_items_hierarchical_tags_and_firefly_sync.md`](./canonical_items_hierarchical_tags_and_firefly_sync.md)
  * [`firefly_sync_async_jobs.md`](./firefly_sync_async_jobs.md)
  * [`expense_account_classification_and_category_tagging.md`](./expense_account_classification_and_category_tagging.md)

---

## 1. Objective

Enable the user to reconcile historical Firefly III splits (`FireflySyncedSplit`) at **Chain**, **Store**, or **Individual Split** granularity and enrich/verify local purchase quantities and discount pricing (`g`/`kg`/`ml`/`l`/`pcs`, `is_discount`, `regular_price`) without corrupting unit-price analytics with assumed defaults.

Specifically, this solves two real-world gaps in the current Firefly Backlog & Price History workflow:
1. **Same description across different brands/variants:** Splits sharing a description such as `"Banane Bio"` across different chains/stores (*Famila* vs *Lidl*) or `"Rifornimento Carburante"` inside the same gas station (*Diesel Standard* vs *Premium Diesel*) currently collapse into an all-or-nothing group and overwrite a single global alias.
2. **Missing & unverified quantities on synced splits:** Synced splits for `loose_weight` products (produce, fuel) previously defaulted to `quantity = 1.0`, turning e.g. `€50.00` of fuel into `€50.00/L` and `€2.40` of bananas into `€2.40/kg`. Users need an explicit verification lifecycle (`missing` / `needs_review` / `verified`) and local per-split editing from both the Backlog and Catalog Item Price History.

---

## 2. Explicit Assumptions

1. **Chain resolution uses `AccountMetadata.company_id` (with `CompanyAccountLink` fallback):** An expense account belongs to a Chain when `AccountMetadata.company_id` (or legacy `CompanyAccountLink.company_id`) is set. Accounts without a company appear directly at Store level.
2. **Legacy review scope is `firefly_sync` + `loose_weight` only:** Existing `PriceRecord` rows from `receipt`, `manual`, or `firefly_sync` on `packaged` products remain `verified` (1 split = 1 pack) so the user does not have to manually re-confirm ~2,100 valid packaged rows. Existing `firefly_sync` rows on `loose_weight` products are migrated to `needs_review`. Every `PriceRecord` (including `packaged`) remains editable on demand if a legacy manual Firefly split combined 2+ packs or had an unmarked discount.
3. **Split detail edits are strictly local:** Updating `quantity`, `unit`, `is_discount`, `regular_price`, or confirming `verification_status` updates local `PriceRecord` rows only and never triggers a Firefly III rewrite job or edits Firefly notes/descriptions/tags.
4. **Stored truth vs assisted calculator:** `paid_price` and `quantity` (plus `regular_price` when discounted) are the saved source of truth. The UI's bidirectional `Quantity <-> €/unit` input is a live assisted calculator that populates `quantity` without storing unit price as primary input.
5. **Lazy drill-down for 5,000+ splits:** `GET /api/v1/firefly-sync/backlog` continues returning summary groups only; Chain → Store → Individual Split details load on demand when expanding a group or opening the `Missing & To Review` view.

---

## 3. Tech Stack & Commands

- **Backend:** Python 3.13 (`>=3.13,<3.14`), FastAPI, SQLModel, SQLite, Alembic (`backend/`)
  - Run tests: `cd backend && uv run pytest` (or `python3 -m unittest discover -s tests`)
  - Run dev server: `cd backend && uv run uvicorn app.main:app --reload --port 8000`
- **Frontend:** React 18, TypeScript 5.2, Tailwind CSS 3.4, Vite 5.1, Bun (`frontend/`)
  - Run tests: `cd frontend && bun test`
  - Build / type-check: `cd frontend && bun run build` (`tsc && vite build`)
  - Run dev server: `cd frontend && bun --bun run dev`

---

## 4. Project Structure

```text
backend/
├── app/
│   ├── api/v1/
│   │   ├── firefly_sync.py       # Sync endpoints, SSE jobs, and thin /backlog* routes
│   │   ├── prices.py             # PATCH /prices/{id} local split quantity/discount/verification editing
│   │   └── analytics.py          # Excludes null normalized_unit_price; keeps spend/count accurate
│   ├── models/
│   │   ├── firefly_backlog_schemas.py  # Pydantic schemas for backlog, attention queue, and drill-down
│   │   ├── price.py              # Nullable quantity + verification_status ('missing' | 'needs_review' | 'verified')
│   │   └── product.py            # ItemFireflyAlias scoped by (normalized_description, scope_key)
│   └── services/
│       ├── firefly_backlog.py    # Scoped alias resolution, chain/store filters, attention & drill-down queries
│       └── firefly_sync_jobs.py  # Respects verified PriceRecords during propagate; creates missing on loose_weight
├── migrations/versions/
│   └── 0012_granular_split_pricing_and_scoped_aliases.py
└── tests/
    ├── test_canonical_schema_migration.py
    └── test_firefly_backlog_sync.py
frontend/
├── src/
│   ├── api/client.ts             # Typed API methods for drill-down, attention queue, PATCH /prices/{id}
│   ├── types/index.ts            # Updated BacklogGroup, BacklogSplitsResponse, AttentionQueue, PriceRecord types
│   ├── components/catalog/
│   │   ├── FireflyBacklogTab.tsx     # Orchestrates Backlog tabs, lazy split drill-down, and modals
│   │   ├── BacklogFiltersBar.tsx     # Status segmentation, Chain/Store filters, and Category pills
│   │   ├── BacklogLinkModal.tsx      # Scoped Link-to-Existing-Item modal
│   │   ├── BacklogSplitDrilldown.tsx # 3-level Chain -> Store -> Split tree with multi-select & SplitPriceEditor
│   │   ├── BacklogAttentionQueue.tsx # Missing & To Review queue view
│   │   ├── SplitPriceEditor.tsx      # Shared inline Qty <-> €/unit calculator, discount & verify controls
│   │   └── splitPriceUtils.ts        # Pure bidirectional unit-price helpers + splitPriceUtils.test.ts
│   └── pages/
│       └── CatalogPage.tsx       # Integrates SplitPriceEditor inside Price History & Deal Analysis modal
```

---

## 5. Code Style

Follow existing FastAPI + SQLModel and React + TypeScript patterns in the codebase:

```python
@router.patch("/{price_record_id}", response_model=PriceRecordRead)
async def update_price_record(
    price_record_id: int,
    payload: PriceRecordUpdate,
    session: Session = Depends(get_session),
):
    record = session.get(PriceRecord, price_record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Price record not found")
```

- Keep domain/helper functions pure and unit-testable (e.g., unit-price reverse calculation helper in `frontend/src/components/catalog/`).
- Validate numeric inputs (`quantity > 0`, `regular_price > 0`) via Pydantic and return explicit HTTP `400`/`422` errors.

---

## 6. Architecture & Functional Design

### 6.1 `PriceRecord` Verification Lifecycle (`backend/app/models/price.py`)

Extend `PriceRecordBase` / `PriceRecord`:
- `quantity: Optional[float] = Field(default=1.0, gt=0)` — nullable so `missing` records never store a synthetic `1.0`.
- `verification_status: str = Field(default="verified", index=True)` — values: `"missing" | "needs_review" | "verified"`.

Lifecycle rules:
1. **Receipt Workbench (`receipts.py`) & Manual Entry (`prices.py` `POST /`):** Created with `verification_status = "verified"`.
2. **New `firefly_sync` `backlog_link` (`firefly_sync_jobs.py`):**
   - `product.sale_mode == "packaged"`: `quantity = 1.0`, `unit = product.default_unit`, `package_size = product.package_size`, `normalized_unit_price` & `normalized_regular_price` computed, `verification_status = "verified"`.
   - `product.sale_mode == "loose_weight"`: `quantity = None`, `unit = product.default_unit`, `package_size = product.package_size`, `normalized_unit_price = None`, `normalized_regular_price = None`, `verification_status = "missing"`.
3. **Overwrite Protection on Re-sync / `product_propagate`:**
   - When `_upsert_price_record_for_split_values` finds an existing `PriceRecord` for `transaction_journal_id` with the **same** `product_id`:
     - If `verification_status == "verified"`, preserve `quantity`, `unit`, `is_discount`, `regular_price`, and `verification_status` (only refresh `paid_price`, `recorded_date`, `firefly_account_id`, `firefly_transaction_id`, and recompute normalized unit prices from the preserved `quantity` & `unit`).
     - If `verification_status in ("missing", "needs_review")`, preserve existing `quantity`/`is_discount`/`regular_price` if already populated, or keep `missing` for `loose_weight`.
   - When re-linked to a **different** `product_id`: update `product_id`, `unit = product.default_unit`, `package_size = product.package_size`, and initialize `quantity` / `verification_status` for the new product (`1.0` + `verified` if `packaged`, `None` + `missing` if `loose_weight`).
4. **Migration `0012`:**
   - Rebuild/alter `price_record` so `quantity` is nullable and `verification_status` exists (`NOT NULL DEFAULT 'verified'`).
   - Set `verification_status = 'needs_review'` for all existing `PriceRecord` rows where `source_type = 'firefly_sync'` AND the linked `Product.sale_mode = 'loose_weight'`.

### 6.2 Local Split Price Update Endpoint (`backend/app/api/v1/prices.py`)

Add `PATCH /api/v1/prices/{price_record_id}`:
- Request body (`PriceRecordUpdate`):
  - `quantity: Optional[float] = Field(default=None, gt=0)`
  - `unit: Optional[Literal["g", "kg", "ml", "l", "pcs"]] = None`
  - `is_discount: Optional[bool] = None`
  - `regular_price: Optional[float] = Field(default=None, gt=0)`
  - `notes: Optional[str] = None`
  - `confirm_verified: bool = True` (allows 1-click confirmation of a `needs_review` row without changing `quantity`)
- Behavior:
  - Updates provided fields on `PriceRecord`.
  - If `is_discount is False` and `regular_price` is not explicitly provided (or previously equaled old regular), resets `regular_price = record.paid_price`.
  - If `record.quantity is not None and record.quantity > 0`: recomputes `normalized_unit_price` and `normalized_regular_price` via `normalize_unit_price` and sets `verification_status = "verified"`.
  - Rejects `confirm_verified=True` with HTTP `422` if `record.quantity is None` (cannot verify a record with no quantity).
  - Never calls Firefly III.

### 6.3 Scoped `ItemFireflyAlias` (`backend/app/models/product.py`, `firefly_sync.py`)

Extend `ItemFireflyAlias`:
- Add `company_id: Optional[int] = Field(default=None, foreign_key="company.id", index=True)`
- Add `firefly_account_id: Optional[int] = Field(default=None, index=True)`
- Add `scope_key: str = Field(default="global", index=True)` (`"global"`, `"chain:<company_id>"`, or `"store:<firefly_account_id>"`), with composite unique constraint on `(normalized_description, scope_key)` replacing the single-column unique constraint on `normalized_description`.

Resolution & writing rules:
- **Hint lookup precedence** for `(normalized_description, firefly_account_id, company_id)`:
  1. `store:<firefly_account_id>`
  2. `chain:<company_id>` (when account belongs to a company)
  3. `global`
  4. Canonical product description / name fallback
- **`BacklogLinkRequest` extension:**
  - Add optional `alias_scope: Literal["auto", "global", "chain", "store", "none"] = "auto"`.
  - `"auto"` behavior:
    - All target splits share one `firefly_account_id` and it belongs to a `company_id` → if linking via Chain action, UI passes `"chain"`; if linking via Store action, UI passes `"store"` (or `"chain"` when Chain is default; `"store"` when user overrides at branch level); if linking individual splits across mixed products in the same store (e.g. Standard vs Premium Diesel), UI passes `"none"` or `"store"` only when unambiguous.
    - Multi-store/multi-chain group link → `"global"`.

### 6.4 Granular Backlog Endpoints (`backend/app/api/v1/firefly_sync.py`)

1. **`GET /api/v1/firefly-sync/backlog`:**
   - Add optional query filters: `company_id: Optional[int]`, `account_id: Optional[int]`.
   - Support `status: Literal["unassociated", "linked", "ignored", "needs_attention"]`:
     - `needs_attention` returns `PriceRecord` backlog groups/items where `verification_status IN ('missing', 'needs_review')` (filterable by category, search, chain, store).
   - `BacklogResponse` also returns:
     - `needs_attention_count: int` (count of `missing` + `needs_review` splits)
     - `available_chains: List[{ id: int, name: str, count: int }]`
     - `available_stores: List[{ account_id: int, name: str, company_id: Optional[int], count: int }]`
   - `BacklogGroup` remains compact (`normalized_description`, `sample_description`, `category_name`, `occurrence_count`, `total_amount`, `latest_date`, `sample_stores`, `sample_tags`, `journal_ids`, `suggested_product_id`, `suggested_product_name`, `linked_product_id`, `linked_product_name`, plus `chain_count` / `store_count` / `attention_count`).

2. **`GET /api/v1/firefly-sync/backlog/splits`:**
   - Lazy drill-down endpoint for a single `BacklogGroup`:
     - Query params: `normalized_description`, `category_name` (or `__uncategorized__`), `status`, `linked_product_id`, `company_id`, `account_id`.
   - Returns hierarchical structure:
     - `chains`: list of chain buckets (`company_id`, `company_name`, `occurrence_count`, `total_amount`, `suggested_product_id`, `suggested_product_name`, `suggested_scope`, `stores`: list of store buckets). Accounts with `company_id = None` appear in an `unchained_stores` list (or chain bucket with `company_id = null`, `company_name = null` rendered directly at store level in the UI).
     - Each store bucket (`firefly_account_id`, `store_name`, `occurrence_count`, `total_amount`, `suggested_product_id`, `suggested_product_name`, `suggested_scope`, `splits`: list of `BacklogSplitDetail`).
     - Each `BacklogSplitDetail` includes:
       - `transaction_journal_id`, `firefly_transaction_id`, `tx_date`, `amount`, `description`, `tags`
       - `linked_product_id`, `linked_product_name`, `is_ignored`
       - `price_record`: `{ id, quantity, unit, regular_price, paid_price, is_discount, normalized_unit_price, normalized_regular_price, verification_status } | null`

3. **`GET /api/v1/firefly-sync/backlog/attention`:**
   - Returns flat list of `needs_attention` split+price items (`missing` first, then `needs_review`), filterable by `company_id`, `account_id`, `category`, `search`, so the user can triage all missing-quantity / review-needed rows directly without expanding groups one by one.

### 6.5 Frontend UX (`FireflyBacklogTab.tsx`, `SplitPriceEditor.tsx`, `CatalogPage.tsx`)

1. **Backlog Top Filters & Tabs (`FireflyBacklogTab.tsx`):**
   - Tabs: `To Associate (N)` | `Missing & To Review (M)` | `Associated (K)` | `Ignored (J)`.
   - Add **Chain** and **Store** dropdown/combobox filters next to Search/Category (filtering Stores dynamically when a Chain is selected).
2. **3-Level Progressive Drill-Down (on `To Associate`, `Associated`, `Ignored`):**
   - Group row retains its clean summary + `Expand` toggle (`▸ Split by Chain / Store / Split`).
   - **Level 1 (Chain — default when `company_id != null`):** Shows chain name (e.g., *Lidl · 2 stores*), total count/amount, scoped suggestion pill (`Hint: Banane Bio · Alce Nero`) with 1-click `Link`, `Choose Item…`, `+ New Item`, `Ignore` / `Unlink`. Unchained stores render directly as Store rows at Level 1.
   - **Level 2 (Store / Branch):** Expanding a chain shows individual branches (e.g., *Lidl Hotel dei Pini*, *Lidl via Cilestri Catania*) with store-level `Link` / `Ignore` / `Unlink` actions and store-scoped hint if overridden.
   - **Level 3 (Individual Splits):** Expanding a store loads individual splits with multi-select checkboxes (`Link Selected`, `Ignore Selected`, `Unlink Selected`), enabling separation within the same store (e.g. *Diesel Standard* vs *Premium Diesel*).
3. **`SplitPriceEditor.tsx` (Reused in Backlog & `CatalogPage` History Modal):**
   - Available on any linked split inside Backlog (`Missing & To Review`, expanded `Associated`) and inside the **Recorded Prices** list of `CatalogPage` → `Price History & Deal Analysis` modal.
   - Provides:
     - **Quantity + Unit** input (`g | kg | ml | l | pcs`)
     - **Assisted Unit Price calculator (`€/kg`, `€/L`, `€/pc`):** editing unit price computes `quantity = paid_price / unit_price` (converting `kg -> g` or `L -> ml` when unit is `g`/`ml`); editing quantity updates the displayed unit price live.
     - **Discount toggle (`is_discount`) + `Regular Price (€)`** input.
     - **Verification state badge:** `Missing` (amber), `Needs review` (sky/amber with 1-click **`Confirm`** button when `quantity != null`), `Verified` (emerald).

---

## 7. Testing Strategy

- **Backend (`backend/tests/test_firefly_backlog_sync.py` + `test_prices_and_analytics.py`):**
  - Migration `0012`: `quantity` nullable, `verification_status` populated (`needs_review` only for `firefly_sync` + `loose_weight`, `verified` for `packaged` / `receipt` / `manual`), scoped `ItemFireflyAlias` preserves existing aliases as `scope_key='global'`.
  - `backlog/link`: `loose_weight` creates `PriceRecord` with `quantity=None`, `normalized_unit_price=None`, `verification_status='missing'`; `packaged` creates `quantity=1.0`, `verification_status='verified'`.
  - `product_propagate`: preserves `verified` `PriceRecord` quantity/unit/discount/regular_price without overwriting.
  - `PATCH /prices/{id}`: updates `quantity`, `unit`, `is_discount`, `regular_price`, recomputes normalized unit prices, transitions `missing`/`needs_review` → `verified`, supports 1-click verify, rejects verify when `quantity=None`.
  - Scoped alias precedence: `store > chain > global`, and linking one store/chain does not overwrite another store/chain's hint.
  - Drill-down & attention endpoints: chain grouping, unchained stores, split filtering by `company_id` / `account_id`, subset `link`/`unlink`/`ignore`.
- **Frontend (`bun test` + `bun run build`):**
  - Unit tests for pure bidirectional `quantity <-> unitPrice` calculation helpers (including `g`/`kg` and `ml`/`l` unit conversions and edge cases `<= 0`).
  - `bun run build` (`tsc && vite build`) passes with zero TypeScript or bundle errors.
  - Visual & interactive verification via Chrome DevTools across desktop and mobile viewports (320px, 768px, 1280px).

---

## 8. Boundaries

- **Always do:**
  - Run backend tests and frontend build/tests before committing.
  - Keep `PriceRecord` edits strictly local (never trigger Firefly rewrites on quantity/discount edits).
  - Protect `verified` `PriceRecord` values from being overwritten by sync or `product_propagate`.
- **Ask first:**
  - Changing schema beyond migration `0012` or adding new npm/Python packages.
  - Marking historical `packaged` records as `needs_review`.
- **Never do:**
  - Assume `quantity = 1.0` for `loose_weight` records synced from Firefly III.
  - Commit secrets or temporary files (`tasks/`, `docs/intent/`).
  - Edit Firefly III descriptions/tags/notes manually per split outside canonical product linking.

---

## 9. Success Criteria

1. In `Firefly Backlog`, a multi-store item like `"Banane Bio"` can be filtered by **Chain** or **Store**, expanded across **Chain → Store → Individual Splits**, and linked in subsets to distinct branded products without overwriting each other's store/chain suggestions.
2. Within the **same store** (e.g. a gas station), individual splits can be checkbox-selected and linked to different products (*Diesel Standard* vs *Premium Diesel*).
3. Linking a `loose_weight` item from Backlog never injects a fake `1.0 kg`/`1.0 L` into Analytics; its `PriceRecord` enters `Missing & To Review` with `normalized_unit_price = null`.
4. Existing `firefly_sync` `loose_weight` records are flagged `needs_review` (while `packaged`, `receipt`, and `manual` stay `verified`), and every `PriceRecord` can be edited (`quantity`, `unit`, `is_discount`, `regular_price`) or 1-click confirmed from both Backlog and `CatalogPage` Price History.
5. Typing either `quantity` or `€/kg`/`€/L` in the split editor computes the counterpart live and saves `paid_price` + `quantity` (+ `regular_price`) locally as `verified`, surviving subsequent `product_propagate` and sync runs.

---

## 10. Out of Scope (Deferred to V2)

- **Standalone flat "All Transactions / Synced Splits" page:** Deferred unless Backlog drill-down + `Missing & To Review` proves insufficient for bulk historical entry.
- **Per-split manual Firefly field editor:** Editing arbitrary Firefly split descriptions, tags, categories, or notes individually without linking to a canonical product remains out of scope.
- **Automated OCR/AI weight extraction from receipt attachments:** Retroactively inferring grams/liters from stored receipt images without manual entry is deferred.

---

## 11. Open Questions

None — all design decisions were resolved during intent extraction, ideation, and review. Ready for implementation planning upon spec approval.
