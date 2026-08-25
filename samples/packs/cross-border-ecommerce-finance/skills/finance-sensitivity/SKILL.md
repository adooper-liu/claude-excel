---
name: finance-sensitivity
description: 业财敏感性分析 — 改假设参数格后读汇总/筛选临界 SKU，写情景审计。依赖已有「假设参数」与「业财利润公式」活公式。用户说「敏感性 / 假设情景 / 退款率涨到」「业财敏感性」时使用。
slash: 业财敏感性
---

# 业财敏感性分析（编排手册）

> **前提**：本簿已有 `假设参数` + `业财利润公式`（活公式引用参数格）。没有则先跑 `/跨境业财`。
> **禁止**：表体进对话、编造费率、覆盖公式格、发明工具名。

## 常量

| 键 | 值 |
|---|---|
| packId | `cross-border-ecommerce-finance` |
| 假设参数 | `假设参数`（B2–B10） |
| 口径表 | `业财利润公式` |
| 情景矩阵 | `业财情景矩阵` |
| 审计 runType | `finance-sensitivity` |

## 预设情景（用户补充 / 一键按钮）

| 口令补充 | 改动 |
|---------|------|
| `退款率+4pp` / 默认无补充 | B4 → 原值+0.04（默认 0.08→0.12） |
| `汇率-0.2` | B2 → 原值−0.2 |
| `佣金+2pp` | B3 → 原值+0.02 |

先 `read_range` 只读 `假设参数!B2:B10`（最多 1 行样本区），记下**改前快照**，再 `write_inputs` 只改目标格。

---

## 编排

### 1. 确认前置
`get_sheet_names` — 须有 `假设参数`、`业财利润公式`。缺则 `complete` 提示先 `/跨境业财`。

### 2. 读当前参数（只读输入格）
```
read_range({ sheetName: "假设参数", range: "A1:C11" })
```
解析 B2–B10 数值 → `beforeSnapshot` JSON。按用户补充计算目标值（无补充 = 退款率+4pp）。

### 3. 写入情景假设
```
write_inputs({
  sheetName: "假设参数",
  cells: [{ address: "B4", value: <新退款率> }]
})
```
（其他情景改对应地址；禁止 `write_to_range` 覆盖公式。）

### 4. 临界筛选（活公式已随参数重算）
```
sort_filter({
  sheetName: "业财利润公式",
  range: "<表头+数据区>",
  filterBy: [{ column: "净利", operator: "lte", value: "0" }]
})
```
再筛净利率：
```
sort_filter({
  sheetName: "业财利润公式",
  range: "<同上>",
  filterBy: [{ column: "净利率", operator: "lt", value: "<B9 当前值>" }]
})
```
**只读汇总/筛选结果行数与 SKU 列样本（≤5）**，禁止整表进对话。

### 5. 情景矩阵行（可选）
若无 `业财情景矩阵`，建表头：
`情景,B2,B3,B4,B5,B6,B7,B8,B9,B10,说明`
追加一行当前情景快照（数值来自步骤 2–3，**不编造**）。

### 6. 审计
```
append_pack_audit({
  packId: "cross-border-ecommerce-finance",
  packVersion: "0.1.0",
  runType: "finance-sensitivity",
  matched: 0, leftOnly: 0, rightOnly: 0, conflict: 0,
  reviewPending: <净利≤0 的 SKU 数>,
  sourceHashOrders: "n/a",
  sourceHashAds: "n/a",
  note: "敏感性：<改动说明>；改前 <before>；改后 <after>；净利≤0 约 <n> 个 SKU",
  assumptionSnapshot: "<改后 B2–B10 JSON>",
  matchRate: 0
})
```

### 7. 结论 + complete
```
① 情景：将 <参数> 从 <旧> 调到 <新>（活公式引用假设格，未写死）。
② 结果：净利≤0 约 <n> 个 SKU；净利率低于目标(B9) 约 <m> 个（仅汇总，未贴表体）。
③ 边界：本表为边际贡献口径；COGS 空则当 0；混币按 B2 近似。未替用户拍板是否调价/停投。
```
`complete({ result: "..." })`

## 试跑口令

- `/业财敏感性`
- `/业财敏感性 退款率+4pp`
- `/业财敏感性 汇率-0.2`
- `/业财敏感性 佣金+2pp`

## 边界

- 🔴 不还原参数除非用户要求「恢复基准」
- 🟡 多情景对比：逐次改参数并追加矩阵行，或用户手动复制假设区
