---
name: finance-reconciliation
description: 跨境业财对账 — 订单×广告→利润假设（只编排核心算子，不写脚本）
slash: 跨境业财
---

# 跨境业财对账（示例）

对账口径、列映射、利润公式见 `knowledge/platform_fields.md` 与 `knowledge/profit_formula.md`（**待建**，上传知识库后检索）。**本技能只编排已有核心算子，不写 Python、不调 `scripts/*`、不编造费率/汇率。**

## 前置

- 订单表、广告表已进簿：Phase 1 = `/跨境业财` 预编排调用 `user.connector_load_feed` 读 fixture，表名 `Pack_订单` / `Pack_广告`。
- 参数 sheet（`假设参数`）就位：汇率、广告占比、退款率（默认值见知识库，用户可改）。

## 步骤（🟢）

1. **ensure_table** + **inspect_table**：确认两表表头、`columns[].index`、`sampleRows`（表体不进对话）。

2. **reshape_table** `op=project`：列映射到内部标准列名（SKU 归一 trim+lower、日期 coerce、金额 coerce number）— 映射表见 `knowledge/platform_fields.md`。

3. **reconcile_tables**：`leftTable=Pack_订单` `rightTable=Pack_广告` `keys=[platform_sku,biz_date]`，输出差异到新表（默认 `业财对账结果`）。**精确键匹配，不做模糊窗口。**

4. **write_inputs**：把汇率 / 广告占比 / 退款率写入 `假设参数` sheet。

5. **write_formula**（或 **calculate_table**）：按利润公式写活公式到新表（合计随源表变）— 公式见 `knowledge/profit_formula.md`。

6. **create_pivot**：按 SKU / 日期 / 平台切片；口径只列选项，不替用户拍板。

7. **审计**：向 `_pack_audit` sheet 写一行：Pack 名、版本、时间、匹配率、异常数、源文件 hash（证明非手改）。

## 归因窗口（只标注，不解决）

广告表 `date` = 点击日，订单表 `date` = 成交日，存在 0–7 天偏移。**本技能精确匹配，不模糊 JOIN**；匹配率 < 100% 属正常，在 `_pack_audit` 标一行「毛利为近似口径」。

## 试跑口令

- `/跨境业财 用 Pack_订单 和 Pack_广告 对账，算毛利透视`
- `订单/广告已导入，按 sku+date 对账并做利润假设`

## 边界

- 🔴 不接 ERP OAuth、不写 Python、不调 `scripts/*`（Antom 式脚本不属于本仓库）。
- 🟡 归因窗口 0–7 天：只标注，不解决（Phase 2 结算段再正规化）。
- 🟡 广告优化建议（出价/否定词）：不进本技能，卖家自行决策。
- 币种混用、缺失列：走参数 sheet 汇率路径，显式标注汇率来源。
