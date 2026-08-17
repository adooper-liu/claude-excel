# reshape

把脏表收成能算的新表。源表只读。

| op | 用户怎么说 | 结果 |
|---|---|---|
| `dedupe` | 按订单号去重 | 键相同只留第一行 |
| `unpivot` | 反透视 / 转长表 | 宽表变长表（属性 / 值） |
| `split` | 把标签按逗号拆开 | 一列拆成 `列_1` `列_2` … |
| `coerce` | 把金额转成数字 | 非法值变空 |
| `project` | 按位置映射/合并列 | 选列或 merge 多列成新列名；无真表头时 `headerless:true` |
| `flatten_header` | 双层/合并表头拍平 | 大类+子列合成一行表头，写新表；时间值原样保留 |

必须先是 Excel Table（`ensure_table`），**flatten_header 除外**——它用 `sheetName`+`range`+`headerRows`（默认 2），不要 `read_range` 代替。空工作簿或没有带表头的表时，先问要不要生成样例，不要报错结束。不跨文件合并。从网址取数走 /取数。
