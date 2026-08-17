# 任务：Pack 层 §B1.4 — finance Pack 启用 date_window + review_pending 审计

## 交接指令（复制给 Cursor，不用手敲）

> `docs/tasks/finance-date-window.md` · `feat/finance-date-window`

```bash
git checkout master && git pull && git checkout -b feat/finance-date-window
```

> 上游：`docs/tasks/post-gate-1b-capability-backlog.md` §B1.5/§B1.6/§B1.7（B1 核心已合 master，本任务做 Pack 层收尾）。

- **分支**：`feat/finance-date-window`
- **状态**：`design`
- **主责（当前阶段）**：Claude Code（design）→ Cursor（coding）

## 目标

业财对账（`/跨境业财`）用 `matchMode: date_window` 收回归因偏移（广告点击日 vs 订单成交日 0–7 天），`_pack_audit` 记录 `review_pending` 计数。

## 边界 / 不做

- 只改 Pack 层 + `reconcile` 结果暴露 `reviewPending`；**不改 B1 核心匹配决策树**。
- 写格仍走 `reconcile_tables` 写新表，不改源表。
- `reviewPending` = `__review=需复核` 的行数（date_window 配对 + conflict），**不改 core 的 review 判定逻辑**。

## 验收

- [ ] 后端 `pytest backend/tests` 全绿
- [ ] 前端 `npm run test:unit` + `npm run typecheck` 全绿
- [ ] `reconcile-core.test.js` 补 `reviewPending` 断言（date_window 配对 + conflict → 需复核计数正确；exact 基线 reviewPending=0）
- [ ] `/跨境业财` 跑完后 `_pack_audit` 新行 `note` 含 `review_pending=N`（N > 0，含归因偏移行）
- [ ] 归因偏移行（ad_date 早 3 天）在 `业财对账结果` 中 `__match_mode=date_window`、`__review=需复核`
- [ ] SKILL.md 与实现一致（第 3 步 date_window、归因窗口段不再「只标注不解决」）

## 方案（design）

### 现状锚点

| 文件 | 关键位置 | 现状 |
|---|---|---|
| `addin/src/excel/reconcile-core.ts` | `ReconcileResult` L42、`reconcile()` 结尾 L497 | 返回 `{rows,counts,outputHeaders,outputRows}`，无 reviewPending；`ReconcileRow.review` 已是 `"auto"\|"需复核"` |
| `addin/src/excel/reconcile.ts` | `reconcileTables()` 返回值 L18-23 | 返回 `{outputSheet,outputTable,counts,keys}`，无 reviewPending |
| `addin/src/excel/finance-run.ts` | `reconcileTables` 调用 L126、`appendPackAudit` L183 | 用 exact（无 matchMode）；auditNote 只有 attrNote + matched |
| `addin/src/excel/pack-audit.ts` | `PackAuditEntry` L5、`auditHeaders()` L18、`entryToRow()` L34 | 无 reviewPending 字段 |
| `samples/packs/cross-border-ecommerce-finance/skills/finance-reconciliation/SKILL.md` | 第 3 步 L22、归因窗口段 L32、第 7 步 L30 | 写「精确匹配，不做模糊窗口」「归因只标注不解决」 |

### 1. `reconcile-core.ts`：ReconcileResult 加 `reviewPending`

- `ReconcileResult` 加 `reviewPending: number`
- `reconcile()` 返回前统计：`let reviewPending = 0; for (const r of rows) if (r.review === "需复核") reviewPending += 1;`

### 2. `reconcile.ts`：返回值透传 `reviewPending`

- `reconcileTables()` 返回对象加 `reviewPending: result.reviewPending`

### 3. `finance-run.ts`：用 date_window + 写 review_pending

- `reconcileTables` 调用加：`matchMode: "date_window"`、`dateWindowDays: 7`、`leftDateKey: "biz_date"`、`rightDateKey: "biz_date"`（keys 已含 `biz_date`，connector 归一保证同名）
- `attrNote` 改为「广告点击日 vs 订单成交日 0–7 天偏移；date_window 归因，`__review=需复核` 行待人工确认」
- `auditNote` 追加 `review_pending=` + `recon.reviewPending`
- `appendPackAudit` 加 `reviewPending: recon.reviewPending`

### 4. `pack-audit.ts`：加 `reviewPending` 字段

- `PackAuditEntry` 加 `reviewPending?: number`
- `auditHeaders()` 在 `note` 前加 `"review_pending"`
- `entryToRow()` 对应位置加 `entry.reviewPending ?? ""`

### 5. `finance-reconciliation/SKILL.md`：文档同步

- 第 3 步：`keys=[platform_sku,biz_date]` 后加 `matchMode: "date_window", dateWindowDays: 7, leftDateKey/rightDateKey: "biz_date"`（说明收回归因偏移）
- 归因窗口段：改为「date_window 收回归因偏移，配对行 `__review=需复核` 待确认」
- 第 7 步审计：加 `review_pending` 计数

### 6. 测试

- `reconcile-core.test.js` 补：date_window 配对 + conflict 的 `reviewPending` 计数；exact 基线 `reviewPending=0`

## Review notes

（待 coding 后填）

## 进度 log

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| 2026-08-17 | design | Claude Code | `—` |
| 2026-08-17 | coding | Codex CLI | `efa049e` | Pack §B1.4：reconcile 暴露 reviewPending + finance-run 用 date_window(7)/biz_date + pack-audit 加 review_pending 列 + SKILL.md 同步；前端 241 / 后端 121 / typecheck 全绿，dirty fixture 集成核验 date_window reviewPending=10、SKU-016/17/18 收回 | 定方案：reviewPending 放 core、finance-run 用 date_window(7)/biz_date、pack-audit 加字段、SKILL.md 同步 |
