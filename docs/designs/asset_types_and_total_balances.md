# Spec Delta: Asset Account Types & Categorized Balance Totals

- **Status:** implemented
- **Issue:** [#18 — feat: new assets type and total balance](https://github.com/fabriziocacicia/my-firefly/issues/18)
- **Base Spec:** [Meal Voucher Asset Accounts & Recharge — V1](meal_voucher_asset_accounts.md)
- **Date:** 2026-11-25

---

## Assumptions Surfaced

1. **Backwards-compatible enum extension (no DB migration required):** `asset_account_metadata.asset_type` is already stored as `VARCHAR(32)` via `AssetAccountTypeDecorator` without a SQL `CHECK` constraint (`0008_asset_account_metadata.py`). Extending `AssetAccountType` with `bank_account`, `cash`, and `digital_credit` works seamlessly with existing rows and unconfigured accounts (defaulting to `standard`).
2. **Pure classification types:** `bank_account`, `cash`, and `digital_credit` are pure classification types using the existing `notes` field—they do not introduce extra metadata fields or special Firefly recharge/voucher workflows.
3. **Active accounts, net-worth flag & multi-currency grouping:** Balance totals sum **active** accounts only (`active !== false`) using integer-cent arithmetic (`to_cents`) to prevent floating-point drift, grouped by `currency_code` (defaulting null currency to `EUR`) whenever accounts span multiple currencies. Specifically, the headline **Total Active Assets** banner sums only active accounts flagged `include_net_worth = true` on Firefly III, whereas the per-type breakdown cards sum all active accounts of each categorized type regardless of `include_net_worth`.
4. **Categorized-only breakdown:** The collapsible breakdown inside the summary banner shows only the four categorized types (`Bank Account`, `Cash`, `Digital Credit`, `Meal Voucher`) and excludes `Standard` (unclassified/default).
5. **Client-side aggregation vs. API:** Because `GET /api/v1/firefly/asset-accounts` already returns all asset accounts with `asset_type`, `current_balance`, `currency_code`, and `active`, totals can be computed deterministically in the frontend (with shared integer-cent logic) or exposed via helper functions without extra Firefly API calls.

---

## 1. Objective

Extend asset account classification beyond `standard` and `meal_voucher` to support **Bank Account** (`bank_account`), **Cash** (`cash`), and **Digital Credit** (`digital_credit`), and surface an aggregate total balance banner with a collapsible per-type breakdown for categorized accounts in the **Asset Accounts** tab.

---

## 2. Current Behavior

From [Meal Voucher Asset Accounts & Recharge — V1](meal_voucher_asset_accounts.md):
- `AssetAccountType` (backend `asset_account.py` & frontend `types/index.ts`) supports only `standard` and `meal_voucher`.
- `AssetAccountConfigModal` offers two type choices (`Standard` and `Meal Voucher`).
- `AssetAccountsTab` provides three filter pills (`All`, `Meal Vouchers`, `Standard`) and renders each account card with either a `Meal Voucher` or `Standard` badge; no total balances are displayed.

---

## 3. New Behavior

### Backend (`backend/app/models/asset_account.py`, `backend/app/api/v1/asset_accounts.py`)
- Extend `AssetAccountType` enum with:
  - `BANK_ACCOUNT = "bank_account"`
  - `CASH = "cash"`
  - `DIGITAL_CREDIT = "digital_credit"`
- `PUT /api/v1/asset-accounts/{account_id}/metadata`:
  - Accepts `standard`, `bank_account`, `cash`, `digital_credit`, and `meal_voucher`.
  - For non-`meal_voucher` types (`standard`, `bank_account`, `cash`, `digital_credit`), persists `asset_type` and `notes`, while clearing meal-voucher-specific fields (`voucher_unit_value`, `default_revenue_account_id`, `default_recharge_description`) to `None`.
- `POST /api/v1/asset-accounts/{account_id}/recharge` and `receipts.py` meal-voucher logic remain restricted to `meal_voucher` accounts (no change).

### Frontend (`frontend/src/types/index.ts`, `frontend/src/components/accounts/`)
- **Type definitions & metadata map:**
  - Extend `AssetAccountType` to `'standard' | 'bank_account' | 'cash' | 'digital_credit' | 'meal_voucher'`.
  - Define a single shared UI config mapping each `AssetAccountType` to its label, short filter label, icon (`Landmark`, `Banknote`, `Coins`, `Ticket`, `Wallet`), and badge/accent colors (`sky` for Bank Account, `emerald` for Cash, `violet` for Digital Credit, `amber` for Meal Voucher, `slate` for Standard).
- **Summary Banner + Collapsible Breakdown (`AssetAccountsTab` / extracted summary component):**
  - Rendered at the top of the **Asset Accounts** tab above the search/filter bar.
  - **Banner header:** Displays the headline **Total Active Assets** summing **active asset accounts across every type (including `Standard`) that have `include_net_worth = true` in Firefly III**, grouped per currency if multiple currencies exist, along with a toggle button (`Hide breakdown` / `Show breakdown`).
  - **Collapsible breakdown:** Shows the 4 categorized types (`Bank Account`, `Cash`, `Digital Credit`, `Meal Voucher`) — omitting `Standard` — with each type's active account count and summed active balance across **all** active accounts of that type (regardless of `include_net_worth`, per currency if mixed). Categorized types with `0` active accounts still appear as `€0.00 (0)`. Clicking a breakdown item sets/toggles the active type filter below.
- **Filter Pills & Cards (`AssetAccountsTab`):**
  - Filter pill bar includes `All`, `Bank`, `Cash`, `Digital Credits`, `Meal Vouchers`, and `Standard` with account counts.
  - Each account card renders its type-specific icon container and colored badge (`Bank Account`, `Cash`, `Digital Credit`, `Meal Voucher`, or `Standard`).
- **Configure Modal (`AssetAccountConfigModal`):**
  - Account Type selector displays all 5 options (`Standard`, `Bank Account`, `Cash`, `Digital Credit`, `Meal Voucher`) with icons and concise subtitles.
  - Selecting `Bank Account`, `Cash`, or `Digital Credit` shows only the type selector and `Notes (Optional)` (no voucher fields).

---

## 4. Tech Stack & Commands

Inherits from [base spec](meal_voucher_asset_accounts.md#2-tech-stack):
- **Backend tests (from `backend/`):** `pytest` (focused: `pytest tests/test_asset_accounts.py -v`)
- **Frontend type-check & build (from `frontend/`):** `npm run build` (or `bun run build`)
- **Frontend unit tests (from `frontend/`):** `bun test src/components/accounts/assetTypeUtils.test.ts`

---

## 5. Testing Strategy

- **Backend (`backend/tests/test_asset_accounts.py`):**
  - Unit/model deserialization tests for `bank_account`, `cash`, `digital_credit` (case-insensitive `AssetAccountTypeDecorator`).
  - API `PUT /api/v1/asset-accounts/{id}/metadata` tests configuring `bank_account`, `cash`, and `digital_credit`, verifying persistence, `notes` handling, and clearing of prior `meal_voucher` fields when switching types.
  - API `GET /api/v1/firefly/asset-accounts` hydration test returning `bank_account`, `cash`, `digital_credit` accounts cleanly with `usable_vouchers = None`.
  - Guard check: `POST /api/v1/asset-accounts/{id}/recharge` continues rejecting `bank_account` / `cash` / `digital_credit` with HTTP 400.
- **Frontend:**
  - `npm run build` / `bun run build` (`tsc && vite build`) passes cleanly with zero errors.
  - Unit tests (`bun test`) for the pure balance-summing / currency-grouping helper (active vs. inactive exclusion, multi-currency grouping, categorized-only total, decimal-safe integer-cent accuracy).

---

## 6. Boundaries (Delta from Base Spec)

- **Always do:**
  - Keep `Standard` out of the collapsible type breakdown (only categorized types: `bank_account`, `cash`, `digital_credit`, `meal_voucher`).
  - Exclude inactive Firefly accounts (`active === false`) from balance totals.
  - Compute totals in integer cents and group by currency code when multiple currencies are present.
- **Ask first:**
  - Before adding type-specific extra metadata columns (e.g., digital credit expiry, IBAN/bank name) or showing asset totals on other pages/tabs.
- **Never do:**
  - Break `meal_voucher` recharge or Receipt Workbench voucher enforcement.
  - Sum balances across different currencies into one number.

---

## 7. Success Criteria

- [x] Asset accounts can be configured as `bank_account`, `cash`, `digital_credit`, `meal_voucher`, or `standard` via API and `AssetAccountConfigModal`.
- [x] Asset account cards and filter pills display distinct icons, labels, and badges for all 5 types.
- [x] A collapsible summary banner at the top of the **Asset Accounts** tab displays total active balance and a per-type breakdown for categorized types only (`Bank Account`, `Cash`, `Digital Credit`, `Meal Voucher`), excluding `Standard` and inactive accounts.
- [x] Multi-currency active accounts are summed cleanly per currency without mixing currencies.
- [x] Clicking a type in the breakdown filters the account cards below (and syncs with the filter pill bar).
- [x] Existing `meal_voucher` recharge and Receipt Workbench flows remain unchanged and passing.
- [x] Backend `pytest` and frontend build/tests pass.

---

## 8. Out of Scope (Deferred)

- Extra per-type metadata fields (e.g., bank institution, digital credit expiration date, credit limit).
- Global net-worth / asset summary widgets on other pages (`Navbar`, `ReceiptWorkbenchPage`).
- Filtering Receipt Workbench `Primary Source Account` dropdown by asset type.

---

## 9. Resolved Decisions (Ex Open Questions)

1. **Banner Headline Total:** Sums **active asset accounts across all types (including `Standard`) flagged `include_net_worth = true` on Firefly III**, while the collapsible breakdown beneath it lists the 4 categorized types (`Bank Account`, `Cash`, `Digital Credit`, `Meal Voucher`) summing all active accounts of each type regardless of `include_net_worth`.
2. **Zero-Count Categorized Types:** All 4 categorized types always appear in the collapsible breakdown, displaying `€0.00 (0)` when no active accounts are assigned to that type.
