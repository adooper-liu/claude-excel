---
name: finance-reconciliation
description: 跨境业财对账 — 订单×广告→假设参数→活公式口径表→透视→审计。只编排核心算子与 user.connector_load_feed；不写脚本、不编造费率。用户说「跨境业财 / 业财对账 / 订单广告对账算利润」时使用。
slash: 跨境业财
---

# 跨境业财对账（编排手册）

> **强模板**：下列每步给出工具名 + 完整参数骨架。你只填上一步返回的动态值（表名、Table name、counts、hash）。
> **禁止**：发明工具名、把表体读进对话、用手写格子伪造对账/透视结果、跳步、另开平行流水线。
> **口径权威**：数字默认值与净利公式以 Pack 内 `knowledge/profit_formula.md` 为准（与本文件附录 A/B 对齐，改口径=改文档后重装 Pack）。

## 禁止分叉（本技能本回合一律不做）

| 禁止 | 正确替代 |
|---|---|
| `user.profit_assumptions` | 步骤 4：`write_to_sheet` + `write_inputs` 写「假设参数」 |
| `extract_selection` / 新建 `SKU_订单` `SKU_广告` | 步骤 5：`calculate_table` 对**对账结果表**按 `left_platform_sku` 分组 |
| `calculate_table` 打在 `Pack_订单` / `Pack_广告` 上产出 `订单汇总` `广告汇总` | 同上，`tableName` = 步骤 3 的 `outputTable` |
| 新建 `利润测算` sheet | 只写「业财利润公式」 |
| `create_pivot` 打在对账结果表（`T_业财对账结果` / `T_finance_recon`） | 步骤 6：先 `ensure_table(业财利润公式)` 再透视该表 |
| `read_range` 读 Pack_订单/广告表体凑 SKU 列表 | 禁止；SKU 只来自 `calculate_table` 分组列 |

本回合允许的 `user.*` **仅** `user.connector_load_feed`（且仅步骤 1 缺表时）。其它 `user.*` 即使出现在工具列表里也不要调。

## 常量（本 Pack）

| 键 | 值 |
|---|---|
| packId | `cross-border-ecommerce-finance` |
| packVersion | 读 installed pack；不知则用 `0.1.0` |
| 订单 sheet | `Pack_订单` |
| 广告 sheet | `Pack_广告` |
| 对账结果 | `业财对账结果` / Table `T_finance_recon` |
| 假设参数 | `假设参数` |
| 口径表 | `业财利润公式` |
| 透视 | `业财利润透视` |
| 审计 | `_pack_audit`（只通过 `append_pack_audit` 写） |

---

## 编排（严格按序；每步完成后才进入下一步）

### 0. 探路
`get_sheet_names` → 若已有 `Pack_订单` 与 `Pack_广告`，跳过步骤 1 的 load/write。

### 1. 取数（仅缺表时）
```
user.connector_load_feed({ feed: "orders", packId: "cross-border-ecommerce-finance" })
user.connector_load_feed({ feed: "ads",    packId: "cross-border-ecommerce-finance" })
```
用返回的 `headers` + `rows`（**不要把 rows 贴进对用户可见回复**）调用：
```
write_to_sheet({ sheetName: "Pack_订单", data: [headers, ...rows] })
write_to_sheet({ sheetName: "Pack_广告", data: [headers, ...rows] })
```
记下 `meta.sourceHash` → 后面审计用。

### 2. 建表
```
ensure_table({ sheetName: "Pack_订单" })  → 记下返回 name（可能是 T_Pack_订单）
ensure_table({ sheetName: "Pack_广告" })  → 记下返回 name
```
可选 `inspect_table` 只看表头/sampleRows（最多 5 行），确认有 `platform_sku`、`biz_date`。

### 3. 对账（date_window）
```
reconcile_tables({
  leftTable: "<步骤2订单Table名>",
  rightTable: "<步骤2广告Table名>",
  keys: ["platform_sku", "biz_date"],
  matchMode: "date_window",
  dateWindowDays: 7,
  leftDateKey: "biz_date",
  rightDateKey: "biz_date",
  outputSheet: "业财对账结果",
  outputTable: "T_finance_recon"
})
```
记下返回：`counts.matched / left_only / right_only / conflict`、`reviewPending`、`outputTable`。

计算：
```
total = matched + left_only + right_only + conflict
matchRate = total > 0 ? matched / total : 0
```

### 4. 假设参数区（附录 A）
若无 `假设参数` sheet：
```
write_to_sheet({
  sheetName: "假设参数",
  data: [
    ["参数", "值", "说明"],
    ["USD汇率", "", "用户提供/待验证"],
    ["佣金率", "", "默认见附录 A；可改"],
    ["退款率", "", "默认见附录 A；可改"],
    ["FBA基础费_$", "", "小标准件"],
    ["FBA燃油附加_%", "", "履约费附加"],
    ["仓储均摊_$", "", "月度/件估算"],
    ["支付手续费率", "", "跨境收款"],
    ["目标净利率", "", "低于此值标风险"],
    ["广告占比观察", "", "可选；TACOS 对照用"],
    ["归因说明", "点击日vs成交日0-7天偏移", "只标注不解决"]
  ]
})
```
然后（公式格勿覆盖；只写输入格）：
```
write_inputs({
  sheetName: "假设参数",
  cells: [
    { address: "B2", value: 7.2 },
    { address: "B3", value: 0.15 },
    { address: "B4", value: 0.08 },
    { address: "B5", value: 3.22 },
    { address: "B6", value: 0.035 },
    { address: "B7", value: 1.5 },
    { address: "B8", value: 0.025 },
    { address: "B9", value: 0.10 },
    { address: "B10", value: 0.08 }
  ]
})
```
`format_range`：`假设参数!B2:B10` → `bgColor=#FFFF00`（黄底=可改输入）。

### 5. 口径表（附录 B — 算清楚 + 改得动）
先按 SKU 拉分组骨架（用件数占位即可，收入公式下一步覆盖 B 列）：
```
calculate_table({
  op: "sumifs",
  tableName: "<步骤3 outputTable>",
  groupBy: "left_platform_sku",
  valueColumn: "left_quantity",
  outputSheet: "业财利润公式"
})
```
再在同表用 `write_formula` 按附录 B 写：**收入=数量×单价×汇率**、佣金/FBA/仓储/广告/退款/净利。  
**硬约束**：
- 禁止 `SUMIFS(... left_item_price ...)` 当收入（那是单价求和，丢件数）
- 禁止死区间（`$列$2:$列$n`）；一律用表结构化引用 `T_xxx[列名]`（`T_xxx` = 步骤 3 的 `outputTable`）
- 金额类列（收入/FBA/仓储/广告）乘 `'假设参数'!$B$2`（USD→CNY）；混币（GBP/EUR）Phase 1 仍近似，须在结论注明
- FBA/仓储必须 × 件数（`SUMIFS(...[left_quantity]...)`）

若 `write_to_range` 或 `write_formula` 在横向区间一次写入时返回「输入数组中的行数或列数与区域大小或维度不符」：

1. 不重试同一横向区间写法；
2. 立刻改为**单格写入**（如 `B1`、`C1`… 或 `D2`、`E2`… 逐格写）；
3. 首行公式写完后，用 `fill_range` 向下填充到最后一行；
4. 用 `read_range` + `scan_formula_errors` 抽查（至少表头 1 行 + 公式 1 行）。

该回退是已验证稳定路径，优先保证可执行闭环，禁止因横向批量写失败而中断流程。

COGS：若无映射表，该列写空或提示文本，`format_range` 标黄，**不阻断**净利（COGS 当 0）。

退款：`is_refund` / `platform_status` 含退款的行不进收入基数；有 `refund_amount` 用实值，否则用 `收入×假设参数!$B$4`。

### 6. 透视（默认基于利润口径表）
先把「业财利润公式」转成表再透视，确保可直接看净利/净利率：
```
ensure_table({ sheetName: "业财利润公式" })  → 记下返回 name（如 T_业财利润公式）
```
```
create_pivot({
  tableName: "<上一步利润表 Table 名>",
  rows: ["SKU"],
  values: [
    { field: "收入", aggregation: "sum" },
    { field: "净利", aggregation: "sum" },
    { field: "净利率", aggregation: "average" }
  ],
  outputSheet: "业财利润透视"
})
```

### 7. 风险筛选（明确走 sort_filter）
在「业财利润公式」做两次筛选（或分别输出到新 sheet）：
```
sort_filter({
  sheetName: "业财利润公式",
  range: "<覆盖表头+数据的区域>",
  filterBy: [{ column: "净利", operator: "lte", value: "0" }]
})
```
```
sort_filter({
  sheetName: "业财利润公式",
  range: "<覆盖表头+数据的区域>",
  filterBy: [{ column: "净利率", operator: "lt", value: "<假设参数!B9>" }]
})
```
若工具不支持单元格引用比较值，则先读取 `假设参数!B9` 的当前数值再填入 `value`。

### 8. 把关 + 审计
组装 `assumptionSnapshot`（只读假设区当前值的 JSON 字符串，如 `{"B2":7.2,"B3":0.15,"B4":0.08,"B5":3.22,"B6":0.035,"B7":1.5,"B8":0.025,"B9":0.1}` — 数值来自上一步写入/用户已改值，**不编造**）。

`note` 模板：
```
广告点击日 vs 订单成交日 0–7 天偏移；date_window 归因，__review=需复核 行待人工确认；matched=<m>/<total>；review_pending=<n>；<若 matchRate<0.9 追加：净利为近似口径，匹配率 <pct>%，请复核 __review 行>
```

```
append_pack_audit({
  packId: "cross-border-ecommerce-finance",
  packVersion: "<常量>",
  runType: "finance-reconciliation",
  matched: <counts.matched>,
  leftOnly: <counts.left_only>,
  rightOnly: <counts.right_only>,
  conflict: <counts.conflict>,
  reviewPending: <reviewPending>,
  sourceHashOrders: "<步骤1 hash 或 imported>",
  sourceHashAds: "<步骤1 hash 或 imported>",
  note: "<上式>",
  assumptionSnapshot: "<JSON>",
  matchRate: <0–1>
})
```

若 `matchRate < 0.9`：对「业财利润公式」标题行或结果提示区 `format_range` 红字（`color=#FF0000`），文案含「净利为近似口径」。

### 9. 人话结论（附录 C）+ complete
用附录 C 三段式填空；**只填 summary 数字**（counts、matchRate、假设快照、口径表合计若已由公式算出且你只读了汇总格）。**表体行禁止进上下文**。
最后 `complete({ result: "<三段式全文>" })`。

---

## 附录 A — 假设参数默认值（与 profit_formula.md §四 单一真相）

| 单元格 | 标签 | 默认 | 说明 |
|--------|------|------|------|
| B2 | USD汇率 | 7.2 | 订单 USD→CNY |
| B3 | 佣金率 | 0.15 | 多数类目；服装可另调 |
| B4 | 退款率 | 0.08 | 普通类目均值 |
| B5 | FBA基础费_$ | 3.22 | 小标准件 |
| B6 | FBA燃油附加_% | 0.035 | 履约费×3.5% |
| B7 | 仓储均摊_$ | 1.50 | 月度估算 |
| B8 | 支付手续费率 | 0.025 | 跨境收款 |
| B9 | 目标净利率 | 0.10 | 风险阈值 |
| B10 | 广告占比观察 | 0.08 | 可选 TACOS 对照 |

改口径：改本表或 `profit_formula.md` §四 → 重装 Pack，**不必重编译加载项**。

---

## 附录 B — 口径表公式模板（写活公式，禁止写死）

对「业财利润公式」每个 SKU 行（设 SKU 在 A 列，数据自第 2 行）。  
下面 `T_recon` = 步骤 3 返回的 `outputTable`（如 `T_业财对账结果` / `T_finance_recon`），**禁止**写成 `$列$2:$列$n` 这类死区间。

| 列 | 含义 | 公式骨架 |
|----|------|----------|
| A | SKU | 来自 calculate_table 分组 |
| B | 收入（CNY） | `=SUMPRODUCT((T_recon[left_platform_sku]=A2)*(T_recon[left_quantity])*(T_recon[left_item_price]))*'假设参数'!$B$2` |
| C | COGS | 有映射则 `=…`；无则空+黄底 |
| D | 佣金 | `=B2*'假设参数'!$B$3` |
| E | FBA配送（CNY） | `=SUMIFS(T_recon[left_quantity],T_recon[left_platform_sku],A2)*'假设参数'!$B$5*(1+'假设参数'!$B$6)*'假设参数'!$B$2` |
| F | 仓储（CNY） | `=SUMIFS(T_recon[left_quantity],T_recon[left_platform_sku],A2)*'假设参数'!$B$7*'假设参数'!$B$2` |
| G | 广告（CNY） | `=SUMIFS(T_recon[right_spend],T_recon[left_platform_sku],A2)*'假设参数'!$B$2` |
| H | 退款 | 优先实退；否则 `=B2*'假设参数'!$B$4`（仅退款相关 SKU） |
| I | 支付手续费 | `=B2*'假设参数'!$B$8` |
| J | 净利 | `=B2-IF(C2="",0,C2)-D2-E2-F2-G2-H2-I2` |
| K | 净利率 | `=IF(B2=0,"",J2/B2)` |
| L | 来源 | 文本：参数/源表/公式 |

**禁止**：`SUMIFS(T_recon[left_item_price],…)` 当收入（单价求和丢件数）；横向 `$列$2:$列$n` 死区间。  
表名含中文时结构化引用加单引号：`='T_业财对账结果'[left_quantity]`；参数格：`='假设参数'!$B$2`。  
写完 `inspect_formulas` / `scan_formula_errors` 抽查 2–3 格，确认：收入含 ×数量×汇率，FBA/仓储含 ×件数×汇率。

---

## 附录 C — 三段式结论模板（说清楚）

```
① 口径：收入=数量×单价×汇率(B2)；FBA/仓储按件数×费率×汇率；佣金/退款/手续费按收入比率。对 Pack_订单×Pack_广告 做 date_window(7) 后按 SKU 活公式汇总净利（见「业财利润公式」）。
② 近似：归因点击日≠成交日（≤7 天）；退款为预估除非有 refund_amount；混币行仍按 B2 近似换算；匹配率 <matchRate%>（matched <m>/<total>，review_pending=<n>）。<若 <90%：净利为近似口径，请复核 __review 行。>
③ 风险：请打开「业财利润公式」筛净利≤0 或净利率<目标（B9）的 SKU；TACOS=广告/收入，观察带见 knowledge。本结论数字均可追溯到口径表单元格，未编造。
```

---

## 试跑口令

- `/跨境业财`
- `/跨境业财 用 Pack_订单 和 Pack_广告 对账，算毛利透视`
- `订单/广告已导入，按 sku+date 对账并做利润假设`

## 边界

- 🔴 不接 ERP OAuth、不写 Python、不调 `scripts/*`
- 🟡 归因窗口：`__review=需复核` 待人工确认
- 🟡 广告出价/否定词建议：不进本技能
- 币种混用：走假设参数汇率，标注来源
