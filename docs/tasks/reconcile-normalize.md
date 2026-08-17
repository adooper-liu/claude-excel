# 任务：对账 normalize + date_window（B1，不含 fuzzy）

## 交接指令（复制给 Cursor，不用手敲）

> `docs/tasks/reconcile-normalize.md` · `feat/reconcile-normalize`

```bash
git checkout master && git pull && git checkout -b feat/reconcile-normalize
```

> 本 brief 是 Claude Code × Cursor 的**唯一交接载体**。上游方案见 [`docs/tasks/post-gate-1b-capability-backlog.md`](post-gate-1b-capability-backlog.md) §B1；本文件从 §B1 摘出并补现状锚点（文件/行号/函数）。禁止在聊天里互贴长方案/状态。

- **分支**：`feat/reconcile-normalize`
- **状态**：`design`
- **主责（当前阶段）**：Claude Code（design）→ Cursor（coding）

## 目标

给 `reconcile_tables` 加三种匹配模式 `exact` / `normalize` / `date_window` + 行级审计列 `__match_mode` / `__match_score` / `__review`；`reshape op=project` 默认跳过 `__` 前缀列。默认仍是 `exact`，**backward compatible**。

## 边界 / 不做

- **不做字符串 fuzzy（Levenshtein）**——大表 O(n²) 风险；若要 → Pack `user.reconcile_key_suggest`（backlog §B1.4），**禁止进 `reconcile-core.ts`**。
- **不做语义 fuzzy / embedding / LLM 匹配**。
- 写格仍唯一走 `reconcile_tables` 写新表，**不改源表**（三条根骨之二）。
- 审计列只用 `__` 双下划线前缀（行级）；`_pack_audit` 是 Pack 层 run 级汇总（§B1.4），不在本核心范围。
- 缺省参数与现有 exact 行为完全一致：`matchMode` 缺省 `exact`、`keyNormalize` 缺省 `trim`、`auditColumns` 缺省非 exact 时 `true`。

## 验收

**核心（必达）**

- [ ] 后端 `pytest backend/tests` 全绿
- [ ] 前端 `npm run test:unit` + `npm run typecheck` 全绿
- [ ] exact 基线不回退：Gate 1b 干净 5/4 行 → `matched=2, left_only=3, right_only=2, conflict=0`
- [ ] dirty fixture（`dev-tools/gen_dirty_fixtures.py`）`matchMode: date_window, dateWindowDays: 7` → `matched ≥ exact + 3`（收回 3 行归因偏移 SKU-016/17/18）
- [ ] 归因偏移行输出 `__match_mode=date_window` 且 `__review=需复核`
- [ ] 单测覆盖：normalize（`trim_lower` 收尾空格/大小写）、date_window（±N 天、最小差、差相同 → conflict）、auditColumns 输出列、project 跳过 `__` 列

**Pack 层（§B1.4，可选 / Phase 1.5+，不阻塞核心合入）**

- [ ] 源表 `Pack_*` 零写入
- [ ] `_pack_audit.note` 含 `review_pending=` 计数

## 方案（design）

### 现状锚点

| 文件 | 关键位置 | 现状 |
|---|---|---|
| `addin/src/excel/reconcile-core.ts` | `normalizeKeyPart()` L31、`reconcile()` L62 | 只做 exact（trim 后相等）；无 matchMode/date_window/审计列 |
| `addin/src/excel/reconcile.ts` | `ReconcileTablesInput` L8、`reconcileTables()` L18 | 包装 core、写新表；无新参数 |
| `addin/src/services/skill-handlers.ts` | `case 'reconcile_tables'` L184 | 只解析 keys/compareColumns/outputSheet |
| `addin/skills/core/reconcile/manifest.json` | `tools[0].input_schema` | 无 matchMode 等新字段 |
| `addin/src/excel/recipe-project.ts` | `normalizeColumns()` L20 | project 列映射不跳过 `__` 列 |
| `addin/test/unit/reconcile-core.test.js` | — | 现有 exact 用例 |

### 1. `reconcile-core.ts`：匹配模式 + 决策树 + 审计列

按 backlog §B1.2 / §B1.3 实现：

- 扩 `ReconcileInput`：`matchMode?: "exact"|"normalize"|"date_window"`、`keyNormalize?: "trim"|"trim_lower"|"trim_collapse_ws"`、`dateWindowDays?: number`、`leftDateKey?: string`、`rightDateKey?: string`、`auditColumns?: boolean`
- `normalizeKeyPart(value, mode)` 支持 `trim` / `trim_lower` / `trim_collapse_ws`（只作用于键部分）
- 决策树（§B1.3，严格按此顺序）：
  1. **阶段 A** — 精确键匹配（compositeKey = `keyParts.join("\x1f")` 做 hash 配对，同键多行 conflict 与现逻辑一致）；已配对行标记 used
  2. **阶段 B** — 仅 `matchMode ∈ {normalize, date_window}` 时对键做 `keyNormalize` 后重复阶段 A（normalize 模式 = 步骤 1 用 trim_lower 等，仍一次 hash 配对）
  3. **阶段 C** — 仅 `matchMode = date_window` 且 `dateWindowDays = N`：对「阶段 A/B 后仍未配对」的行，按「除日期外的键部分」（已 normalize）分组，组内 left 日期与 right 日期差 ∈ [-N, +N] 天，**每组取最小日期差**配对（差相同 → conflict，不静默择优）
  4. 剩余 → `left_only` / `right_only`
- 输出追加三列（`auditColumns` 为 true 时）：
  - `__match_mode` ∈ `exact` / `date_window` / `left_only` / `right_only` / `conflict`（**无 fuzzy**）
  - `__match_score`：date_window 配对 = `1 - (|Δdays| / (N+1))`；exact = `1`
  - `__review`：`"auto"`（exact 且 score=1）/ `"需复核"`（date_window 配对或 conflict）
- 空键不参与匹配（现状已如此，保持）

### 2. `reconcile.ts`：透传新参数 + 审计列输出

`ReconcileTablesInput` 加同名字段，透传 `reconcileCore()`。`result.outputRows` 已含审计列，`writeToNewSheet` 前 null → ""（现状逻辑不动）。

### 3. `skill-handlers.ts` + `manifest.json`：新参数登记

- `case 'reconcile_tables'`：解析 `matchMode` / `keyNormalize` / `dateWindowDays` / `leftDateKey` / `rightDateKey` / `auditColumns`，透传 `E.reconcileTables()`
- `manifest.json` `input_schema.properties` 加对应字段（类型 + description）：
  - `matchMode` enum `["exact","normalize","date_window"]`
  - `keyNormalize` enum `["trim","trim_lower","trim_collapse_ws"]`
  - `dateWindowDays` number、`leftDateKey` string、`rightDateKey` string、`auditColumns` boolean

### 4. `recipe-project.ts`：project 默认跳过 `__` 列

`normalizeColumns()` 或调用处：`from` / `as` 为 `__` 前缀的列**默认不映射**到下游；要带走须显式 `columns[].from` 声明（backlog §0 规则）。

### 5. 测试

`addin/test/unit/reconcile-core.test.js` 新增：
1. normalize：`ABC-01 ` vs `abc-01` → `trim_lower` 匹配
2. date_window：归因偏移 3 行 ±7 天收回；差相同 → conflict
3. auditColumns：输出含 `__match_mode` / `__match_score` / `__review`，取值符合上表
4. project 跳过 `__` 列（recipe-project 单测或 reconcile 集成）
5. exact 基线断言不变（回归，防 backward 破坏）

### 6. Pack 层（可选，§B1.4）

`finance-reconciliation/SKILL.md` 第 3 步加可选 `matchMode: "date_window", dateWindowDays: 7`；`_pack_audit` run 级汇总 `review_pending=`。**不阻塞核心合入**，可另开小任务。

## Review notes

（待 coding 后填，只读不改代码）

## 进度 log

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| 2026-08-17 | design | Claude Code | `—` |
| 2026-08-17 | coding | Codex CLI | `dfdeb18` | B1 核心：matchMode 决策树（exact/normalize/date_window）+ `__match_mode/__match_score/__review` 审计列 + manifest/handler 透传 + recipe-project 跳过 `__` 列；单测 15 项全绿（前端 241 / 后端 121 / typecheck），dirty fixture 集成核验 SKU-016/17/18 收回（matched +10） | 从 backlog §B1 摘出 + 补现状锚点（reconcile-core.ts L31/L62、reconcile.ts L8/L18、handler L184、manifest、recipe-project L20） |
