# format

改样子，不改数字。规范表格时用本工具上色，不要另造套色工具。

| 工具 | 干什么 |
|---|---|
| `format_range` | 单区：加粗、字色、底色、数字格式、字号、列宽、对齐、换行、边框、行高、自适应列宽、冻结窗格。 |
| `conditional_format` | 数据条 / 色阶 / 图标 / 单元格值 / 前十。 |
| `data_validation` | 下拉列表、数字范围、自定义公式；`clear` 清除。 |

## 规范表（`/规范`）

先 `inspect_formulas`，用返回的 `inputSample` / `formulaSample`（`kind=formula|cross_sheet`）对着格子调用 `format_range`：

- 手工输入的数字：`color=#0000FF`
- 同表公式：`color=#000000`
- 跨表引用（公式含 `!`）：`color=#008000`
- 关键假设区：`bgColor=#FFFF00`
- 金额：`numberFormat=¥#,##0.00;¥(#,##0.00);-`
- 比例：`0.0%`（格子里存 `0.15`，不要写 `15`）
- 表头：`bold`、`hAlign=center`、`border=thin`；首行冻结 `freezeRows=1`
