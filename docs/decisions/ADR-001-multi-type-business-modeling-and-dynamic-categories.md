# ADR-001: Multi-Type Business Modeling and Dynamic Category Tagging

## Status
Accepted

## Date
2026-11-24

## Context
In `my-firefly`, Firefly III expense accounts represent a wide variety of spending destinations: retail chain branches, standalone local shops, e-commerce stores, subscription services, and individuals.

Initially, the data model relied on a single `category` string on `AccountMetadata` and an optional `default_category` string on `Company`. Real-world usage surfaced two challenges:
1. **Multi-Activity Businesses & Chain Inheritance:** Physical businesses often encompass multiple distinct business activities (e.g., a local establishment operating simultaneously as `Bar/Cafe` and `Tobacconist`, or a petrol station with `Gas Station`, `Carwash`, and `Bar/Cafe`). Additionally, retail chain branches inherit their parent company's core type (e.g. `Burger King` → `Fast Food`) while specific branches may feature local additions (e.g. `Drive-thru`).
2. **Orphan Category Clutter:** When categories were renamed or removed from accounts, old string values persisted in database columns and continued to be returned in typeahead autocompletion, requiring manual cleanup.

## Decision
1. **Multi-Type Business Modeling (`business_types`):**
   - Introduce `business_types` as a JSON array of strings on `Company` and `AccountMetadata`.
   - Retail chain branches automatically inherit `business_types` from the parent company, with branch-level extensions and automatic deduplication (`effective_business_types`).
   - Deprecate `Company.default_category` in favor of `business_types`, with automatic data migration and sanitization implemented via Alembic migration `0007_cleanup_legacy_default_category.py` and SQLite startup migration.
2. **Distinct Categorization Semantics:**
   - Reserve `category` for sector/merchandise tags on `ecommerce` and `service` accounts (and optional sector tags on `local_business`).
   - For `chain` accounts, `category` is explicitly set to `None`, eliminating visual and semantic duplication against `business_types`.
3. **Dynamic Category Garbage Collection (Zero Administrative Maintenance):**
   - `GET /api/v1/categories` dynamically computes distinct categories strictly from active, non-chain accounts.
   - When an account changes or removes its category, unreferenced tags immediately disappear from suggestions and API responses without requiring an administrative CRUD interface.
4. **Uniform Role Naming:**
   - Use `Person` (and `Persons` for plural collections/filters) uniformly across UI cards, tables, filter chips, and classification modals.

## Alternatives Considered

### Alternative 1: Static Category Dictionary Table (CRUD Model)
- **Pros:** Centralized category definitions and rename cascades.
- **Cons:** High administrative overhead; requires building and maintaining dedicated category management screens; runs counter to the project's zero-maintenance principle.
- **Rejected:** Freeform tagging with implicit garbage collection eliminates administrative overhead while preserving complete flexibility.

### Alternative 2: Comma-Separated Values in a Single String
- **Pros:** Avoids adding a new column to the schema.
- **Cons:** Fragile string manipulation, casing inconsistencies, whitespace bugs, and clumsy branch-level set inheritance.
- **Rejected:** Native JSON arrays (`sa.Column(JSONListType())`) are clean, type-safe, and natively queryable in modern SQLite.

## Consequences
- Physical venue activities (`business_types`) and digital merchandise sectors (`category`) have clear, non-overlapping semantics.
- Retail chains feature predictable, deduplicated inheritance between parent companies and individual branches.
- Autocomplete suggestion lists are guaranteed to contain only actively used categories.
- Full backward compatibility is preserved via role aliases (`independent` and `physical_store` mapped to `local_business`).
