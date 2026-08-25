---
name: settlement-bank-recon
description: 结算×银行对账 — Pack_结算 与 Pack_银行 桥表。支持金额+日期窗口（默认 ±3 天，可改 dateWindowDays）或 settlement_id 精确匹配。技术验证 feed，不主张业财闭环。用户说「结算对账 / 银行到账对不上 / settlement」时使用。
slash: 结算对账
---

# 结算 × 银行对账（编排手册）

> **定位**：技术验证管道（结算单→银行到账桥表），**不**对外吹「业财闭环」。
> **禁止**：发明工具、表体进对话、手写假对账表。

## 常量

| 键 | 值 |
|---|---|
| packId | `cross-border-ecommerce-finance` |
| 结算 sheet | `Pack_结算` |
| 银行 sheet | `Pack_银行` |
| 对账结果 | `结算对账结果` |
| 审计 runType | `settlement-bank` |

## 对账模式（二者可选）

| 模式 | 何时用 | 参数 |
|------|--------|------|
| **A 金额+日期窗口（默认）** | 银行备注无 settlement_id | `keys: ["amount","biz_date"]`，`matchMode: "date_window"`，`dateWindowDays: 3`（可改；用户说「±5 天」则填 5） |
| **B settlement_id 精确** | 双方都有对齐 id（fixture / 用户补充） | `keys: ["settlement_id"]`，`matchMode: "exact"` |

用户补充含「精确」「settlement_id」「按单号」→ 模式 B；否则模式 A。`dateWindowDays` 默认 **3**，可改。

---

## 编排

### 0. 探路
`get_sheet_names` — 若已有 `Pack_结算` 与 `Pack_银行`，跳过步骤 1。

### 1. 取数（缺表时）
```
user.connector_load_feed({ feed: "settlement", packId: "cross-border-ecommerce-finance" })
user.connector_load_feed({ feed: "bank", packId: "cross-border-ecommerce-finance" })
write_to_sheet({ sheetName: "Pack_结算", data: [headers, ...rows] })
write_to_sheet({ sheetName: "Pack_银行", data: [headers, ...rows] })
```
记下 `meta.sourceHash`。

### 2. 建表
```
ensure_table({ sheetName: "Pack_结算" })  → leftTable
ensure_table({ sheetName: "Pack_银行" })  → rightTable
```

### 3a. 模式 A — 金额 + date_window
```
reconcile_tables({
  leftTable: "<结算 Table>",
  rightTable: "<银行 Table>",
  keys: ["amount", "biz_date"],
  matchMode: "date_window",
  dateWindowDays: 3,
  leftDateKey: "biz_date",
  rightDateKey: "biz_date",
  outputSheet: "结算对账结果"
})
```
`dateWindowDays` 按用户补充覆盖（默认 3）。

### 3b. 模式 B — settlement_id 精确
```
reconcile_tables({
  leftTable: "<结算 Table>",
  rightTable: "<银行 Table>",
  keys: ["settlement_id"],
  matchMode: "exact",
  outputSheet: "结算对账结果"
})
```

### 4. 审计
```
total = matched + left_only + right_only + conflict
matchRate = total > 0 ? matched / total : 0
append_pack_audit({
  packId: "cross-border-ecommerce-finance",
  packVersion: "0.1.0",
  runType: "settlement-bank",
  matched, leftOnly, rightOnly, conflict,
  reviewPending,
  sourceHashOrders: "<settlement hash 或 imported>",
  sourceHashAds: "<bank hash 或 imported>",
  note: "结算×银行；模式=<A date_window N天 | B settlement_id exact>；字段以卖家后台导出为准",
  assumptionSnapshot: "{\"mode\":\"A|B\",\"dateWindowDays\":3}",
  matchRate
})
```

### 5. 结论 + complete
```
① 口径：Pack_结算×Pack_银行，模式 <A/B>（窗口 <N> 天或 id 精确）。
② 结果：matched=<m> left_only=<l> right_only=<r> conflict=<c>；匹配率 <pct>%。
③ 边界：技术验证桥表；未接银行 API；不做总账/现金流管理。
```

## 试跑口令

- `/结算对账`
- `/结算对账 窗口5天`
- `/结算对账 按 settlement_id 精确匹配`

## 边界

- 🔴 不接 ERP/银行 OAuth
- 🟡 金额键依赖两侧 `amount` 已归一（同币种、同符号约定：到账为正）
