# calculate

用还活着的公式算。源表只读；汇总值禁止写死。

| op | 用户怎么说 | 写出什么 |
|---|---|---|
| `lookup` | 按订单号把金额匹配过来 | 新表里 `INDEX` + `MATCH`（精确匹配，不依赖 XLOOKUP） |
| `sumifs` | 按类别求和 | 新表里 `SUMIFS`，合计会随源表变 |
| `fix_ref` | 修 #REF! | 新表去掉公式里的 `#REF!` 参数 |

必须先是 Excel Table（`ensure_table`）。空工作簿或没有带表头的表时，先问要不要生成样例，不要报错结束。不做透视表全功能。
