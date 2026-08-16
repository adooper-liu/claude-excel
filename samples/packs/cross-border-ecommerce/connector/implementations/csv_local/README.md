# csv_local connector (Phase 1 / Gate 1b)

Reads seller-export CSV from `fixtures/` (repo or user path), maps columns to `feeds/*.schema.json`, writes rows via core `write_to_sheet` / ingest path.

**Not implemented yet** — schema + fixtures are the contract; implementation follows Gate 1b brief.

Expected fixtures (脱敏真实导出):

- `fixtures/orders.csv`
- `fixtures/ads.csv`
- `fixtures/inventory.csv` (optional)

Dirty characteristics to preserve in fixtures: UTF-8 BOM, trailing spaces in SKU, mixed date formats — mapped away in connector, not in recipe.
