# csv_local connector (Phase 1 / Gate 1b)

**实现**：`extensions/connector-csv-local/` → `user.connector_load_feed`  
读 `~/.claude-excel-web/packs/{packId}/connector/fixtures/*.csv`，按 `feeds/*.schema.json` 映射 canonical 列；由 Pack SKILL（`/跨境业财`）编排 `user.connector_load_feed` + `write_to_sheet` 写入 `Pack_*` sheet（或场景包菜单「导入 CSV」先写表）。

Fixtures（脱敏，含三类异常）：

- `fixtures/orders.csv` — 退款行、EUR 混币、orphan SKU
- `fixtures/ads.csv` — SKU 大小写/空格、mismatch SKU、归因日偏移
- `fixtures/inventory.csv`（可选，Phase 1 未用）
- `fixtures/settlement.csv` / `bank.csv` — H2 结算×银行桥表（金额±N 天或 settlement_id）

脏数据在 connector 内归一（trim+lower SKU、ISO 日期、`biz_date` join 键），recipe 只认 schema 列名。
