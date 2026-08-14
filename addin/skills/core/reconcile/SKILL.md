# reconcile

两表对账。精确匹配，结果只写新表。

## 何时用

用户要把两份名单/订单/流水对上：谁两边都有、谁只有一边、谁键相同但金额等字段不一致。

## 步骤

1. `inspect_workbook` — 看有没有 Table、表头叫什么。空工作簿或没有带表头的表：先问要不要生成样例，不要编造数据、也不要报错结束。
2. 还不是 Table → `ensure_table`（含表头的区域）。后续必须用返回的 `name`（中文表名可能变成 `T_系统订单表`）。
3. `inspect_table` 确认键列名
4. `reconcile_tables`，传入 `leftTable` `rightTable` `keys`

不要覆盖源表。不要用模糊匹配。空键不会互配。不要用 `write_to_sheet` 手写对账结果。

## 结果列

`status`（matched / left_only / right_only / conflict）、`key`、`left_*`、`right_*`、`conflict_columns`
