# inspect

看结构，也看公式。改表之前先读。

| 工具 | 干什么 |
|---|---|
| `inspect_workbook` | 工作表、Table、表头、行数。不倾倒全部单元格。 |
| `inspect_table` | 一张表的表头、行数、最多 5 行样例。 |
| `inspect_formulas` | **同时**返回公式原文和算出来的值。给计数、最多 40 个错误格、`inputSample`（手工数字）和 `formulaSample`（含 `kind=formula\|cross_sheet`）。不倾倒整张网格。 |
| `scan_formula_errors` | 只找错误值：`#REF!` `#DIV/0!` `#N/A` `#NAME?` `#VALUE!` `#NUM!` 等。可指定一张表。只读，不覆盖源表。 |

有 Table 时 `inspect_formulas` 传 `tableName`。不要用 `read_range` 代替公式体检——它只返回显示值。
