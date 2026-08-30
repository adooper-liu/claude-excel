---
name: finance-pl
description: 业财损益汇总 — 基于已有「业财利润公式」活公式生成合计 P&L，含占收入比、亏损/低于目标 SKU 风险计数与审计。不心算利润、不写死结果。用户说「业财损益 / P&L / 损益表 / 利润表汇总」时使用。
slash: 业财损益
---

# 业财损益汇总（编排手册）

> **定位**：P&L 是已有对账/利润口径之上的**汇总层**；不发明第二套利润公式，不替代 `/跨境业财`。
> **强约束**：收入=数量×单价×汇率；所有合计、比率、风险数都用 Excel 活公式；模型只传公式与读回的汇总值，不做心算。
> **禁止**：发明工具、表体进对话、用 `SUMIFS(left_item_price)` 当收入、写死利润、覆盖公式格。

## 常量

| 键 | 值 |
|---|---|
| packId | `cross-border-ecommerce-finance` |
| packVersion | 读 installed pack；不知则用 `0.1.2` |
| 假设参数 | `假设参数`（B2–B10） |
| 利润口径表 | `业财利润公式` |
| 损益汇总 | `业财损益汇总` / Table `T_finance_pl` |
| 审计 | `_pack_audit`（只通过 `append_pack_audit` 写） |

---

## 编排

### 1. 前置检查

先 `inspect_workbook`，记录：

- `假设参数` 是否存在；
- `业财利润公式` 是否存在，以及它实际对应的 Table 名；
- 该 Table 是否至少有 `SKU`、`收入`、`净利`、`净利率` 列。

| 前置状态 | 处理 |
|---|---|
| 有 `假设参数` + `业财利润公式` 活公式 Table | 直接进入步骤 2 |
| 缺口径表，但有 `假设参数` + `T_finance_recon` / `业财对账结果` | 按附录 A 补口径表；禁止重跑对账 |
| 缺 `T_finance_recon` 或 `假设参数` | 默认 `complete` 提示先跑 `/跨境业财`；仅当用户明示「连数据一起建」时，先逐字执行已安装的 `finance-reconciliation` 手册步骤 0–6，再回到本手册步骤 2 |

不要把“补前置”变成第二套算法。`user.connector_load_feed`、`reconcile_tables`、`write_inputs` 与利润公式只能复用 `/跨境业财` 的常量和参数骨架。

### 2. 汇总表骨架

若 `业财损益汇总` 已存在，不覆盖公式；检查表头和 Table 名后可直接刷新或复用。  
若不存在，先写**标签和口径说明**，不写数字：

```js
write_to_sheet({
  sheetName: "业财损益汇总",
  data: [
    ["项目", "金额/数量", "占收入", "口径"],
    ["收入_CNY", "", "", "Σ 利润口径表[收入]"],
    ["COGS_CNY", "", "", "Σ 利润口径表[COGS]；空值按 0"],
    ["平台佣金_CNY", "", "", "Σ 利润口径表[佣金]"],
    ["FBA配送_CNY", "", "", "Σ 利润口径表[FBA配送]"],
    ["仓储_CNY", "", "", "Σ 利润口径表[仓储]"],
    ["广告_CNY", "", "", "Σ 利润口径表[广告]"],
    ["退款_CNY", "", "", "Σ 利润口径表[退款]"],
    ["支付手续费_CNY", "", "", "Σ 利润口径表[支付手续费]"],
    ["净利_CNY", "", "", "Σ 利润口径表[净利]"],
    ["净利率", "", "", "净利 / 收入"],
    ["亏损SKU数", "", "", "净利 <= 0"],
    ["低于目标SKU数", "", "", "净利率 < 假设参数!B9"],
    ["高风险SKU数", "", "", "取两类风险计数的较大值"]
  ]
})
```

再建表：

```js
ensure_table({ sheetName: "业财损益汇总", tableName: "T_finance_pl" })
```

**必须使用返回的实际 Table 名**；下面公式里的 `T_p` 是利润口径表 Table 的占位符，替换成步骤 1 返回的实际名（如 `T_业财利润公式`）。

### 3. 写活公式

优先逐格 `write_formula`，避免一次写横向数组失败；写完不重算、不替换成数值。金额/比率列示例：

| Cell | Formula |
|---|---|
| B2 | `=SUM('T_p'[收入])` |
| B3 | `=SUM('T_p'[COGS])` |
| B4 | `=SUM('T_p'[佣金])` |
| B5 | `=SUM('T_p'[FBA配送])` |
| B6 | `=SUM('T_p'[仓储])` |
| B7 | `=SUM('T_p'[广告])` |
| B8 | `=SUM('T_p'[退款])` |
| B9 | `=SUM('T_p'[支付手续费])` |
| B10 | `=SUM('T_p'[净利])` |
| B11 | `=IF(B2=0,"",B10/B2)` |
| B12 | `=COUNTIF('T_p'[净利],"<=0")` |
| B13 | `=COUNTIF('T_p'[净利率],"<"&'假设参数'!$B$9)` |
| B14 | `=MAX(B12:B13)` |
| C2 | `=IF($B$2=0,"",1)` |
| C3 | `=IF($B$2=0,"",B3/$B$2)` |
| C4 | `=IF($B$2=0,"",B4/$B$2)` |
| C5 | `=IF($B$2=0,"",B5/$B$2)` |
| C6 | `=IF($B$2=0,"",B6/$B$2)` |
| C7 | `=IF($B$2=0,"",B7/$B$2)` |
| C8 | `=IF($B$2=0,"",B8/$B$2)` |
| C9 | `=IF($B$2=0,"",B9/$B$2)` |
| C10 | `=IF($B$2=0,"",B10/$B$2)` |

若上层列名与上表不完全一致，**先以 `inspect_table` 返回的真实表头为准**重命名引用；不要猜列。若某费用列不存在，先补口径表，而不是在汇总表里心算。

格式建议：

```js
format_range({ sheetName: "业财损益汇总", range: "B2:B10", numberFormat: "¥#,##0.00;¥(#,##0.00);-" })
format_range({ sheetName: "业财损益汇总", range: "B11", numberFormat: "0.0%" })
format_range({ sheetName: "业财损益汇总", range: "C2:C10", numberFormat: "0.0%" })
format_range({ sheetName: "业财损益汇总", range: "B12:B14", numberFormat: "0" })
set_active_sheet({ sheetName: "业财损益汇总" })
```

对亏损和高风险计数加条件格式：

```js
conditional_format({ sheetName: "业财损益汇总", range: "B12:B14", type: "cellValue", operator: "greaterThan", compareTo: "0", fillColor: "#FFC7CE" })
```

### 4. 校验

```js
scan_formula_errors({ sheetName: "业财损益汇总" })
inspect_formulas({ sheetName: "业财损益汇总", range: "A1:D14" })
```

只允许保留/修公式，不允许把公式结果回写成静态值。若出现 `#REF!`、`#NAME?`、`#VALUE!`，先检查实际 Table 名、列名和结构化引用；不能解释时停止并报告。

### 5. 审计

汇总模式没有重新对账时，不要虚构匹配计数和匹配率；`matched/leftOnly/rightOnly/conflict` 传 `0`，省略 `matchRate`。  
`assumptionSnapshot` 只能来自 `read_range({ sheetName: "假设参数", range: "A1:C11" })` 读回的当前值；`reviewPending` 只能用 `B14` 的公式结果，不得用 SKU 行累加。

```js
append_pack_audit({
  packId: "cross-border-ecommerce-finance",
  packVersion: "<常量>",
  runType: "finance-pl",
  matched: 0,
  leftOnly: 0,
  rightOnly: 0,
  conflict: 0,
  reviewPending: "<读取 T_finance_pl!B14>",
  sourceHashOrders: "n/a",
  sourceHashAds: "n/a",
  note: "P&L 汇总；来源=<业财利润公式实际 Table 名>；模式=<summary|bootstrap>；亏损/低于目标计数见 T_finance_pl",
  assumptionSnapshot: "<B2–B10 当前值 JSON>"
})
```

若本回合确实先执行了 `/跨境业财` 补前置，则审计改用那次 `reconcile_tables` 返回的真实 `matched/leftOnly/rightOnly/conflict/matchRate/sourceHash`，不要保留 0。

### 6. 结论 + complete

```text
① 口径：P&L 基于「业财利润公式」按 SKU 活公式汇总；收入=数量×单价×汇率(B2)，费用和净利均引用口径表列，不写死结果。
② 近似：COGS 为空按 0；退款无实值时按 B4 预估；混币 Phase 1 仍按 B2 近似。<若本次有对账：matched=<m>/<total>，匹配率=<pct>%；review_pending=<n>。>
③ 风险：打开「业财损益汇总」看净利、净利率与亏损/低于目标 SKU 数；本技能只汇总口径，不替用户做调价、停投或停售决策。
```

`complete({ result: "<三段式全文>" })`

---

## 附录 A — 缺口径表时的补齐规则

仅在已有 `T_finance_recon` / `业财对账结果` 与 `假设参数` 时允许。不要重跑对账；按 `finance-reconciliation` 的既定口径补第 5–6 步：

1. `calculate_table` 按 `left_platform_sku` 分组 `left_quantity`，输出到 `业财利润公式`。
2. 用 `write_formula` + `fill_range` 写活公式。收入必须用：

```excel
=SUMPRODUCT((T_recon[left_platform_sku]=A2)*(T_recon[left_quantity])*(T_recon[left_item_price]))*'假设参数'!$B$2
```

3. FBA/仓储必须乘 `left_quantity`；佣金/退款/手续费按收入比率；金额默认乘 `'假设参数'!$B$2`。
4. 只用 `T_recon[列名]` 结构化引用；禁止 `$列$2:$列$n` 死区间。
5. `ensure_table` 后创建 `业财利润透视`，字段与 `/跨境业财` 一致。
6. 用 `scan_formula_errors` 校验，再回到本手册步骤 2。

## 试跑口令

- `/业财损益`
- `/业财损益 汇总本月 P&L`
- `/业财损益 看亏损和低于目标净利率的 SKU 数`

## 边界

- 🔴 不新增核心算子、TS 预编排、Python 扩展
- 🔴 不做总账、税务申报、现金流预测
- 🟡 口径表缺失时只能按 `/跨境业财` 补齐，不能另起公式
- 🟡 多币种仍走 B2 近似；真实多币种损益待 Phase 2
