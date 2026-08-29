# dashboard

铺一张**活公式仪表盘**：KPI 卡片 + 维度 SUMIFS 表 + 可选月序列表 + 最佳值高亮（INDEX/MATCH）+ 图表。所有数字都是公式引用源表，源表一变全盘重算，**没有一行是算好贴死的**。

## 用法（模型侧）

`build_dashboard` 只传列名（来自 `inspect`），不写格、不进表体：

- `tableName`：先 `ensure_table`，传源表名；没有表就用 `sourceSheet` + `sourceRange`（含表头）。
- `valueColumns`（必填）：数值列，如 `金额`。每个生成一个「合计」KPI；维度表/月序列表按第一个 valueColumn 求和。
- `countColumn`：计数列（如 `订单号`），「笔数」KPI 用 COUNTA；缺省回落第一个维度列。
- `dimensions`：维度列（产品/区域/销售/类目），每个生成一张 SUMIFS 表（维度标签 + 合计 + 占比 + 合计行 + 最佳值）。
- `dateColumn`：日期列，生成月序列表（按源表实际数据的最小/最大月份，不硬编码 1-12）。
- `kpis`：默认 `[total, count, avg]`；total=每 valueColumn 求和，count=COUNTA(countColumn)，avg=IFERROR(合计/笔数,0)。
- `charts`：默认有 dimensions 给 `dimension-bar`（第一个维度），有 dateColumn 给 `month-line`；可选 `dimension-pie`。
- `includeBestOf`：默认 true，每张维度表生成 `=INDEX(标签列, MATCH(MAX(合计列), 合计列, 0))` 最佳值高亮。

## 输出布局（固定、可预期）

1. 标题「仪表盘」（合并加粗）。
2. KPI 卡片：每列「合计」+「笔数」+「均值」。
3. 月度营收（给 dateColumn 时）：`=SUMIFS(..., 日期, ">="&DATE(...), 日期, "<"&DATE(...))`，加合计行。
4. 每张维度表：`=SUMIFS(valueCol, dimCol, $A行)` + 占比 `=IFERROR(行合计/$总KPI,0)` + 合计行 + 最佳值 `=INDEX/MATCH`。
5. 图表（ColumnClustered / Line / Pie），坐标由算子算出。

## 纪律

- 先 `ensure_table`；空工作簿/缺列时向用户**选项式澄清**（不替拍板）。
- 写格只走本算子；禁止用 `write_to_sheet`/`write_to_range` 兜底写死数字。
- 模型最省 Token：不把表体读进对话，只传列名。
