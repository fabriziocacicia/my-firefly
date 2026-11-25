# Firefly III Companion Hub: V1 Fast Receipt Entry Workbench & Product Price Charting

* **Author:** Fabrizio
* **Status:** Approved
* **Date:** 2026-11-09

--------------------------------------------------------------------------------

## Overview

The Firefly III Companion Hub is a dedicated sidecar web application for self-hosted Firefly III instances. Firefly III functions as an authoritative double-entry general ledger for net-worth calculation, asset tracking, and macro budgeting, but it treats supermarket shopping as single withdrawal sums (e.g., €84.50 at Conad). It intentionally omits itemized receipt tracking, packaging variations, normalized unit pricing (€/kg, €/L), corporate retail chain hierarchies, and multi-asset split payment balancing.

This system provides an operational layer for grocery itemization, local receipt file archiving, and cross-store price intelligence. It computes normalized unit prices, evaluates current prices against historical baselines, and pushes verified, positive-split transactions into Firefly III via its REST API, preserving Firefly III as the sole authoritative financial ledger.

## The Problem

1. **High Logging Friction Leading to Abandonment:** Logging 20 to 40 grocery items manually on a standard web form requires 8 to 12 minutes per shopping trip. Without an interface optimized for both desktop keyboard entry and mobile touchscreens, manual itemization becomes a chore that gets abandoned.
2. **Ergonomic Entry Mode Trade-offs (Spreadsheet Grid vs. Sequential Card Entry):** A wide tabular spreadsheet grid is effective for full-receipt visual auditing on desktop, but causes cramped scrolling on mobile screens and high horizontal eye-scanning overhead even on large monitors when rapid sequential typing is preferred. Conversely, a focused sequential card workflow works comfortably on touchscreens and also appeals to desktop users who prefer inputting one item at a time into a running register tape, provided the layout adapts responsively to wide screens.
3. **Lack of Unit-Normalized Price Comparison:** Retailers sell identical commodities in varying package formats (e.g., 500g vs. 1kg pasta, 330ml can vs. 6-pack). Without normalizing all prices to standard units (€/kg or €/L), consumers cannot determine which supermarket or packaging size offers the true lowest price.
4. **Receipt Total Transcription Errors:** When manually itemizing long receipts, transcription typos or missed rows cause the entered item sum to diverge from the physical receipt total, creating reconciliation headaches.
5. **Firefly Double-Entry Invariants vs. Basket Discounts:** Firefly III strictly rejects negative split amounts in withdrawal transactions (`422 Unprocessable Entity`), making it impossible to record store-wide coupons or loyalty discounts as negative lines without specialized prorating.
6. **Multi-Source Payment Complexity (Meal Vouchers + Card):** Italian grocery shopping is frequently paid with a combination of meal vouchers (Buoni Pasto) and debit card/cash for the remainder. Firefly III requires separate transactions per source asset account, making manual entry tedious.

## Goals

* **G1: Dual Synchronized Receipt Entry Modes:** Provide two synchronized, user-selectable views operating over a shared draft state persisted across mode switches:
  - **Tabular Data Grid:** Dense spreadsheet-style matrix table with full-row keyboard navigation (`Tab`/`Enter`) for bulk visual overview.
  - **Responsive Sequential Card Stream:** A single-focus input card that prepends confirmed items to a scrollable "register tape" feed, engineered to adapt responsively across both mobile touchscreens (vertical stack) and desktop monitors (2-column split with fast keyboard submission).
* **G2: Real-Time Sum Reconciliation:** Display a persistent header calculating the item sum against the physical receipt total, providing visual discrepancy badges (`Δ = €0.00`) across both entry views before committing.
* **G3: Atomic Dual-Persistence:** Saving a receipt atomically creates both the financial line items (`ReceiptItem`) and the price intelligence observations (`PriceRecord`) in a single database transaction.
* **G4: Unit Normalization & Deal Intelligence:** Compute normalized unit prices (€/kg, €/L, €/pc) derived directly from `paid_price` (the actual billed price) and score deals against lifetime baseline regular prices (median) and all-time low records.
* **G5: Product Price Trend & Multi-Store Line Chart:** For any catalog product, display a line graph plotting its normalized price history over time, with the ability to see observations across all stores together and break trend lines down by store.
* **G6: Ledger Matching & Multi-Asset Split Push:** Support pushing itemized receipts to Firefly III as positive-split withdrawals where general discounts are prorated across items. Support both single-source payments (e.g. Card) and multi-source payments (e.g. Meal Vouchers + Card Remainder as two balanced transactions).
* **G7: Local Receipt Document Archiving:** Allow attaching receipt photos or PDFs stored directly on a persistent Docker volume (`data/receipts/`), linked to the companion receipt record.
* **G8: Strict Account Mapping Invariants:** Require that both the destination store (`firefly_account_id`) and source payment account(s) are valid, mapped Firefly accounts before permitting a ledger push.

## Non-Goals

* **NG1: Autonomous OCR Without Verification:** Fully automated receipt ingestion without user verification is out of scope for V1.
* **NG2: Bank Reconciliation & External Banking Feeds:** Ingestion of bank CSV statements or duplicate matching against automated banking feeds is excluded.
* **NG3: Replacing Firefly III Core Accounting:** The companion hub will not calculate overall account balances, net worth, investment portfolios, or handle non-shopping accounting.
* **NG4: Direct Database Modification of Firefly III:** The companion hub will never write directly to Firefly III's database or alter its migration schema; all interactions use the official REST API.
* **NG5: Cloud Storage Dependency:** Receipt files and database records are stored strictly on local host storage (Docker volume) without third-party cloud services.

## Open Questions

* None currently open; foundational constraints, ledger invariants, packaging mechanics, and payment resolution are defined in this specification.

## Critical User Journeys (CUJs)

### CUJ 1: Fast Receipt Itemization with View Switching & Split Payment
* **Given**: A user holds a paper supermarket receipt from Conad totaling €32.50 with 12 items, paid with 2 meal vouchers (€5.16 each = €10.32) and the remainder (€22.18) on their debit card.
* **When**: The user opens the workbench, selects "Conad City", sets `Target Total` to `32.50`, enables `"Split with Vouchers"` (selecting Buoni Pasto + Primary Card), attaches a photo of the receipt, and logs items using either the Card Stream or Tabular Data Grid.
* **Then**: The draft state synchronizes immediately across both entry views. The discrepancy indicator confirms $\Delta = €0.00$. Committing saves the receipt, attachments, and price records to SQLite, and creates two balanced itemized transactions in Firefly III:
  1. **Voucher Withdrawal (€10.32)**: Contains the initial receipt items sequentially until €10.32 is reached. The boundary item sitting on the crossover is divided so its voucher portion completes the €10.32 total as the final split of this transaction.
  2. **Debit Card Withdrawal (€22.18)**: Contains the remainder of the boundary crossover item as its first split, followed by all remaining receipt items at their full prorated amounts, summing to exactly €22.18.

### CUJ 2: Product Price History & Cross-Store Comparison
* **Given**: The user wants to check past prices for "De Cecco Penne Rigate N.41" before going shopping.
* **When**: The user opens the Price History view for the product.
* **Then**: The interface displays a line graph showing:
  1. Individual observations plotted chronologically across all purchases in normalized units (`€/kg`, `€/L`, or `€/pc`).
  2. Individual connected lines per store (e.g., Conad in blue, Lidl in green) when filtered or enabled via legend checkboxes.
  3. A horizontal reference line for the normalized lifetime regular baseline (`€/kg` median), alongside package-level deal badges indicating past all-time low sale prices.

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

### 1. High-Level System Topology

```mermaid
graph TD
    subgraph Browser Client [Frontend: React + Vite + Tailwind CSS]
        STATE[Draft Receipt State Store]
        V_SWITCH{View Switcher}
        GRID[Tabular Data Grid: Spreadsheet Entry]
        STREAM[Card Stream View: Responsive Focus Input & Tape]
        CHART[Product Price History Chart: Per-Store & Baseline]
        
        STATE <--> V_SWITCH
        V_SWITCH --> GRID
        V_SWITCH --> STREAM
    end

    subgraph Companion Server [Backend: Python FastAPI + SQLModel]
        API_R[Receipts API Router /api/v1/receipts]
        API_P[Prices API Router /api/v1/prices]
        NORM[Pricing Normalization & Deal Engine]
        DB[(Local SQLite: companion.db)]
        VAULT[/Docker Volume: data/receipts/]
        FF_CLIENT[Firefly III HTTP Client]
    end

    subgraph Firefly Server [Authoritative Ledger: Firefly III Docker]
        FF_API[Firefly REST API v1]
        FF_DB[(Firefly Master Ledger DB)]
    end

    GRID & STREAM -->|1. POST /receipts JSON & 2. POST /attachments| API_R
    API_R --> NORM
    NORM -->|Atomic Transaction: Receipt + ReceiptItems + PriceRecords| DB
    API_R --> VAULT
    API_R -->|Push Positive Splits with Prorated Discounts| FF_CLIENT
    FF_CLIENT -->|HTTP Bearer Auth /api/v1/transactions| FF_API
    FF_API --> FF_DB

    CHART -->|GET /prices/history/{product_id}| API_P
    API_P --> DB
```

### 2. Frontend Component Architecture

#### A. Unified Draft Receipt State (`ReceiptWorkbenchContext`)
Mounted at the root application level (`App.tsx`) so tab navigation preserves active receipt drafts. Both views consume and update a single in-memory reactive draft state persisted across mode switches and browser reloads (subject to a 300ms `localStorage` debounce under `firefly_receipt_draft`, plus client `IndexedDB` under `draft_receipt_file` via `idb-keyval`):
* `store_id`: ID of the store where items were bought (maps to a Firefly expense account).
* `purchase_date`: ISO date string (defaults to today).
* `target_total`: Physical receipt amount typed by the user.
* `basket_discount`: Total cart-wide voucher or coupon value (persisted to SQLite `Receipt.basket_discount`).
* `notes`: Optional receipt notes (forwarded to Firefly withdrawal split `notes` and `Receipt.notes`).
* **Payment Allocation Configuration**:
  - `payment_mode`: `'single'` | `'split_vouchers'`.
  - `source_account_id`: Selected Firefly asset account (Card / Cash).
  - `voucher_account_id`: Selected Firefly asset account for meal vouchers.
  - `voucher_count`: Number of vouchers used (`0` to `8`).
  - `voucher_unit_value`: Fixed value per voucher (default `5.16`).
* `receipt_file`: Attached `File` or `Blob` object (persisted in client `IndexedDB` under key `draft_receipt_file`, protected by an `isHydrated` flag before overwrites).
* `items`: Array of `DraftReceiptItem` objects:
  - `temp_id`: Unique client UUID.
  - `product_id`: Number (linked to catalog `Product`).
  - `product_name`: String.
  - `brand_name`: Optional string.
  - `quantity`: Number (`> 0`, e.g., `2`, `1.25`).
  - `unit`: `'g' | 'kg' | 'ml' | 'l' | 'pcs'`.
  - `package_size`: Number (`> 0`, e.g., `500` for a 500g box).
  - `paid_price`: Number (`>= 0`, **actual billed unit price paid**).
  - `regular_price`: Optional number (defaults to `paid_price` if omitted).
  - `is_discount`: Boolean.
  - `line_total`: Computed as `Math.round(quantity * paid_price * 100) / 100`.

#### B. Live Reconciliation Meter & Payment Breakdown
A persistent header bar displays synchronized figures:
1. `Target Total`: What the user typed from the paper slip.
2. `Calculated Sum`: $\sum \text{line\_total} - \text{basket\_discount}$.
3. `Discrepancy (Δ)`: $\text{Calculated Sum} - \text{Target Total}$.
   - If $|\Delta| \le 0.01$ and `target_total > 0`: Green checkmark indicator (`Balanced`).
   - Otherwise: Prominent badge showing discrepancy amount (`-€0.40`).
4. **Payment Split Preview**:
   - In `'single'` mode: `100% on [Card Account Name]`.
   - In `'split_vouchers'` mode: shows `Vouchers: €XX.XX` + `Card Remainder: €XX.XX`.
5. **Purchase Date & Time Controls**: Captures both `purchase_date` (`date`) and `purchase_time` (`HH:MM`, mandatory in frontend), defaulting to current local time, ensuring itemized splits pushed to Firefly III reflect exact receipt transaction timestamps rather than generic defaults.

#### C. Tabular Data Grid View
* Spreadsheet-style matrix table selectable on any screen (defaults on viewports $\ge 768\text{px}$, horizontally scrollable via `overflow-x-auto` if selected on smaller viewports). Keeps uncommitted blank rows local until a valid product is selected.
* Keyboard shortcuts:
  - `Tab`: Moves focus horizontally across cells (`Product` → `Qty` → `Unit` → `Pkg Size` → `Paid Price` → `Regular Price`).
  - `Enter` in `Paid Price` (when combobox closed) or `Regular Price`: Commits the active row into `items`, clears the local entry row, and immediately focuses the Product combobox.
  - `Delete` / `Backspace` on an empty row (or Delete action): Removes the selected row.
* Inline product combobox with 150ms debounce against `api.products.list({ search })` (selecting a product auto-fills `unit`, `package_size`, and resets `quantity` to `1`).
* `"+ New Product"` button in combobox opens `InlineProductModal` (a compact modal) without unmounting or altering other draft rows.

#### D. Responsive Sequential Card Stream View
* User-selectable focused sequential entry mode usable on **both desktop monitors and mobile touchscreens** (defaults on viewports $< 768\text{px}$, and switchable at any time on desktop via the header toggle).
* **Responsive Layout**:
  - **Mobile (`< 768px`)**: Single vertical column with a pinned active focus card on top (`sticky top-0`) and the scrollable "Register Tape" stacked beneath, using large touch-friendly inputs (`>= 44px` height).
  - **Desktop (`>= 768px`)**: Responsive 2-column split (pinned Active Input Card on the left pane alongside the scrollable Register Tape feed on the right pane, within a balanced `max-w-6xl` container) so the card never stretches across wide monitors and remains ergonomically compact.
* **Keyboard & Touch Entry**:
  - Pressing `"Add Line"` or hitting `Enter` in the last price field **prepends** the row to the top of the Register Tape (preserving entry index `#`), clears the active card, and automatically refocuses the Product combobox for rapid desktop keyboard typing or mobile entry.
* Each card in the register tape displays: `#`, product name, quantity $\times$ unit, line total, and edit/delete actions. Tapping or clicking any card loads it back into the active card for in-place editing (`editingTempId` mode with `"Update Line"` / `"Cancel"` so totals remain accurate during edits).

#### E. Product Price History Chart
Accessed directly from catalog product cards or from receipt items:
* **Header**: Product Name, Brand, Base Unit (`€/kg`, `€/L`, or `€/pc`), Normalized Lifetime Regular Baseline (Median), Normalized All-Time Low Price.
* **SVG Chart**:
  - Plots normalized price observations (`normalized_unit_price`) chronologically across the X-axis.
  - **Aggregate View**: Displays observations as distinct color-coded scatter points per physical store alongside the horizontal normalized regular baseline line (preventing false sawtooth distortion between different supermarket chains).
  - **Per-Store Series Lines**: Connected trend lines drawn strictly for individual stores when filtered or enabled via legend checkboxes.
  - **Baseline Line**: Horizontal dashed line representing `analysis.normalized_baseline_regular_price` (`€/kg`, `€/L`, or `€/pc`).
  - **Tooltips**: Hover (desktop) or tap (mobile) displays date, store name, normalized price, raw `paid_price`, and sale indicator.

---

### 3. Backend & API Architecture

#### A. Database Schema Extensions (SQLModel)

```python
# In backend/app/models/price.py — add normalized regular & package_size columns to PriceRecordBase
package_size: Optional[float] = Field(default=None)
normalized_regular_price: Optional[float] = Field(default=None, description="Normalized regular shelf price (€/kg, €/L, €/pc)")

# In backend/app/models/receipt.py
from datetime import datetime, date, time
from typing import Optional, List, Literal
from pydantic import model_validator
from sqlmodel import SQLModel, Field, Relationship
from app.models.company import Store, StoreRead
from app.models.product import Product, ProductRead

class ReceiptBase(SQLModel):
    store_id: int = Field(foreign_key="store.id", index=True)
    purchase_date: date = Field(default_factory=date.today, index=True)
    purchase_time: Optional[time] = Field(default=None, description="Time of purchase on receipt (HH:MM:SS)")
    total_amount: float = Field(default=0.0)
    basket_discount: float = Field(default=0.0) # Persisted companion discount
    source_account_id: Optional[int] = Field(default=None, description="Primary Firefly asset account")
    payment_mode: str = Field(default="single", description="'single' or 'split_vouchers'")
    voucher_account_id: Optional[int] = Field(default=None, description="Firefly voucher asset account")
    voucher_count: int = Field(default=0)
    voucher_unit_value: float = Field(default=5.16)
    firefly_transaction_id: Optional[int] = Field(default=None, index=True)
    firefly_voucher_transaction_id: Optional[int] = Field(default=None, index=True)
    notes: Optional[str] = Field(default=None)

class Receipt(ReceiptBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    store: Optional[Store] = Relationship()
    items: List["ReceiptItem"] = Relationship(back_populates="receipt")
    attachments: List["ReceiptAttachment"] = Relationship(back_populates="receipt")

class ReceiptItemBase(SQLModel):
    receipt_id: int = Field(foreign_key="receipt.id", index=True)
    product_id: int = Field(foreign_key="product.id", index=True)
    quantity: float = Field(default=1.0)
    unit: str = Field(default="pcs")
    package_size: float = Field(default=1.0)
    paid_price: float # Actual billed price per unit
    regular_price: Optional[float] = Field(default=None) # Defaults to paid_price if omitted
    is_discount: bool = Field(default=False)
    line_total: float

class ReceiptItem(ReceiptItemBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    receipt: Optional[Receipt] = Relationship(back_populates="items")
    product: Optional[Product] = Relationship()

class ReceiptAttachmentBase(SQLModel):
    receipt_id: int = Field(foreign_key="receipt.id", index=True)
    filename: str
    stored_path: str # Relative to settings.STORAGE_DIR: "{sha256[:2]}/{sha256}.{ext}"
    file_type: str # e.g. "image/jpeg", "application/pdf"
    file_size_bytes: int
    sha256_hash: str

class ReceiptAttachment(ReceiptAttachmentBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)

    receipt: Optional[Receipt] = Relationship(back_populates="attachments")

# Request & Read Schemas
class ReceiptItemCreate(SQLModel):
    product_id: int
    quantity: float = Field(default=1.0, gt=0)
    unit: Literal["g", "kg", "ml", "l", "pcs"] = "pcs"
    package_size: float = Field(default=1.0, gt=0)
    paid_price: float = Field(ge=0)
    regular_price: Optional[float] = Field(default=None, ge=0)
    is_discount: bool = False

class ReceiptCreate(SQLModel):
    store_id: int
    purchase_date: date = Field(default_factory=date.today)
    total_amount: float = Field(gt=0)
    basket_discount: float = Field(default=0.0, ge=0)
    source_account_id: Optional[int] = None
    payment_mode: Literal["single", "split_vouchers"] = "single"
    voucher_account_id: Optional[int] = None
    voucher_count: int = Field(default=0, ge=0, le=8)
    voucher_unit_value: float = Field(default=5.16, gt=0)
    notes: Optional[str] = None
    items: List[ReceiptItemCreate] = Field(min_length=1)

class ReceiptItemRead(ReceiptItemBase):
    id: int
    product: Optional[ProductRead] = None

class ReceiptRead(ReceiptBase):
    id: int
    created_at: datetime
    store: Optional[StoreRead] = None
    items: List[ReceiptItemRead] = []
    attachments: List[ReceiptAttachment] = []

class ReceiptPushRequest(SQLModel):
    force: bool = False
```

#### B. API Endpoints
1. `POST /api/v1/receipts/`:
   - Accepts `application/json` payload (`ReceiptCreate`).
   - Validates `store_id` exists in SQLite (`Store`, `HTTP 404` if missing) and verifies every `item.product_id` exists in `Product` (`HTTP 404` if missing). Does **not** require live Firefly connectivity for local save (supporting offline fault tolerance).
   - Computes authoritative `line_total = round(item.quantity * item.paid_price, 2)` and validates `abs((sum(line_total) - basket_discount) - total_amount) <= 0.01` (`HTTP 422` if unbalanced).
   - Starts a single database transaction:
     - Creates `Receipt` record with `basket_discount`, `source_account_id`, `payment_mode`, and voucher fields.
     - For each item: coalesces `effective_regular = item.regular_price if item.regular_price is not None else item.paid_price`, computes `norm_paid = normalize_unit_price(item.paid_price, 1.0, item.unit, item.package_size)` and `norm_reg = normalize_unit_price(effective_regular, 1.0, item.unit, item.package_size)`.
     - Creates `ReceiptItem` row and corresponding `PriceRecord` row (`recorded_date=receipt.purchase_date`, `quantity=item.quantity`, `unit=item.unit`, `package_size=item.package_size`, `regular_price=effective_regular`, `paid_price=item.paid_price`, `is_discount=item.is_discount or (item.paid_price < effective_regular)`, `normalized_unit_price=norm_paid`, `normalized_regular_price=norm_reg`, `notes=receipt.notes`).
   - Returns `ReceiptRead` with nested `store`, `items` (with `product`), and `attachments`.

2. `GET /api/v1/receipts/` & `GET /api/v1/receipts/{receipt_id}`:
   - `GET /api/v1/receipts/` accepts optional `limit: int = 50, offset: int = 0` and returns `List[ReceiptRead]` ordered by `purchase_date.desc(), id.desc()`.
   - `GET /api/v1/receipts/{receipt_id}` returns `ReceiptRead` with full nested `store`, `items` (`product`), and `attachments` (`HTTP 404` if missing).

3. `POST /api/v1/receipts/{receipt_id}/attachments` & `GET /api/v1/receipts/{receipt_id}/attachments/{attachment_id}`:
   - Upload endpoint accepts `multipart/form-data` (`file: UploadFile`).
   - Verifies `receipt` exists (`HTTP 404`), enforces size $\le 15\text{MB}$ (`HTTP 413`).
   - Inspects raw bytes via `filetype` against explicit allowlist: `image/heic`, `image/heif`, `image/jpeg`, `image/png`, `image/webp`, and `application/pdf` (`HTTP 415` otherwise).
   - For `image/heic` / `image/heif` uploads: registers `pillow_heif.register_heif_opener()`, applies `ImageOps.exif_transpose()`, converts to `"RGB"`, encodes JPEG (`quality=90`), computes `sha256_hash` and `file_size_bytes` from converted JPEG bytes, and sets `file_type = "image/jpeg"` (`stored_path = "{sha256[:2]}/{sha256}.jpg"`).
   - Resolves target path strictly under `Path(settings.STORAGE_DIR) / stored_path`, creates parent directories, writes with `0644` permissions, and creates `ReceiptAttachment`.
   - `GET` endpoint verifies `attachment.receipt_id == receipt_id` (`HTTP 404` otherwise) and streams inline using `FileResponse(..., media_type=attachment.file_type)`.

4. `GET /api/v1/prices/history/{product_id}`:
   - Eager-loads all `PriceRecord` rows for the product ordered chronologically **ascending** (`order_by(PriceRecord.recorded_date.asc(), PriceRecord.id.asc())`) with nested `store` and `store.company` (`PriceRecordRead`).
   - Normalizes historical regular prices via `r.normalized_regular_price` when stored, falling back to `round(r.regular_price * (r.normalized_unit_price / r.paid_price), 3)` if `r.paid_price > 0 and r.normalized_unit_price is not None`, or `normalize_unit_price(r.regular_price, 1.0, r.unit, r.package_size or product.package_size)`.
   - Uses `latest = records[-1]` and `statistics.median()` in `compute_deal_analysis()`, computing both package-level fields (`current_price`, `regular_price`, `all_time_low`, `baseline_regular_price`, `discount_pct`, `deal_rating`) and normalized fields (`normalized_current_price`, `normalized_all_time_low`, `normalized_baseline_regular_price`).
   - Always returns uniform JSON `{ "product_id", "product_name", "brand", "default_unit", "analysis", "records": List[PriceRecordRead] }` (with `analysis: None` when empty).

5. `POST /api/v1/receipts/{receipt_id}/push-to-firefly`:
   - Accepts `req: ReceiptPushRequest = Body(default_factory=ReceiptPushRequest)` (`force: bool = False`).
   - **Idempotency & Partial Recovery Check**:
     - Let `partial_voucher_only = (receipt.firefly_voucher_transaction_id is not None and receipt.firefly_transaction_id is None and receipt.payment_mode == "split_vouchers" and card_remainder > 0)`.
     - If not `req.force` and (`receipt.firefly_transaction_id is not None` or `receipt.firefly_voucher_transaction_id is not None`): raises `HTTP 409 Conflict`.
     - If `req.force` and not `partial_voucher_only`: attempts best-effort `delete_transaction()` on previously synced transaction IDs and clears them before re-pushing. If `req.force` and `partial_voucher_only`: resumes by skipping Transaction 1 and executing Transaction 2 only.
   - **Strict Pre-Condition Guard**:
     - Checks locally that `receipt.store` and `receipt.store.firefly_account_id is not None` (`HTTP 400`).
     - Checks locally that `receipt.source_account_id is not None` (`HTTP 400`), and if `payment_mode == 'split_vouchers'`, `receipt.voucher_account_id is not None` and `receipt.voucher_count > 0` (`HTTP 400`).
     - Queries `await firefly_client.get_all_asset_accounts()` (catching `httpx.HTTPError` -> `HTTP 502`) to verify `source_account_id` (and `voucher_account_id` if applicable) exists in Firefly III (`HTTP 400` if invalid/missing).
   - **Direct Cent Allocation & Zero-Value Guard**:
     - Filters `billable_items = [item for item in receipt.items if item.line_total > 0]`. Zero-value items (`line_total == 0.0`) remain saved locally in `ReceiptItem`/`PriceRecord` and are omitted from Firefly splits (`amount > 0` invariant).
     - Converts `target_cents = round(receipt.total_amount * 100)` and verifies `target_cents >= len(billable_items)` (`HTTP 422` otherwise, preventing any billable split from collapsing to €0.00).
     - Guarantees every billable item a 1-cent floor and allocates `target_cents - len(billable_items)` proportionally to `round(item.line_total * 100)` via **integer-cent apportionment (Largest Remainder Method)**, yielding net split amounts $P_i \ge 0.01$ such that $\sum_{i \in \text{billable}} P_i \equiv \text{receipt.total\_amount}$ exact to the cent.
   - **Firefly v1 Multi-Split Payload Format**:
     - Builds `store_label = receipt.store.company.name if (receipt.store and receipt.store.company) else receipt.store.name`.
     - Payload: `{"error_if_duplicate_hash": False, "apply_rules": True, "group_title": f"{store_label} - {receipt.purchase_date}", "transactions": [...]}` where each split item has `{"type": "withdrawal", "date": f"{receipt.purchase_date}T12:00:00+00:00", "amount": f"{split_amount:.2f}", "description": f"{item.product.name} (x{item.quantity})", "source_id": str(account_id), "destination_id": str(receipt.store.firefly_account_id), "notes": receipt.notes or ""}` (appending `" [Voucher]"` / `" [Card Remainder]"` on split boundary items).
     - Extracts created Firefly transaction ID via `int(resp["data"]["id"])` and wraps `create_transaction` `httpx.HTTPError` in `HTTP 502`.
   - **Dispatch Mode & Rollback Compensation**:
     - If `payment_mode == 'single'`: sends 1 withdrawal transaction with prorated positive splits $P_i$ from `source_account_id` to `store.firefly_account_id`, stores `receipt.firefly_transaction_id`, commits, and returns updated `ReceiptRead`.
     - If `payment_mode == 'split_vouchers'`:
       - Calculates `voucher_total = round(min(receipt.total_amount, receipt.voucher_count * receipt.voucher_unit_value), 2)` and `card_remainder = round(receipt.total_amount - voucher_total, 2)`.
       - If `card_remainder <= 0.0`: sends 1 Transaction (Voucher withdrawal for all splits $P_i$), stores `receipt.firefly_voucher_transaction_id`, skips Transaction 2, commits, and returns `ReceiptRead`.
       - Otherwise (`card_remainder > 0.0`): applies **Sequential Boundary Partitioning on Net Prorated Splits ($P_i$)**:
         1. Accumulates $P_i$ into Transaction 1 (Vouchers) until cumulative sum $\ge \text{voucher\_total}$.
         2. For boundary item $k$ (where cumulative sum exceeds `voucher_total`):
            - **Split A (Last item on Transaction 1)**: `round(voucher_total - sum(P_1..P_{k-1}), 2)`.
            - **Split B (First item on Transaction 2)**: `round(P_k - Split A, 2)`.
         3. If $\sum_{i=1}^k P_i == \text{voucher\_total}$ exact to cents, item $k$ is allocated wholly to Transaction 1, and Transaction 2 starts at item $k+1$ without creating an invalid €0.00 Split B.
         4. All remaining items $k+1 \dots n$ go to Transaction 2 at their prorated amounts $P_i$.
       - **Execution & Intermediate Persistence**:
         - Unless resuming `partial_voucher_only` under `force=True`, executes Transaction 1 (Voucher withdrawal) and immediately commits `receipt.firefly_voucher_transaction_id = voucher_tx_id` to SQLite before initiating Transaction 2.
         - Inside `try/except`, executes Transaction 2 (Card Remainder withdrawal).
         - **Compensation Rollback**: If Transaction 2 fails and Transaction 1 was newly created in this call, attempts `await firefly_client.delete_transaction(voucher_tx_id)`. If rollback succeeds, resets `receipt.firefly_voucher_transaction_id = None` and commits; if rollback fails (or if resuming), retains `firefly_voucher_transaction_id` in SQLite for recovery via `force=True`, and raises `HTTP 502 Bad Gateway`.
         - On success, stores `receipt.firefly_transaction_id = card_tx_id`, commits, and returns updated `ReceiptRead`.

---

### 4. Mathematical Invariants & Guardrails

1. **Line Total Invariant**:
   $$\text{line\_total} = \text{round}(\text{quantity} \times \text{paid\_price}, 2)$$
2. **Receipt Balance Invariant**:
   $$\text{computed\_total} = \text{round}\left(\sum_{i=1}^{n} \text{line\_total}_i - \text{basket\_discount}, 2\right)$$
3. **Firefly Split Prorating Invariant**:
   $$\sum_{i \in \text{billable}} \text{split\_amount}_i = \text{receipt.total\_amount}$$
   $$\forall i \in \text{billable}, \quad \text{split\_amount}_i \ge 0.01$$
   *(Zero-value items with `line_total == 0.0` are recorded locally in `ReceiptItem` and `PriceRecord`, and omitted from Firefly split payloads).*
4. **Unit Normalization Formulas**:
   - Mass (g $\rightarrow$ €/kg): $\text{normalized\_price} = \frac{\text{paid\_price}}{\text{package\_size} / 1000}$
   - Volume (ml $\rightarrow$ €/L): $\text{normalized\_price} = \frac{\text{paid\_price}}{\text{package\_size} / 1000}$
   - Count (pcs $\rightarrow$ €/pc): $\text{normalized\_price} = \frac{\text{paid\_price}}{\text{package\_size}}$
5. **Strict Account Existence Invariant**:
   A receipt push is prohibited unless both destination expense account and source asset account(s) have verified, non-null Firefly IDs.

--------------------------------------------------------------------------------

## Alternatives Considered

### Alternative 1: Modal Form Per Item (Single-Item Popups)
* **Pros**: Simple to implement; visually consistent across desktop and mobile screens.
* **Cons**: Incurs excessive clicks and modal open/close cycles for a routine 30-item grocery shopping trip, leading to data entry fatigue.
* **Reason for Rejection**: `Rejected by author: Modal-per-item flow introduces excessive clicks and visual context switching for long receipts, drastically increasing logging time and friction.`

### Alternative 2: Multi-Tab Analytics Dashboard
* **Pros**: Separates analytics into discrete specialized views (cards, widgets, tabs).
* **Cons**: Unnecessary cognitive overhead and screen clutter relative to viewing a per-product price history line chart showing per-store price comparisons and median baselines.
* **Reason for Rejection**: `Rejected by author: Complex multi-tab analytical widgets were rejected in favor of a direct per-product price history chart supporting per-store comparisons and median baselines.`

### Alternative 3: Calculating Price Baselines via Arithmetic Mean
* **Pros**: Trivially computed via SQL `AVG()`.
* **Cons**: Clearance sales (e.g., 50% off near expiry) and temporary supply chain spikes heavily skew arithmetic averages, corrupting baseline reference prices.
* **Reason for Rejection**: `Rejected by author: Arithmetic mean is overly sensitive to promotional markdowns and price spikes. The median regular shelf price provides an inflation-resistant baseline.`

### Alternative 4: Negative Split Lines for Basket Discounts in Firefly III
* **Pros**: Directly maps a paper receipt discount line as a `-€5.00` split line.
* **Cons**: Strictly rejected by Firefly III's REST API with a `422 Unprocessable Entity` validation error.
* **Reason for Rejection**: `Rejected by author: Firefly III REST API strictly forbids negative split amounts on withdrawal transactions. Prorating discounts across positive splits satisfies ledger validation while matching net payment charges.`

### Alternative 5: Modifying Firefly III's Internal Database Directly
* **Pros**: Avoids maintaining a separate companion database; single SQL query surface.
* **Cons**: High operational risk: Firefly migrations can fail or alter tables, and direct writes bypass Firefly's double-entry accounting balances and audit trails.
* **Reason for Rejection**: `Rejected by author: Modifying Firefly III's internal database introduces migration breakages during container updates and bypasses ledger validation rules.`

### Alternative 6: Pure Tabular-Only Data Entry (Without Sequential Card Stream)
* **Pros**: Single frontend view to maintain.
* **Cons**: Poor mobile ergonomics due to horizontal scrollbars, tiny touch targets, and focus-trapping comboboxes inside HTML table cells.
* **Reason for Rejection**: `Rejected by author: Pure tabular grids fail on mobile devices and narrow screens. Dual synchronized views (Tabular Data Grid and Responsive Sequential Card Stream) over a shared draft state provide usability across both desktop and mobile.`

--------------------------------------------------------------------------------

## Non-Functional Requirements

### 1. Performance & Latency
* **Client-Side Responsiveness**: Tabular cell navigation (`Tab`/`Enter`) and live sum calculations run at `<16ms` (60fps) for receipt drafts of up to 100 items.
* **Autocomplete Latency**: Local product combobox filtering debounces at 150ms and returns results in `<50ms` from SQLite index.
* **Database Transactions**: Atomic persistence of `Receipt`, `ReceiptItem`s, and `PriceRecord`s completes in `<100ms` on SQLite.

### 2. Data Integrity & Fault Tolerance
* **Offline Draft Protection**: Draft receipt state in the browser is backed by `localStorage` (`firefly_receipt_draft`, 300ms debounce) for metadata and line items, and browser `IndexedDB` (`draft_receipt_file`) for binary files. Reloads and tab switches preserve persisted draft state once debounced writes settle, leaving zero orphan files on the server disk if a draft is discarded.
* **Ledger Atomicity**: If Firefly III is unreachable during `push-to-firefly`, the local receipt remains persisted in SQLite with `firefly_transaction_id = null`, allowing a retry without duplicating `Receipt` or `PriceRecord` rows.

### 3. Deployment Footprint
* **Lightweight Operation on M1 Mac (OrbStack)**: The companion backend (FastAPI) and local SQLite database idle at `<1%` CPU and `<80MB` RAM alongside the existing Firefly III container stack.
* **Database Initialization & Lifecycle**: Companion database startup inspects the existing SQLite schema in `lifespan()` and applies non-destructive Alembic batch migrations (`render_as_batch=True`) alongside `create_db_and_tables()` for new installations.

--------------------------------------------------------------------------------

## Security & Privacy Considerations

### 1. Authentication & Token Containment
* **Firefly Personal Access Token (PAT)**: Handled exclusively on the backend server. Configured via the server `.env` file (`FIREFLY_TOKEN`) and never exposed to the browser client or logged in application traces.
* **Allowed CORS Origins**: FastAPI CORS middleware strictly permits only local companion origins (`http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:3000`, `http://localhost:8000`) aligned across [`backend/app/core/config.py`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/backend/app/core/config.py), [`.env.example`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/.env.example), and [`docker-compose.yml`](file:///Users/fabriziocacicia/Projects/Personal/my-firefly/docker-compose.yml).

### 2. File Upload Hardening
* **Size Enforcement**: 15MB hard maximum payload limit in FastAPI (`receipts.py`), paired with `client_max_body_size 16m;` in Nginx (the extra 1 MiB headroom accommodates `multipart/form-data` boundary overhead).
* **MIME Validation & Extension Sanitization**: Uploaded receipt files are inspected via magic bytes (`filetype`) against an explicit allowlist: `image/heic`, `image/heif`, `image/jpeg`, `image/png`, `image/webp`, and `application/pdf`. Client-supplied file extensions are discarded; the saved extension is derived strictly from verified MIME magic bytes (or `.jpg` after HEIF conversion).
* **Storage Isolation**: Files are stored under hashed relative paths `"{sha256[:2]}/{sha256}.{ext}"` rooted at `settings.STORAGE_DIR` inside the Docker volume with `0644` non-executable permissions.

### 3. Input Sanitization
* All user-entered text fields (`notes`, `product_name`, `brand_name`) are treated as plain text strings. React JSX escaping prevents cross-site scripting (XSS), and SQLModel/SQLAlchemy parameterized queries prevent SQL injection.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

File additions and modifications span infrastructure configuration, the Python backend, and the TypeScript frontend:

### Target Files to Create/Modify

#### 1. `backend/requirements.txt` & `backend/Dockerfile` (Modify)
* **Scope**: Python Package Dependencies & Container Image Verification.
* **Rationale**: Support iPhone HEIF image decoding, JPEG conversion, MIME magic-byte inspection, and Alembic schema migrations.
* **Changes**:
  - Add `Pillow>=10.3.0`, `pillow-heif>=0.16.0`, `filetype>=1.2.0`, and `alembic>=1.13.1` to `backend/requirements.txt`.
  - Add a build-time verification step in `backend/Dockerfile` running `python -c "import pillow_heif; pillow_heif.register_heif_opener()"` (installing `libheif1` via `apt-get` only if manylinux/arm64 wheels fail to link `libheif` on `python:3.11-slim`).

#### 2. `backend/alembic.ini`, `backend/migrations/`, & `backend/app/main.py` (Create/Modify)
* **Scope**: Non-Destructive SQLite Schema Evolution & Lifespan Bootstrap.
* **Rationale**: Upgrade existing SQLite databases (`data/companion.db`) with new columns and nullable constraints without dropping tables, while initializing fresh databases on startup.
* **Changes**:
  - Configure Alembic `script_location = migrations` targeting `settings.DATABASE_URL`, importing `app.models`, and enabling `render_as_batch=True` in `migrations/env.py`.
  - Generate Alembic revisions adding new columns with explicit SQL `server_default` clauses (`basket_discount`, `payment_mode`, `voucher_count`, `voucher_unit_value`, `package_size`, `sha256_hash`, `normalized_regular_price`) and altering `receiptitem.regular_price` to nullable via `op.batch_alter_table("receiptitem")`.
  - Update `lifespan()` in `backend/app/main.py` to inspect SQLite via `sqlalchemy.inspect(engine)`:
    - If `receipt` table does not exist: run `create_db_and_tables()` and stamp Alembic `"head"`.
    - If `receipt` exists without `alembic_version`: stamp pre-workbench baseline revision and run `command.upgrade(alembic_cfg, "head")`.
    - If `alembic_version` exists: run `command.upgrade(alembic_cfg, "head")`.

#### 3. `backend/app/models/receipt.py`, `backend/app/models/price.py`, & `backend/app/models/__init__.py` (Modify)
* **Scope**: SQLModel Schemas, Field Constraints, & Package Exports.
* **Rationale**: Align persistent models, validation bounds, input schemas, and nested read projections with Section 3.A (Database Schema Extensions).
* **Changes**:
  - Add `package_size: Optional[float] = Field(default=None)` and `normalized_regular_price: Optional[float] = Field(default=None)` to `PriceRecordBase` in `backend/app/models/price.py`.
  - Update `ReceiptBase` with `basket_discount`, `source_account_id`, `payment_mode`, `voucher_account_id`, `voucher_count`, `voucher_unit_value`, `firefly_transaction_id`, and `firefly_voucher_transaction_id`.
  - Update `ReceiptItemBase` to add `package_size: float = Field(default=1.0)` and change `regular_price: Optional[float] = Field(default=None)`.
  - Update `ReceiptAttachmentBase` / `ReceiptAttachment` to add `sha256_hash: str`.
  - Define bounded input schemas `ReceiptItemCreate(SQLModel)` and `ReceiptCreate(SQLModel)` as specified in Section 3.A.
  - Define `ReceiptItemRead` (`ReceiptItemBase` with `id: int` and `product: Optional[ProductRead] = None`), update `ReceiptRead` (`items: List[ReceiptItemRead]`, `attachments: List[ReceiptAttachment]`), and define `ReceiptPushRequest` (`force: bool = False`).
  - Export all new models and schemas in `backend/app/models/__init__.py`.

#### 4. `backend/app/services/pricing.py` (Modify)
* **Scope**: Price Normalization & Baseline Statistics.
* **Rationale**: Fix `package_size` division for `pcs` items and use Python's `statistics.median()` for both package-level and normalized baselines.
* **Changes**:
  - In `normalize_unit_price()`, rename local denominator `total_amount` to `total_units = quantity * (package_size if package_size > 0 else 1.0)` and update the `else` (`pcs`) branch to return `round(price / total_units, 3)` instead of dividing only by `quantity`.
  - Update `compute_deal_analysis()` to compute `baseline = statistics.median(history_regular_prices)` when `history_regular_prices` is non-empty.

#### 5. `backend/app/services/firefly.py` (Modify)
* **Scope**: Firefly III REST Client Methods.
* **Rationale**: Support full pagination when listing asset accounts and transaction deletion for split-payment compensation rollback.
* **Changes**:
  - Update `get_all_asset_accounts()` to paginate through all pages identically to `get_all_expense_accounts()`.
  - Add `async def delete_transaction(self, transaction_id: int) -> None:` invoking `DELETE {self.base_url}/api/v1/transactions/{transaction_id}` with `raise_for_status()`.

#### 6. `backend/app/api/v1/receipts.py` (Create)
* **Scope**: FastAPI Receipts REST Router (`/api/v1/receipts`).
* **Rationale**: Persist itemized receipts with price observations, enforce upload security and HEIC conversion on receipt files, serve stored receipts/attachments, and execute balanced split pushes to Firefly III.
* **Changes**:
  - `POST /api/v1/receipts/`: Validates `store_id` (`Store`) and each `item.product_id` (`Product`), verifies receipt balance within ±€0.01, persists `Receipt` and `ReceiptItem` rows, coalesces `regular_price`, computes `normalized_unit_price` and `normalized_regular_price` via `normalize_unit_price()`, creates `PriceRecord` rows, and returns `ReceiptRead`.
  - `GET /api/v1/receipts/` & `GET /api/v1/receipts/{receipt_id}`: Lists `List[ReceiptRead]` (`limit=50`, `offset=0`) ordered by `purchase_date.desc(), id.desc()`, and retrieves individual `ReceiptRead` records.
  - `POST /api/v1/receipts/{receipt_id}/attachments`: Validates ≤15MB (`413`), verifies magic bytes via `filetype` against the allowlist (`415` otherwise), converts HEIC/HEIF to EXIF-transposed RGB JPEG (`quality=90`) computing SHA-256 and size from converted bytes, writes `0644` file under `Path(settings.STORAGE_DIR) / "{sha256[:2]}/{sha256}.{ext}"`, and creates `ReceiptAttachment`.
  - `GET /api/v1/receipts/{receipt_id}/attachments/{attachment_id}`: Verifies attachment ownership (`attachment.receipt_id == receipt_id`) and streams inline via FastAPI `FileResponse(..., media_type=attachment.file_type)`.
  - `POST /api/v1/receipts/{receipt_id}/push-to-firefly`:
    - Accepts `req: ReceiptPushRequest = Body(default_factory=ReceiptPushRequest)`.
    - Enforces idempotency (`409`) and handles `force=True` recovery (`partial_voucher_only` resumes Transaction 2; full sync deletes prior transactions first).
    - Checks `store.firefly_account_id` locally (`400`) and verifies `source_account_id` / `voucher_account_id` against `firefly_client.get_all_asset_accounts()` (HTTP `502` on Firefly connectivity failure, `400` if invalid).
    - Excludes zero-value items (`line_total == 0.0`) from Firefly splits and apportions `round(receipt.total_amount * 100)` cents directly across billable items with a 1-cent floor using integer-cent apportionment (Largest Remainder Method).
    - Executes `single` withdrawal, single-voucher `split_vouchers` withdrawal (`card_remainder <= 0.0`), or Sequential Boundary Partitioning (`card_remainder > 0.0`) with immediate persistence of `firefly_voucher_transaction_id` before Transaction 2 and `delete_transaction()` compensation rollback on failure.

#### 7. `backend/app/api/v1/prices.py` (Modify)
* **Scope**: FastAPI Price Intelligence Router (`/api/v1/prices/history/{product_id}`).
* **Rationale**: Return chronological ascending price observations with nested store and company metadata (`PriceRecordRead`), uniform JSON structure, and normalized baseline statistics for charting.
* **Changes**:
  - Order `PriceRecord` ascending (`order_by(PriceRecord.recorded_date.asc(), PriceRecord.id.asc())`) and set `latest = records[-1]`.
  - Validate and serialize each record using `PriceRecordRead` (including eager-loaded `store` and `store.company` relationships).
  - Compute normalized baseline statistics (`normalized_current_price`, `normalized_all_time_low`, `normalized_baseline_regular_price`) in addition to package-level fields inside `analysis`.
  - Return uniform keys `{ "product_id", "product_name", "brand", "default_unit", "analysis", "records" }` for both empty and populated responses.

#### 8. `backend/app/api/router.py` (Modify)
* **Scope**: API Router Aggregation.
* **Rationale**: Expose `receipts.router` under `/api/v1`.
* **Changes**:
  - Import `receipts` from `app.api.v1` and call `api_router.include_router(receipts.router)`.

#### 9. `backend/app/core/config.py`, `.env.example`, `docker-compose.yml`, `frontend/package.json`, & `frontend/nginx.conf` (Modify)
* **Scope**: Allowed CORS Origins, Frontend Dependencies, Volume Mounts, & Reverse Proxy Limits.
* **Rationale**: Synchronize CORS origins across local and Docker configs, install `idb-keyval` for client binary draft persistence, mount Alembic files in dev containers, and allow 15MB receipt uploads through Nginx.
* **Changes**:
  - Align `CORS_ORIGINS` default to `http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://localhost:8000` in `backend/app/core/config.py`, `.env.example`, and `docker-compose.yml`.
  - Mount `./backend/alembic.ini:/app/alembic.ini:ro` and `./backend/migrations:/app/migrations:ro` in `docker-compose.yml`.
  - Install `"idb-keyval": "^6.2.1"` in `frontend/package.json`.
  - Add `client_max_body_size 16m;` inside `server {}` in `frontend/nginx.conf`.

#### 10. `frontend/src/types/index.ts` (Modify)
* **Scope**: TypeScript Types & Interfaces.
* **Rationale**: Define strict TypeScript contracts matching Section 3.A schemas and Section 3.B API payloads.
* **Changes**:
  - Add `AppTab = 'stores' | 'catalog' | 'workflows' | 'workbench'`.
  - Extend `DealAnalysis` with `normalized_current_price?: number; normalized_all_time_low?: number; normalized_baseline_regular_price?: number`.
  - Add `DraftReceiptItem`: `{ temp_id: string; product_id: number; product_name: string; brand_name?: string; quantity: number; unit: 'g' | 'kg' | 'ml' | 'l' | 'pcs'; package_size: number; paid_price: number; regular_price?: number; is_discount: boolean; line_total: number }`.
  - Add `ReceiptItemPayload`: `{ product_id: number; quantity: number; unit: 'g' | 'kg' | 'ml' | 'l' | 'pcs'; package_size: number; paid_price: number; regular_price?: number; is_discount: boolean }`.
  - Add `ReceiptCreatePayload`: `{ store_id: number; purchase_date: string; total_amount: number; basket_discount: number; source_account_id?: number | null; payment_mode: 'single' | 'split_vouchers'; voucher_account_id?: number | null; voucher_count: number; voucher_unit_value: number; notes?: string; items: ReceiptItemPayload[] }`.
  - Add `ReceiptAttachment`: `{ id: number; receipt_id: number; filename: string; stored_path: string; file_type: string; file_size_bytes: number; sha256_hash: string; uploaded_at: string }`.
  - Add `ReceiptItemRecord`: `{ id: number; receipt_id: number; product_id: number; quantity: number; unit: string; package_size: number; paid_price: number; regular_price?: number | null; is_discount: boolean; line_total: number; product?: Product }`.
  - Add `ReceiptRecord`: `{ id: number; store_id: number; purchase_date: string; total_amount: number; basket_discount: number; source_account_id?: number | null; payment_mode: 'single' | 'split_vouchers'; voucher_account_id?: number | null; voucher_count: number; voucher_unit_value: number; firefly_transaction_id?: number | null; firefly_voucher_transaction_id?: number | null; notes?: string | null; created_at: string; store?: Store; items: ReceiptItemRecord[]; attachments: ReceiptAttachment[] }`.
  - Add `ProductPriceHistoryResponse`: `{ product_id: number; product_name: string; brand?: string | null; default_unit: string; analysis: DealAnalysis | null; records: PriceRecord[] }`.

#### 11. `frontend/src/api/client.ts` (Modify)
* **Scope**: API Client Methods & `FormData` Header Handling.
* **Rationale**: Prevent hardcoded `Content-Type: application/json` from breaking multipart file uploads and expose typed receipt endpoints.
* **Changes**:
  - Update `request<T>()` so `'Content-Type': 'application/json'` is only added when `!(options?.body instanceof FormData)`.
  - Update `api.prices.getHistory(productId)` return type to `ProductPriceHistoryResponse`.
  - Add `api.receipts`: `create(payload: ReceiptCreatePayload)`, `uploadAttachment(receiptId: number, file: File)` (sending `FormData`), `getAttachmentUrl(receiptId: number, attachmentId: number)`, `list(limit?: number, offset?: number)`, `getById(id: number)`, and `pushToFirefly(id: number, force?: boolean)` (sending `JSON.stringify({ force: Boolean(force) })`).

#### 12. `frontend/src/context/ReceiptWorkbenchContext.tsx` (Create)
* **Scope**: Unified Draft State Context (`ReceiptWorkbenchProvider`) with `localStorage` & `IndexedDB` Autosave.
* **Rationale**: Preserve draft state across Grid and Card Stream toggles, tab switches, and reloads (subject to a 300ms `localStorage` debounce).
* **Changes**:
  - Persist structured draft metadata and items under `localStorage` key `'firefly_receipt_draft'` (300ms debounce) and binary attachment under `IndexedDB` key `'draft_receipt_file'` via `idb-keyval` (guarded by `isHydrated` so initial load never gets overwritten by `null`).
  - State: `storeId`, `purchaseDate`, `targetTotal`, `basketDiscount`, `notes`, `sourceAccountId`, `paymentMode`, `voucherAccountId`, `voucherCount`, `voucherUnitValue`, `draftItems`, `savedReceiptId` (prevents re-calling `create()` on Firefly/upload retries), `activeMode` (`'grid' | 'stream'`, defaulting to `'stream'` below `768px` width and `'grid'` otherwise, user-toggleable at any width), `attachedFile`, and `stores` (loaded for `selectedStore` lookup).
  - Actions: `addItem(item: Omit<DraftReceiptItem, 'temp_id' | 'line_total'>)`, `updateItem(tempId, updates)`, `removeItem(tempId)`, `setAttachedFile(file | null)`, `setSavedReceiptId(id | null)`, `clearDraft()` (resets state, deletes `'firefly_receipt_draft'`, and runs `del('draft_receipt_file')`), `setActiveMode(mode)`.
  - Derived values (integer-cent rounded via `Math.round(v * 100) / 100`):
    - `computedItemsSum` = `sum(item.line_total)`
    - `calculatedSum` = `computedItemsSum - basketDiscount`
    - `discrepancyDelta` = `calculatedSum - targetTotal`
    - `selectedStore` = `stores.find(s => s.id === storeId) || null`
    - `isBalanced` = `targetTotal > 0 && draftItems.length > 0 && Math.abs(discrepancyDelta) <= 0.01`
    - `canSaveLocally` = `Boolean(storeId) && isBalanced && draftItems.every(i => i.product_id > 0 && i.quantity > 0 && i.package_size > 0 && i.paid_price >= 0)`
    - `canPushToFirefly` = `canSaveLocally && Boolean(selectedStore?.firefly_account_id) && Boolean(sourceAccountId) && (paymentMode !== 'split_vouchers' || (Boolean(voucherAccountId) && voucherCount > 0))`

#### 13. `frontend/src/components/workbench/WorkbenchHeader.tsx` (Create)
* **Scope**: Workbench Header, Receipt Controls, & Payment Selector.
* **Rationale**: Configure receipt store, date, target total, basket discount, notes, source asset accounts, split vouchers, receipt file attachment, reconciliation feedback, and entry mode switcher.
* **Changes**:
  - Render store `<select>` populated from `api.companies.listStores()` with options formatted as `"{store.company?.name} — {store.name}" + (!store.firefly_account_id ? " (Unmapped)" : "")`, plus an amber `[Unmapped]` pill beside the `<select>` when `!selectedStore?.firefly_account_id`.
  - Render inputs for `purchaseDate`, `targetTotal`, `basketDiscount`, and `notes`.
  - Fetch `api.firefly.getAssetAccounts()` with non-blocking error catching (if Firefly is offline, display a subtle warning banner while keeping `"Save Receipt Locally"` operational).
  - Render `"Split with Vouchers"` checkbox revealing `voucherAccountId`, `voucherCount` (`0`–`8`), and `voucherUnitValue` (`5.16` default).
  - Render file dropzone accepting `image/heic,image/heif,image/jpeg,image/png,image/webp,application/pdf,.heic,.heif` (validating ≤15MB in browser) and showing preview/remove chip.
  - Render live meter (`Target Total`, `Calculated Sum`, `Discrepancy (Δ)`) and payment split preview.
  - Render segmented toggle `[Tabular Data Grid]` ↔ `[Card Stream]`.

#### 14. `frontend/src/components/workbench/TabularGridView.tsx` (Create)
* **Scope**: Spreadsheet Data Grid View.
* **Rationale**: Display full receipt lines in a table with keyboard traversal across cells.
* **Changes**:
  - Render `overflow-x-auto` table with columns: `#`, `Product`, `Qty`, `Unit`, `Pkg Size`, `Paid Price`, `Regular Price`, `Discount`, `Line Total`, `Actions`, keeping a local uncommitted active row appended at the bottom until a valid product is selected.
  - Keyboard shortcuts: `Tab` advances (`Product` → `Qty` → `Unit` → `Pkg Size` → `Paid Price` → `Regular Price`), `Enter` on `Paid Price` (when combobox is closed) or `Regular Price` commits the active row to context and clears and focuses the Product combobox, `Escape` closes combobox, `Delete`/`Backspace` on an empty/focused row deletes it.
  - Product combobox (150ms debounce) auto-fills `unit`, `package_size`, and resets `quantity = 1` on selection; `"+ New Product"` launches `InlineProductModal`.

#### 15. `frontend/src/components/workbench/CardStreamView.tsx` (Create)
* **Scope**: Responsive Sequential Card Stream View (Mobile & Desktop).
* **Rationale**: Support single-item sequential entry paired with a scrollable Register Tape that adapts across mobile and desktop viewports.
* **Changes**:
  - Responsive layout (`grid-cols-1 md:grid-cols-12 max-w-6xl mx-auto gap-6`): stacked vertical layout below `768px`, and 2-column split at `>= 768px` (`md:col-span-5` pinned Active Card left; `md:col-span-7` Register Tape right).
  - Active card inputs: Product combobox (with `"+ New Product"`), `Qty`, `Unit`, `Pkg Size`, `Paid Price`, optional `Regular Price`, `is_discount` toggle, explicit `"Add Line"` button (`"Update Line"` / `"Cancel"` when `editingTempId` is set), and `Enter` submission refocusing Product combobox.
  - Scrollable Register Tape prepending new items at the top (displaying original `#`), with click/tap-to-edit (`editingTempId`) and delete actions.

#### 16. `frontend/src/components/workbench/InlineProductModal.tsx` (Create)
* **Scope**: Inline Product Creation Modal.
* **Rationale**: Create missing catalog products mid-receipt without resetting the active workbench draft.
* **Changes**:
  - Compact modal with Name, Brand `<select>` populated via `api.products.listBrands()` + inline brand quick-create via `api.products.createBrand()`, Default Unit (`g`, `kg`, `ml`, `l`, `pcs`), and Package Size (using UTF-8 `→` in helper labels).
  - On submit: calls `api.products.create({ ..., tag_ids: [] })`, updates parent combobox cache, and auto-selects the new product into the active row.

#### 17. `frontend/src/components/charts/ProductPriceChart.tsx` (Create)
* **Scope**: Zero-Dependency Inline SVG Price History Chart.
* **Rationale**: Plot normalized unit price observations across stores against the normalized median baseline without cross-store sawtooth distortion.
* **Changes**:
  - Props: `{ records: PriceRecord[]; analysis: DealAnalysis | null; defaultUnit: string }`.
  - Filter `records` with non-null `normalized_unit_price`; handle edge cases cleanly (`0` records empty state, `1` unique date centered X-axis without division by zero, flat prices padded Y-axis).
  - Render coordinate axes (Chronological Date on X-axis; `€/kg`, `€/L`, or `€/pc` on Y-axis).
  - Render color-coded scatter points per physical store with hover and tap tooltips showing date, store name, normalized price, raw `paid_price`, and sale indicator.
  - Draw connected trend lines strictly within individual store series when filtered or toggled via legend checkboxes (no single sawtooth line connecting disparate stores).
  - Render horizontal dashed line for `analysis.normalized_baseline_regular_price`.

#### 18. `frontend/src/pages/ReceiptWorkbenchPage.tsx` (Create)
* **Scope**: Full Receipt Workbench Page.
* **Rationale**: Compose `WorkbenchHeader`, active entry view (`TabularGridView` / `CardStreamView`), commit/push actions, and recent receipts history list with recovery and attachment links.
* **Changes**:
  - Bottom action bar with `"Save Receipt Locally"` (`canSaveLocally`) and `"Save & Push Splits to Firefly"` (`canPushToFirefly`, disabled with dynamic tooltip listing every unsatisfied guard: missing mapped store, missing source/voucher account, or unbalanced total).
  - Deduplication on save/push: persist `savedReceiptId` as soon as `api.receipts.create()` succeeds (skipping duplicate `create()` calls if attachment upload or Firefly push fails), upload attachment via `api.receipts.uploadAttachment(id, file)`, execute `api.receipts.pushToFirefly(id)` if requested, and call `clearDraft()` on save success so `Receipt`/`PriceRecord` rows are never duplicated.
  - Render collapsible "Recent Receipts" section below the workbench showing sync status badges, `"Push to Firefly"` / `"Resume Card Sync"` (`force=true` when `firefly_voucher_transaction_id != null && firefly_transaction_id == null`), and clickable links to `api.receipts.getAttachmentUrl(receiptId, attachmentId)`.

#### 19. `frontend/src/pages/CatalogPage.tsx` (Modify)
* **Scope**: Catalog Modal Integration & Copy Cleanup.
* **Rationale**: Render `ProductPriceChart` with sufficient horizontal space for SVG chart rendering above the existing price history card list.
* **Changes**:
  - Reset `setHistoryData(null)` immediately when opening `handleOpenHistoryModal()` for a product.
  - Widen history modal container from `max-w-lg` to `max-w-3xl`.
  - Render `<ProductPriceChart />` directly above the existing "Recorded Prices" card list (and replace literal LaTeX `$\rightarrow$` strings in unit `<option>` labels with UTF-8 `→`).

#### 20. `frontend/src/components/Navbar.tsx` & `frontend/src/App.tsx` (Modify)
* **Scope**: Navigation, Provider Placement, & Root Routing.
* **Rationale**: Mount `ReceiptWorkbenchProvider` at root scope so tab switching preserves drafts, add `Receipt Workbench` tab without mobile header overflow, and route `'workbench'` cleanly.
* **Changes**:
  - Update `activeTab` / `onTabChange` prop types in both files to `AppTab` (`'stores' | 'catalog' | 'workflows' | 'workbench'`).
  - Wrap `<Navbar />` + `<main>` inside `<ReceiptWorkbenchProvider>` in `App.tsx` and render `{activeTab === 'workbench' && <ReceiptWorkbenchPage />}`.
  - Add `Receipt Workbench` tab button with `Receipt` Lucide icon and responsive compact mobile labels (`"Stores"`, `"Catalog"`, `"Workflows"`, `"Workbench"` via `sm:hidden` / `hidden sm:inline` spans and `overflow-x-auto`) so all 4 tabs fit without wrapping or overflow on narrow mobile screens.

--------------------------------------------------------------------------------

## Amendment (2026-11-20): Live Firefly Store Lookup & Optional Company Linking

Following the approval and implementation of `docs/designs/live_firefly_stores_and_optional_company.md`, the receipt workbench and pricing subsystems were transitioned from the legacy local `Store` table to direct `firefly_account_id` references:
1. **Elimination of Local Store Synchronization:** The local `Store` table and mandatory `POST /api/v1/companies/quick-map` pre-mapping gates have been removed. `Receipt` and `PriceRecord` now persist `firefly_account_id` directly, making Firefly III the single source of truth for all expense accounts.
2. **Dedicated Live Store Autocomplete:** The static store `<select>` in `WorkbenchHeader.tsx` and `CatalogPage.tsx` was replaced with `<StoreCombobox>`, providing debounced live search (`GET /api/v1/firefly/expense-accounts/search?query=...`) with request aborting, keyboard navigation, and clear actions.
3. **Optional Parent Company Metadata:** Company grouping is now maintained via the lightweight `CompanyAccountLink` association table (`firefly_account_id -> company_id`). Linking accounts to parent companies is completely optional and non-blocking for receipt itemization and price tracking.

--------------------------------------------------------------------------------

## Amendment (2026-11-25): Computed Receipt Total (#3)

Following Issue #3, the receipt total is no longer manually entered or reconciled against a typed `Target Total`:
1. **Computed Total in Frontend (`ReceiptWorkbenchContext`, `WorkbenchHeader`, `ReceiptWorkbenchPage`):** Removed the editable `Target Total (€)` input, `targetTotal` draft state, `discrepancyDelta`, and `isBalanced` reconciliation meter. `WorkbenchHeader` displays the read-only computed `Receipt Total (€)` (`calculatedSum = computedItemsSum - basketDiscount`), and save/push guards require `draftItems.length > 0 && calculatedSum > 0`.
2. **Authoritative Server Computation (`ReceiptCreate`, `POST /api/v1/receipts/`):** Removed `total_amount` from `ReceiptCreate` (and `ReceiptCreatePayload`). `create_receipt` computes `computed_total = round(sum(line_totals) - receipt_in.basket_discount, 2)` directly from submitted items and basket discount, rejects `computed_total <= 0` (`HTTP 422`), and persists `Receipt.total_amount = computed_total`.
