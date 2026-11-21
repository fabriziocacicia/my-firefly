# Firefly III Companion Hub 🛒✨

A companion web application for **Firefly III** to track SKU-level product prices, multi-dimensional categories, supermarket chains, and eliminate repetitive personal finance workflows.

---

## 🚀 Key Capabilities

1. **Receipt Workbench & Split Balancing**:
   - Dual-mode (spreadsheet-style tabular grid or card stream) receipt entry with real-time target sum balancing.
   - Integrated type-ahead product lookup with inline quick-creation.
   - Built-in receipt image attachment preview and local draft autosave in browser storage.
   - 1-click push to Firefly III split transactions with optional meal voucher splits.

2. **Live Firefly Stores & Optional Companies**:
   - Instant live lookup and autocomplete across all Firefly III expense accounts without upfront manual mapping.
   - Optionally group flat accounts (e.g. `Acqua e Sapone Via Milano Catania`, `Acqua e Sapone Palermo`) under parent companies (`Acqua e Sapone`, `Conad`, `Lidl`, `MD`) for cross-branch price comparisons.

3. **Products, Brands & Price Intelligence**:
   - Track products with brands, package sizes, and multi-dimensional tags (e.g. `[Food, Pasta, Organic]`, `[Fruit, Bio]`).
   - Log regular shelf prices vs. paid sale prices.
   - Automatic unit price normalization (€/kg, €/L, €/pc).
   - **Deal Scoring**: Evaluates current prices against your historic baseline and highlights all-time lows.

4. **Smart Workflows**:
   - **Buoni Pasto / Meal Voucher Splitter**: Auto-calculates voucher limits + card remainders and pushes **both balanced transactions** to Firefly III in 1-click.
   - **Recurring Family Plan Generator**: 1-click generation of monthly Spotify Family or iCloud 2TB splits with dynamic month labels.

---

## 📂 Project Structure

```
my-firefly/
├── backend/                  # Python 3.11 + FastAPI + SQLModel
│   ├── app/
│   │   ├── api/v1/           # REST endpoints (companies, products, prices, firefly, workflows, receipts)
│   │   ├── core/             # Configuration & SQLite connection
│   │   ├── models/           # SQLModel domain models (Company, Product, Price, Tag, Receipt)
│   │   ├── services/         # Firefly III client & price normalization
│   │   └── main.py           # FastAPI entrypoint
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                 # TypeScript + React + Vite + Tailwind CSS
│   ├── src/
│   │   ├── api/client.ts     # Typed API client
│   │   ├── components/       # UI components (Workbench, Common, Navigation)
│   │   ├── pages/            # ReceiptWorkbenchPage, StoresPage, CatalogPage, WorkflowsPage
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

All significant architecture decisions, domain models, and RFCs are maintained in [`docs/designs/`](docs/designs/):

- [Design Documents Sitemap](docs/designs/SITEMAP.md)
- [Receipt Workbench & Price Analytics](docs/designs/receipt_workbench_and_price_analytics.md)
- [Live Firefly Store Lookup & Optional Companies](docs/designs/live_firefly_stores_and_optional_company.md)

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
