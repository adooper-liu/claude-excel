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
- [ ] 日期规整单测：Excel 序列号 `45296`、yyyyymmdd `20240105`、ISO `2024-01-05` → 统一 `2024-01-05`（coerceDate + dateToDay 各补）
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

### 0. 日期规整（date_window 前置，根因修复）

**根因**：日期列混存 Excel 序列号（`45296`=2024-01-05）与 yyyymmdd 数字（`20240105`=2024-01-05），三处日期处理都不完整：
- `reshape-core.ts` `coerceDate` L207：数字原样返回（不当序列号转日期），只认 ISO 字符串
- `column-format-core.ts` `applyFormatToCell` datetime 分支 L179：原样保留，不统一
- `reconcile-core.ts` `dateToDay` L84：数字一律当 Excel 序列号，yyyyymmdd `20240105` 被 `Math.round` 成巨大天数

**改法**：新建 `addin/src/excel/date-cell.ts`（纯函数，无 Office JS），统一识别三种格式：

```ts
/** 识别 Excel 序列号 / yyyymmdd / ISO 字符串 → 返回 Excel 天数（序列号）；非日期返回 null */
export function parseDateCell(value: Cell): number | null
/** Excel 天数 → "YYYY-MM-DD" */
export function dayToIso(day: number): string
```

识别规则：
1. number ≥ 19000101 且 ≤ 20991231 → yyyymmdd（拆年/月/日，`Date.UTC`）
2. number 其他（1–60000）→ Excel 序列号（天数），直接返回
3. string 匹配 `YYYY-MM-DD` / `YYYY/M/D` → `Date.UTC`
4. string 8 位数字（yyyymmdd）→ 拆年/月/日
5. 其他 string → `Date.parse`（NaN → null）

三处接入：
- `reshape-core.ts` `coerceDate` → `parseDateCell` + `dayToIso`，统一输出 ISO 字符串（解决「整理结果」表 E 列混存）
- `column-format-core.ts` datetime 分支 → 同上，datetime 列统一 ISO
- `reconcile-core.ts` `dateToDay` → `parseDateCell`（返回天数）

**验证基准**（`1899-12-30 + 天数`）：45296→2024-01-05、45297→2024-01-06、46027→2026-01-05、20240105→2024-01-05。

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

**结论：efa049e（Pack §B1.4 核心）正确、无阻塞；但日期规整（第 0 步）未做，date_window 对混存日期仍会错，需补完再合入。**

已确认正确：
- `reviewPending` 统计 = `review === "需复核"` 行数（reconcile-core.ts），语义正确
- date_window 参数正确（dateWindowDays=7、leftDateKey/rightDateKey 同名 biz_date，满足实现约束）
- `__` 审计列不影响下游 calculate_table / pivot（只取 left_platform_sku / item_price / spend）
- 测试断言正确（exact=0、date_window 配对=3、tie conflict=1）

待办（非缺陷）：**日期规整（第 0 步）未做**——efa049e 无 `date-cell.ts`。当前 date_window 对 ISO 日期正确（dirty fixture 核验通过），但混存日期（Excel 序列号 `45296` / yyyymmdd `20240105`）会被 dateToDay 解析错（`20240105` 当序列号 → 巨大天数）。需按 brief 第 0 步补 `parseDateCell` + 三处接入后再合入。

## 进度 log

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| 2026-08-17 | design | Claude Code | `—` | 定方案：reviewPending 放 core、finance-run 用 date_window(7)/biz_date、pack-audit 加字段、SKILL.md 同步 |
| 2026-08-17 | coding | Codex CLI | `efa049e` | Pack §B1.4：reconcile 暴露 reviewPending + finance-run 用 date_window(7)/biz_date + pack-audit 加 review_pending 列 + SKILL.md 同步；前端 241 / 后端 121 / typecheck 全绿，dirty fixture 集成核验 date_window reviewPending=10、SKU-016/17/18 收回 |
| 2026-08-17 | design | Claude Code | `—` | 补第 0 步日期规整：Excel 序列号/yyyymmdd/ISO 混存 → 共享 parseDateCell 统一三处（coerceDate/datetime/dateToDay） |
| 2026-08-17 | review | Claude Code | `—` | 只读 review：efa049e 核心正确无阻塞；日期规整（第 0 步）未做，需补完再合入 |
| 2026-08-17 | coding | Codex CLI | `8cb6555` | 第 0 步日期规整：新增 date-cell.ts（parseDateCell/dayToIso），三处接入 coerceDate/datetime/dateToDay；date-cell 基准 45296/45297/46027/20240105 全对，前端 246 / 后端 121 / typecheck 全绿 |
