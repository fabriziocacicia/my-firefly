# Design Documents Sitemap

| Design Document | Date | Author | Core Components | Description |
| :--- | :--- | :--- | :--- | :--- |
| [Receipt Workbench & Price Analytics](receipt_workbench_and_price_analytics.md) | 2026-11-09 | Fabrizio | `ReceiptWorkbench`, `TabularGridView`, `CardStreamView`, `ProductPriceChart`, `receipts.py` | V1 dual specular receipt entry workbench with live sum balancing and product price trend charts. |
| [Store Sync, Optional Company & Type-Ahead Pickers](store_sync_and_optional_company.md) | 2026-11-11 | Fabrizio | `Store`, `Company`, `StoresPage`, `StoreCombobox`, `companies.py`, `firefly.py` | RFC removing the mandatory store mapping gate, syncing Firefly expense accounts, making Company optional, and switching store selects to type-ahead search. |
| [Live Firefly Store Lookup, Optional Company Metadata & Type-Ahead Pickers](live_firefly_stores_and_optional_company.md) | 2026-11-12 | Fabrizio | `CompanyAccountLink`, `FireflyClient`, `StoreCombobox`, `StoresPage`, `receipts.py`, `prices.py` | Finalized design dropping the local `Store` table, resolving Firefly III expense accounts live, retaining optional `Company` links, and using type-ahead pickers without defaults. |
