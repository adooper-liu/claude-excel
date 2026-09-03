---
name: finance-sensitivity
description: 跨境业财敏感性分析 — 在不破坏原假设的前提下，试算单一参数的五档变化，输出临界 SKU 与场景审计。前提是已有「假设参数」和「业财利润公式」。用户说「敏感性 / 假设情景 / 退款率涨到 / 汇率跌到 / 佣金变化」「业财敏感性」时使用。
slash: 业财敏感性
---

# 跨境业财敏感性（六步强模板）

> **前提**：本簿已有 `假设参数` 和 `业财利润公式`，且利润表使用引用参数格的活公式。缺任一项则提示先跑 `/跨境业财`。
> **禁止**：把整张表贴进回复、编造费率或利润、覆盖利润公式格、一次改多个参数、把临时参数留在用户工作簿。
> **工具边界**：只使用已注册的 `get_sheet_names` / `inspect_table` / `read_range` / `write_inputs` / `write_to_sheet` / `sort_filter` / `format_range` / `append_pack_audit` / `complete`。

## 常量

| 键 | 值 |
|---|---|
| packId | `cross-border-ecommerce-finance` |
| packVersion | 读 installed pack；不知则用 `0.1.3` |
| 利润表 | `业财利润公式` |
| 假设表 | `假设参数`（B2–B10） |
| 输出 | `H3_敏感性_<参数中文名>` |
| 目标净利率 | `假设参数!B9` |
| 审计 | `_pack_audit`（只通过 `append_pack_audit` 写） |

## 参数映射

| 用户说法 | 单元格 |
|---|---|
| 汇率 / USD 汇率 | `假设参数!B2` |
| 佣金率 / 佣金 | `假设参数!B3` |
| 退款率 / 退货率 | `假设参数!B4` |
| FBA / FBA 基础费 | `假设参数!B5` |
| 广告占比 / TACOS | `假设参数!B10` |

用户没说参数时，只列出以上 5 项让用户选，不自行选择。一次只分析一个参数。

## 默认五档

| 档位 | 参数值 |
|---|---|
| -10% | 原值 × 0.90 |
| -5% | 原值 × 0.95 |
| 0% | 原值 × 1.00 |
| +5% | 原值 × 1.05 |
| +10% | 原值 × 1.10 |

用户明确给出其它 ±N%、绝对目标值或差量（包括旧口令 `退款率+4pp`）时，用该值替换最接近的非基准档；始终保留 0% 基准档，最多 5 档。所有目标值必须从读取到的原值计算，不从行业区间猜测。

## 编排（严格按序）

### 1. 探路

调用 `get_sheet_names`，确认存在 `假设参数` 与 `业财利润公式`。H1 已把利润 sheet 转成 Table，因此再调用 `inspect_table({ tableName: "业财利润公式" })`；工具会把 sheet 名解析到真实 `T_*` Table 名。只确认表头、行数和 SKU/净利/净利率列，不读取整张表。`假设参数` 不是 Table，不对它调用 `inspect_table`。缺前置时直接：

```
complete({ result: "请先运行 /跨境业财，生成假设参数与业财利润公式后再做敏感性分析。" })
```

### 2. 读现状并锁定单参数

```
read_range({ sheetName: "假设参数", range: "A1:C11" })
```

记录目标参数原值、`B9` 目标净利率和 B2–B10 的 `beforeSnapshot`。未给档位时使用默认五档；用户给出绝对目标值、差量或其它 ±N% 时，按“默认五档”规则替换一个非基准档。禁止同时变更多个参数。

### 3. 逐档试算并立即还原

每档严格执行 `write_inputs → read_range → write_inputs`，上一档还原原值后才能进入下一档：

1. `write_inputs` 临时写目标 `假设参数!B{x}`；
2. `read_range` 读取「业财利润公式」中的 SKU、净利、净利率，保存该档快照；
3. `write_inputs` 立即还原原值，再开始下一档。

```
write_inputs({
  sheetName: "假设参数",
  cells: [{ address: "B{x}", value: <该档参数值> }]
})
```

若任一写入或读取失败，也必须先用 `write_inputs` 还原原值，再调用 `complete` 报告失败。最终再 `read_range` 复核目标格等于原值；不相等则停止，不写结果和审计。

### 4. 写场景矩阵并标临界

只把步骤 3 已读取的数值快照写入新 sheet，禁止手算或改利润公式：

```
write_to_sheet({
  sheetName: "H3_敏感性_<参数中文名>",
  data: [
    ["SKU", "-10% 净利", "-5% 净利", "0% 净利", "+5% 净利", "+10% 净利", "临界点"],
    ["<SKU>", "<各档读取值>", "...", "...", "...", "...", "<首次触发档位或无>"]
  ]
})
```

临界条件为任一档 `净利 <= 0` 或 `净利率 < 假设参数!B9`。对临界行调用：

```
format_range({ sheetName: "H3_敏感性_<参数中文名>", range: "<临界行>", color: "#FF0000" })
```

将“临界点”写成 `1 | <首次触发档位>` 或 `0 | 无`，再把临界行排在前面：

```
sort_filter({
  sheetName: "H3_敏感性_<参数中文名>",
  range: "A1:G<末行>",
  action: "sort",
  sortBy: [{ column: "临界点", order: "descending" }]
})
```

回复只引用临界 SKU 的最多 5 个样本与汇总数量，不粘贴矩阵表体。

### 5. 审计

`append_pack_audit` 没有 `scenarios` 字段；把紧凑场景摘要序列化到现有 `note`，不得伪造对账指标：

```
append_pack_audit({
  packId: "cross-border-ecommerce-finance",
  packVersion: "0.1.3",
  runType: "finance-sensitivity",
  note: "scenarios=<参数/原值/五档/各档临界数的 JSON>；critical_skus=<最多5个>",
  assumptionSnapshot: "<beforeSnapshot JSON>"
})
```

H3 没有对账步骤，所以不传 `matched` / `leftOnly` / `rightOnly` / `conflict` / `reviewPending` / `sourceHashOrders` / `sourceHashAds` / `matchRate`。

### 6. 三段式结论 + complete

```
① 当前：<参数> 原值 <base>；本次仅改变这一项，五档结果见「H3_敏感性_<参数中文名>」。
② 临界：从 <档位> 起有 <n> 个 SKU 净利≤0 或净利率低于 B9；最先触发的 SKU 为 <最多5个>。
③ 边界：结果来自活公式重算；COGS 空值仍按 H1 口径处理，混币仍按 B2 近似；假设参数已还原为 <base>。
```

最后调用 `complete({ result: "<三段式全文>" })`。

## 试跑口令

- `/业财敏感性 退款率五档`
- `/业财敏感性 退款率+4pp`
- `/业财敏感性 汇率跌到 7.0`
- `/业财敏感性 佣金率上下浮动 5%`

## 边界

- 不做蒙特卡洛，不做多参数联合，不做多币种多主体联动
- 每档后必须还原参数原值；不得把临时档位留在用户工作簿
- 场景结果是决策输入，不替用户决定调价、停投或换品
