# Spec: Meal Voucher Asset Accounts & Recharge — V1

- **Status:** proposed
- **Issue:** [#6 — feat: new account type meal voucher](https://github.com/fabriziocacicia/my-firefly/issues/6)
- **Intent:** [meal-voucher-accounts.md](../intent/meal-voucher-accounts.md)
- **Date:** 2026-11-25

---

## Assumptions Surfaced

1. **Integer-cent arithmetic:** All balance-multiple checks (`balance_cents % unit_value_cents == 0`) and usable voucher counts (`balance_cents // unit_value_cents`) are computed in integer cents (`round(value * 100)`) to avoid IEEE-754 floating-point drift (e.g. `51.60 / 5.16`).
2. **Dedicated `asset_account_metadata` table:** Rather than overloading `account_metadata` (which tracks *expense* accounts and `company_id` retail chain links), asset-account configuration is stored in a dedicated `asset_account_metadata` table keyed by `firefly_account_id` with an extensible `asset_type` enum (`standard`, `meal_voucher`).
3. **Firefly III remains sole balance truth:** Local SQLite stores *configuration* only (`asset_type`, `voucher_unit_value`, `default_revenue_account_id`, `default_recharge_description`, `notes`), never a cached balance or local voucher ledger.
4. **Historical receipt stability:** `Receipt.voucher_unit_value` continues to snapshot the voucher unit value onto each `Receipt` record so future changes to an account's unit value do not mutate historical receipts.
5. **Non-multiple balance policy on receipts:** When an asset account's Firefly balance is not an exact multiple of `voucher_unit_value`, the UI and API surface a mismatch warning and cap spendable vouchers at `max(0, balance_cents // unit_value_cents)` (whole units only), rather than blocking all spending until manual Firefly cleanup.

---

## 1. Objective

Provide first-class management of Firefly III **asset accounts** inside Firefly Hub, starting with `meal_voucher` classification (`standard` vs. `meal_voucher`, extensible to future types such as `gift_card`, `bank_account`, `cash`).

Specifically, V1 delivers:
1. **Asset Accounts Management View** (new `Asset Accounts` tab on `AccountsAndChainsPage`): lists all Firefly III asset accounts with their live Firefly balance, type badge (`Standard` / `Meal Voucher`), configured voucher unit value, computed whole-voucher count, and an immediate mismatch warning whenever `current_balance` is not an exact multiple of `voucher_unit_value`.
2. **Meal Voucher Configuration & Employer Association:** Flag/unflag an asset account as `meal_voucher`, configure its `voucher_unit_value` (in EUR, `> 0`), and set an editable default employer **revenue account** (fetched live from Firefly III) plus an optional default recharge description.
3. **Recharge Action (`count`, `date`, `time`):** Trigger a Firefly III `deposit` transaction from the employer revenue account into the meal-voucher asset account for exact amount `count × voucher_unit_value` at the specified date and time.
4. **Receipt Workbench Whole-Voucher Enforcement:**
   - Lock/auto-fill `voucher_unit_value` from the selected meal-voucher account's metadata (preventing manual price typos).
   - Remove the hardcoded `0–8` voucher cap; enforce `0 <= voucher_count <= min(usable_vouchers_from_firefly, floor(receipt_total / voucher_unit_value))`.
   - Allow `€0.00` remainder (100% paid by vouchers) without requiring a separate card/cash `source_account_id`.
   - Keep `split_vouchers` sequential item partitioning in Firefly III (`voucher_count × voucher_unit_value` from voucher account + exact remainder from chosen card/cash account).

---

## 2. Tech Stack

- **Backend:** Python 3.11+, FastAPI (`>=0.110.0`), SQLModel (`>=0.0.16`), SQLite with Alembic (`>=1.13.1`), `httpx` (`>=0.27.0`), Pydantic v2.
- **Frontend:** React 18 (`^18.2.0`), TypeScript (`^5.2.2`), Vite (`^5.1.6`), Tailwind CSS (`^3.4.1`), Lucide React (`^0.359.0`).

---

## 3. Commands

```bash
# Backend tests (from backend/)
pytest

# Focused backend tests (from backend/)
pytest tests/test_asset_accounts.py tests/test_receipt_workbench.py -v

# Backend dev server (from backend/)
uvicorn app.main:app --reload --port 8000

# Database migration (from backend/)
alembic upgrade head

# Frontend type-check & production build (from frontend/)
npm run build

# Frontend dev server (from frontend/)
npm run dev
```

---

## 4. Project Structure & Proposed Changes

### Backend
- `backend/app/models/asset_account.py` *(new)*:
  - `AssetAccountType(str, Enum)`: `STANDARD = "standard"`, `MEAL_VOUCHER = "meal_voucher"` (extensible enum + `TypeDecorator` matching `AccountRoleType`).
  - `AssetAccountMetadata(SQLModel, table=True)`:
    - `firefly_account_id: int` (PK)
    - `asset_type: AssetAccountType = AssetAccountType.STANDARD`
    - `voucher_unit_value: Optional[float] = None` (required `> 0` when `asset_type == meal_voucher`)
    - `default_revenue_account_id: Optional[int] = None`
    - `default_recharge_description: Optional[str] = None`
    - `notes: Optional[str] = None`
    - `created_at`, `updated_at`
- `backend/migrations/versions/0008_asset_account_metadata.py` *(new)*: Alembic migration creating `asset_account_metadata` (plus `auto_migrate_sqlite_columns` / `SQLModel.metadata.create_all` safety).
- `backend/app/services/firefly.py`:
  - Add `get_all_revenue_accounts()` (`_get_all_accounts_by_type("revenue")`) and `get_account_by_id(account_id, expected_type)` helper.
  - Add `create_voucher_recharge_deposit(...)` posting a Firefly III `deposit` transaction (`type: "deposit"`, `source_id: revenue_account_id`, `destination_id: voucher_account_id`, `amount`, `date`, `description`, `notes`).
- `backend/app/services/vouchers.py` *(new)*:
  - Pure integer-cent calculation helpers (`compute_voucher_balance_status(balance, unit_value)`) returning:
    - `usable_vouchers: int`
    - `is_exact_multiple: bool`
    - `remainder_cents: int` (discrepancy from exact multiple)
    - `max_vouchers_for_total(total_amount, unit_value, usable_vouchers) -> int`
- `backend/app/api/v1/firefly.py`:
  - Enhance `GET /api/v1/firefly/asset-accounts` to hydrate `asset_type`, `voucher_unit_value`, `default_revenue_account_id`, `default_revenue_account_name` (if resolved), `default_recharge_description`, `usable_vouchers`, `is_exact_multiple`, `balance_discrepancy`.
  - Add `GET /api/v1/firefly/revenue-accounts` returning active Firefly III revenue accounts (`id`, `name`).
- `backend/app/api/v1/asset_accounts.py` *(new, registered in `router.py`)*:
  - `PUT /api/v1/asset-accounts/{account_id}/metadata`: validate `meal_voucher` invariants (`voucher_unit_value > 0`, optional `default_revenue_account_id` validated against Firefly if provided) and persist config.
  - `POST /api/v1/asset-accounts/{account_id}/recharge`: accepts `{ count: int (> 0), recharge_date: date, recharge_time: time, revenue_account_id?: int, description?: str, notes?: str }`, verifies account is `meal_voucher` with `voucher_unit_value > 0`, resolves `revenue_account_id` (payload override or `default_revenue_account_id`, 400 if neither set), computes exact `amount = count * voucher_unit_value`, creates Firefly deposit, and returns transaction summary + refreshed live balance/voucher count.
- `backend/app/api/v1/receipts.py`:
  - Update `_validate_firefly_accounts(receipt)` and `create_receipt` / `update_receipt` / `push_receipt_to_firefly`:
    - When `payment_mode == "split_vouchers"`:
      - Compute `card_remainder = round(receipt.total_amount - voucher_count * voucher_unit_value, 2)`.
      - Require `source_account_id` **only if** `card_remainder > 0.0`.
      - Enforce whole-voucher ceiling: `voucher_count * voucher_unit_value <= receipt.total_amount + 1e-9` (cannot spend more voucher face value than receipt total).
      - When `voucher_account_id` is configured as `meal_voucher` in `AssetAccountMetadata`, validate `voucher_unit_value` matches configured value (or auto-apply it) and verify `voucher_count <= usable_vouchers` from live Firefly balance (returning HTTP 422 with clear message if insufficient vouchers).

### Frontend
- `frontend/src/types/index.ts` & `frontend/src/api/client.ts`:
  - Add `AssetAccountType`, extended `FireflyAssetAccount` fields (`asset_type`, `voucher_unit_value`, `default_revenue_account_id`, `default_recharge_description`, `usable_vouchers`, `is_exact_multiple`, `balance_discrepancy`), `FireflyRevenueAccount`, and `api.assetAccounts.updateMetadata` / `api.assetAccounts.recharge` / `api.firefly.getRevenueAccounts`.
- `frontend/src/pages/AccountsAndChainsPage.tsx` (and extracted components under `frontend/src/components/accounts/`):
  - Add third tab: **Asset Accounts** (`Expense Accounts` | `Chains` | `Asset Accounts`).
  - Show all Firefly asset accounts with live balance, `Standard` vs. `Meal Voucher` badge, unit value, computed voucher count, and amber mismatch alert when `!is_exact_multiple`.
  - Provide **Configure** modal (set type `Standard` / `Meal Voucher`, `voucher_unit_value`, default employer revenue account selector, default recharge description) and **Recharge** modal (`count`, `date`, `time`, optional override of employer revenue account & description, live preview of deposit amount `count × unit_value` and resulting new voucher total).
- `frontend/src/components/workbench/WorkbenchHeader.tsx` (and `ReceiptWorkbenchPage.tsx`):
  - **Conditional visibility:** If no Firefly asset account is configured as `meal_voucher` (and the loaded receipt/draft is not already in `split_vouchers` mode), hide the *"Split with Vouchers (Buoni Pasto)"* toggle completely.
  - When `split_vouchers` is active:
    - Voucher account selector lists flagged `meal_voucher` accounts (auto-selected if exactly one exists; existing legacy drafts referencing an unflagged account still render safely).
    - Display locked voucher unit value badge (derived from selected account metadata) instead of free-form manual input when account is flagged as `meal_voucher`.
    - Replace hardcoded `0–8` voucher count cap with live `maxVouchers = Math.min(usableVouchers, Math.floor(totalCents / unitValueCents))`, showing available balance, usable vouchers, and any Firefly balance-mismatch warning inline.
    - Show card/cash `Primary Source Account` as optional/not required when `cardRemainder === 0`.

---

## 5. Code Style

Follow existing FastAPI + SQLModel + TypeScript patterns:
- Integer-cent math in pure service helpers (`backend/app/services/vouchers.py`) with zero Firefly/DB side effects so unit tests run hermetically.
- Pydantic request validation and explicit HTTP 400/422/502 error messages matching `accounts.py` and `receipts.py`.
- Keep new frontend components focused and under 200 lines per component (`AssetAccountsTab`, `AssetAccountConfigModal`, `VoucherRechargeModal`) instead of growing `AccountsAndChainsPage.tsx` further.

---

## 6. Testing Strategy

- **Backend (`pytest` with mocked `firefly_client`, matching `test_receipt_workbench.py`):**
  - Unit tests for `compute_voucher_balance_status` (exact multiples like `51.60 / 5.16 -> 10, exact`, non-multiples like `50.00 / 5.16 -> 9, mismatch 3.56`, zero/negative balances).
  - API tests for `PUT /api/v1/asset-accounts/{id}/metadata` (validation of `unit_value > 0` for `meal_voucher`, clearing/preserving fields, updating `default_revenue_account_id`).
  - API tests for `POST /api/v1/asset-accounts/{id}/recharge` (exact `count * unit_value` payload, date+time ISO formatting, revenue account default vs. override, error when no revenue account configured or account is `standard`).
  - API tests for `POST /api/v1/receipts/{id}/push-to-firefly` with `split_vouchers` covering:
    - 100% voucher payment (`card_remainder == 0`, `source_account_id is None`) succeeds with 1 voucher transaction.
    - Over-total voucher count (`count * unit_value > total_amount`) rejected with 422.
    - Insufficient Firefly voucher balance (`count > usable_vouchers`) rejected with 422.
- **Frontend:** `npm run build` (`tsc && vite build`) passes with zero TypeScript or bundle errors.

---

## 7. Boundaries

- **Always do:**
  - Keep Firefly III as the single source of truth for balances; compute voucher counts dynamically from live Firefly `current_balance`.
  - Use integer-cent math for all voucher count and remainder checks.
  - Validate user inputs on both frontend and backend.
  - Preserve existing receipt drafts and historical `Receipt.voucher_unit_value` snapshots.
- **Ask first:**
  - Before changing `Receipt` table schema or altering how `workflows.py` (`/workflows/meal-voucher-split`) behaves.
  - Before auto-deleting or modifying any existing Firefly III transactions during non-multiple warnings.
- **Never do:**
  - Store or decrement a local voucher balance counter in SQLite.
  - Allow partial-voucher spending (`voucher_count` must always be a non-negative integer).
  - Require a card/cash source account when `card_remainder == 0`.
  - Build other asset types (`gift_card`, `bank_account`, `cash`) in V1.

---

## 8. Success Criteria

- [ ] Asset Accounts tab displays all Firefly III asset accounts with live Firefly balances.
- [ ] Any asset account can be flagged as `meal_voucher` with a positive `voucher_unit_value` and an editable `default_revenue_account_id`.
- [ ] Meal-voucher accounts display computed whole-voucher count and show a clear warning with discrepancy whenever Firefly balance is not an exact multiple of `voucher_unit_value`.
- [ ] **Recharge** creates a Firefly III `deposit` transaction from the employer revenue account to the voucher asset account for `count × voucher_unit_value` using the specified `date` and `time`.
- [ ] Receipt Workbench locks `voucher_unit_value` to the flagged account's configured value, removes the hardcoded 8-voucher limit, blocks exceeding `min(usable_vouchers, floor(total / unit_value))`, and permits `€0.00` card remainder without selecting a card/cash account.
- [ ] Backend `pytest` suite and frontend `npm run build` pass cleanly.

---

## 9. Out of Scope (Deferred)

- **Other asset account categories (`gift_card`, `bank_account`, `cash`):** Enum/model supports extension, but UI and behavior for other categories are deferred to future issues.
- **Automated / recurring employer recharges:** Monthly scheduled/auto-detected deposits are deferred.
- **Partial-voucher consumption or change-forfeiture:** Vouchers are strictly whole units with `count × unit_value <= total_amount`.
- **Retroactive Firefly transaction edits:** Changing an account's `voucher_unit_value` applies forward-only.
- **Quick Workflows (`/workflows/meal-voucher-split`) overhaul:** Legacy standalone workflow stays untouched unless explicitly requested later.

---

## 10. Resolved Decisions (Ex Open Questions)

1. **Timezone for Recharge `date` + `time`:** Send `YYYY-MM-DDTHH:MM:SS` **without** an explicit UTC/timezone offset (matching [`_build_firefly_tx_payload`](../../backend/app/api/v1/receipts.py#L194)), so Firefly III automatically interprets the timestamp in the Firefly III server's configured timezone.
2. **Visibility in `WorkbenchHeader` when no `meal_voucher` account exists:** Having meal-voucher accounts is optional; if none are flagged as `meal_voucher` (and the current receipt is not already a legacy `split_vouchers` draft), hide the *"Split with Vouchers"* option on the Receipt Workbench.
