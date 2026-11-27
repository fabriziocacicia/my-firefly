# Firefly III Companion Hub 🛒✨

A companion web application for **Firefly III** to track SKU-level product prices, multi-dimensional categories, supermarket chains, and eliminate repetitive personal finance workflows.

---

## 🚀 Key Capabilities

1. **Receipt Workbench & Computed Totals**:
   - Dual-mode (spreadsheet-style tabular grid or card stream) receipt entry with real-time computed receipt total from line items and basket discount.
   - Portal-rendered type-ahead item lookup (`ProductCombobox`) with inline canonical item creation (`ItemEditorModal`), requiring only item, quantity/weight, and unit or total price per row.
   - Built-in receipt image attachment preview and local draft autosave in browser storage.
   - 1-click push to Firefly III expanding `N` packaged units into `N` uniform Firefly splits with canonical description, linear Firefly category, and expanded tags (plus optional meal voucher splits).

2. **Accounts & Chains (Classification, Multi-Types, Sector Tagging & Asset Accounts)**:
   - Instant live lookup and autocomplete across all Firefly III expense accounts without upfront manual mapping.
   - Classify accounts by role (`Local Business`, `Chain Branch`, `E-Commerce`, `Service`, `Person`, `Unclassified`).
   - Multi-type business modeling (`business_types` array, e.g. `[Bar/Cafe, Tobacconist]`) with automatic retail chain branch inheritance.
   - Sector category tagging (`category`) with zero-maintenance dynamic garbage collection (disappears automatically when unused).
   - **Asset Accounts & Meal Vouchers**: View live Firefly III balances, classify asset accounts (`Bank Account`, `Cash`, `Digital Credit`, `Investment Account`, `Meal Voucher`, `Standard`), inspect total active balances with a collapsible categorized breakdown, detect voucher balance-multiple discrepancies, and create exact Firefly deposit recharges.

3. **Canonical Items, Hierarchical Firefly Tags & Historical Sync**:
   - Track canonical items (`packaged` multipacks like `6×330ml` or `loose_weight`) with brands, Firefly III categories, and Firefly-ID-backed tags.
   - Model hierarchical tag implications (`Mele → Frutta`) in the companion app, automatically expanding flat tags onto Firefly III splits and powering multi-tag intersection analytics (`Frutta + Bio`).
   - Reconcile historical Firefly transactions via incremental + full sync cache (`Firefly Backlog`), with segmented `To Associate` / `Associated` / `Ignored` views, local `Unlink`, category filter counts, and async SSE background rewrite jobs (`firefly_sync_job`).
   - Automatic unit price normalization (€/kg, €/L, €/pc) and **Deal Scoring** against historical baselines.

4. **Smart Workflows**:
   - **Buoni Pasto / Meal Voucher Splitter**: Auto-calculates voucher limits + card remainders and pushes **both balanced transactions** to Firefly III in 1-click.
   - **Recurring Family Plan Generator**: 1-click generation of monthly Spotify Family or iCloud 2TB splits with dynamic month labels.

---

## 📂 Project Structure

```
my-firefly/
├── backend/                  # Python 3.11 + FastAPI + SQLModel
│   ├── app/
│   │   ├── api/v1/           # REST endpoints (companies, products, prices, firefly, firefly_sync, analytics, workflows, receipts, accounts, asset_accounts, categories)
│   │   ├── core/             # Configuration & SQLite connection
│   │   ├── models/           # SQLModel domain models (Company, AccountMetadata, AssetAccountMetadata, Product, Price, Tag, TagImplication, FireflySyncedSplit, FireflySyncJob, Receipt)
│   │   ├── services/         # Firefly III client, async Firefly sync job worker, taxonomy DAG, voucher math & price normalization
│   │   └── main.py           # FastAPI entrypoint
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                 # TypeScript + React + Vite + Tailwind CSS
│   ├── src/
│   │   ├── api/client.ts     # Typed API client
│   │   ├── components/       # UI components (workbench, accounts, catalog, common, charts)
│   │   ├── context/          # React contexts (ReceiptWorkbenchContext)
│   │   ├── hooks/            # Custom hooks (useFireflySyncJobs SSE client, usePortalDropdown)
│   │   ├── pages/            # ReceiptWorkbenchPage, AccountsAndChainsPage, CatalogPage, WorkflowsPage
│   │   └── types/            # TypeScript interfaces
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
├── docs/
│   └── designs/              # Architectural design specifications & sitemap
├── data/                     # Persistent storage (SQLite & Receipts)
├── docker-compose.yml        # Docker compose for OrbStack / server
└── .env                      # Firefly URL & Token configuration
```

---

## 📖 Architecture & Design Specifications

All significant architecture decisions, domain models, and RFCs are maintained in [`docs/designs/`](docs/designs/) and [`docs/decisions/`](docs/decisions/):

- [Design Documents Sitemap](docs/designs/SITEMAP.md)
- [Receipt Workbench & Price Analytics](docs/designs/receipt_workbench_and_price_analytics.md)
- [Live Firefly Store Lookup & Optional Companies](docs/designs/live_firefly_stores_and_optional_company.md)
- [Expense Account Classification & Category Tagging](docs/designs/expense_account_classification_and_category_tagging.md)
- [Meal Voucher Asset Accounts & Recharge](docs/designs/meal_voucher_asset_accounts.md)
- [Asset Account Types & Categorized Balance Totals](docs/designs/asset_types_and_total_balances.md)
- [Canonical Items, Hierarchical Firefly Tags & Historical Sync](docs/designs/canonical_items_hierarchical_tags_and_firefly_sync.md)
- [Asynchronous Firefly Sync Jobs & Progress Tracking](docs/designs/firefly_sync_async_jobs.md)
- [Sync Job Banner Auto-Expiry, Bulk Dismiss & Sync History Drawer](docs/designs/firefly_sync_job_visibility_and_history.md)
- [ADR-001: Multi-Type Business Modeling and Dynamic Category Tagging](docs/decisions/ADR-001-multi-type-business-modeling-and-dynamic-categories.md)

---

## 🛠️ Quick Start

### Option 1: Running with Docker Compose (OrbStack on M1 Mac)

1. Create a `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```
2. Set your `FIREFLY_URL` and `FIREFLY_TOKEN` in `.env`.
3. Start the containers:
   ```bash
   docker compose up -d
   ```
4. Open your browser:
   - **Frontend UI**: [http://localhost:5173](http://localhost:5173)
   - **Interactive API Docs (Swagger)**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

### Option 2: Running Locally (Development Mode)

#### 1. Backend (Python):
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

#### 2. Frontend (Node/TypeScript):
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173).
