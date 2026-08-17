# 任务：修复业财利润公式 = 销售额（应算净利）

## 交接指令（复制给 Cursor，不用手敲）

> `docs/tasks/finance-profit-formula.md` · `feat/finance-profit-formula`

```bash
git checkout master && git pull && git checkout -b feat/finance-profit-formula
```

> 上游口径：`samples/packs/cross-border-ecommerce-finance/knowledge/profit_formula.md` 第一节净利公式。

- **分支**：`feat/finance-profit-formula`
- **状态**：`design`
- **主责（当前阶段）**：Claude Code（design）→ Cursor（coding）

## 目标

`/跨境业财` 的「业财利润公式」现在只算 `SUMIFS(left_item_price)` = **销售额合计**，一个成本没减。改成真正的**净利活公式**（收入 − 广告费 − 佣金 − FBA − COGS − 退款等），并接入 `user.profit_assumptions` 的假设费率。

## 边界 / 不做

- **写格仍走核心算子**（`write_formula` 活公式 + `write_inputs` 写假设），禁止 Python/`user.*` 直接写格（CLAUDE.md 三条根骨）。
- **不加 `calculate_table` 的 profit op**——净利多列运算用通用 `write_formula`，不为「利润」堆专用算子（CLAUDE.md「算子要通用，口令不要堆」）。
- 假设值走 `user.profit_assumptions`（已有 11 项费率）或 `假设参数` sheet，**不编基准数字**（profit_formula.md 第五节铁律）。
- 利润是**活公式**，合计随源表变；不把结果写死成静态值。

## 验收

- [ ] 后端 `pytest backend/tests` 全绿
- [ ] 前端 `npm run test:unit` + `npm run typecheck` 全绿
- [ ] `业财利润公式` sheet 每 SKU 行是**净利活公式**（引用 item_price、spend、假设费率），不是 `SUMIFS(item_price)` 裸值
- [ ] 假设参数从 `user.profit_assumptions` 的 11 项费率写入（佣金/FBA/COGS/退款/仓储/支付手续费/其他），不再是写死 3 个占位参数（汇率/广告占比/退款率）
- [ ] 源表 `Pack_*` 零写入；利润公式合计随源表变（改源表数字 → 净利变）
- [ ] SKILL.md 第 5 步同步（说明净利公式口径，引用 profit_formula.md）

## 方案（design）

### 现状锚点

| 文件 | 关键位置 | 现状 |
|---|---|---|
| `addin/src/excel/finance-run.ts` | 利润公式 L144-151 | `calculateTable({op:"sumifs", groupBy:"left_platform_sku", valueColumn:"left_item_price"})` = 销售额合计，无成本扣减 |
| `addin/src/excel/finance-run.ts` | `ensureAssumeSheet` L34-55 | 写死 3 个占位参数（USD汇率 7.2 / 广告占比 0.08 / 退款率 0.03），未接 `user.profit_assumptions` |
| `.../extensions/profit-assumptions/handler.py` | `DEFAULTS` L9-21 | 已有 11 项费率：referral 0.15 / fba 0.12 / return 0.03 / ad 0.08 / cogs 0.35 / inbound 0.02 / storage 0.01 / fx_loss 0.01 / vat 0 / duty 0 / other 0.02 |
| `addin/src/excel/calculate.ts` | `CalculateOp` L6（import） | 只支持 `lookup\|sumifs\|fix_ref`，无多列净利 |
| `addin/skills/core/formula/manifest.json` | `write_formula` / `fill_range` | 通用活公式算子（=SUM/INDEX/IF），可写净利公式 |

### 1. 净利口径（对齐 profit_formula.md 第一节）

每 SKU 一行的净利活公式，核心结构（活公式，引用对账结果表 `业财对账结果` + `假设参数` sheet）：

```
净利 = SUMIFS(对账结果[item_price], 对账结果[SKU], @SKU) × (1 − 退款率)
     − SUMIFS(对账结果[spend], 对账结果[SKU], @SKU)
     − SUMIFS(item_price) × (佣金率 + FBA费率 + COGS率 + 仓储率 + 支付手续费率 + 其他率)
```

（COGS/佣金/FBA/仓储/支付手续费按**费率 × 销售额**估算——与 `profit_assumptions.DEFAULTS` 的费率口径一致；Phase 1 不做按件绝对金额，Phase 2 再接 COGS_SKU 映射表。）

### 2. 假设参数接入 `user.profit_assumptions`

- `finance-run.ts` 调 `user.profit_assumptions`（传对账结果里的 SKU 集合），拿到 11 项费率
- 用 `write_inputs` 把费率写进 `假设参数` sheet（列：参数名 + 值 + 说明），替代现在的 3 个占位
- 净利活公式引用 `假设参数` sheet 的费率单元格（绝对引用）

### 3. 利润公式走 `write_formula`

- 用 `write_formula` 写每 SKU 的净利活公式（=SUMIFS(...)−SUMIFS(...)−...），`fill_range` 填充到全部 SKU 行
- 替代 `calculateTable(op:"sumifs")`（那只能单列聚合，算不了净利）

### 4. SKILL.md 第 5 步同步

- 说明净利公式口径（收入 − 广告 − 佣金 − FBA − COGS − 退款），引用 profit_formula.md 第一节
- 强调「假设费率来自 user.profit_assumptions，非精确基准」

## Review notes

（待 coding 后填）

## 进度 log

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| 2026-08-17 | design | Claude Code | `—` | 记录问题：利润公式=销售额；定方向：write_formula 净利活公式 + 接 user.profit_assumptions 11 项费率 |
