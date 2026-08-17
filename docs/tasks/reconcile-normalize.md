# 任务：对账 normalize + date_window（B1，不含 fuzzy）

## 交接指令（复制给 Cursor，不用手敲）

> `docs/tasks/reconcile-normalize.md` · `feat/reconcile-normalize`

```bash
git checkout master && git pull && git checkout -b feat/reconcile-normalize
```

> 本 brief 是 Claude Code × Cursor 的**唯一交接载体**。上游方案见 [`docs/tasks/post-gate-1b-capability-backlog.md`](post-gate-1b-capability-backlog.md) §B1；本文件从 §B1 摘出并补现状锚点（文件/行号/函数）。禁止在聊天里互贴长方案/状态。

- **分支**：`feat/reconcile-normalize`
- **状态**：`review`
- **主责（当前阶段）**：Claude Code（review，只读）

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

**结论：核心逻辑正确，无阻塞缺陷，可合入。** 以下按严重程度排序，均为非阻塞项。

1. **[中] `leftDateKey ≠ rightDateKey` 异名日期列不可用** — `reconcile-core.ts` L368 通用 key 校验要求所有 `keys` 在两表都存在，跨表异名日期列（订单 `order_date` vs 广告 `ad_date`）会在此抛错。实际业务由 connector 归一为同名 `biz_date`（`connector/feeds/orders.schema.json` / `ads.schema.json` 均产出 `biz_date` join 键），故不阻塞；但 manifest/backlog 写「leftDateKey + rightDateKey」暗示可异名，与实现不符。建议：文档明确「日期列须同名（connector 已归一为 biz_date）」，或后续放宽 L368 校验。

2. **[低] normalize 匹配的 `__match_mode` 标 `exact`** — `reconcile-core.ts` L186 `matchMode: "exact"` 覆盖了 Stage B（trim_lower/trim_collapse_ws）匹配行；因 `MatchLabel` 枚举无 `normalize`（backlog §B1.3 亦无），属有意取舍（测试 L136 断言）。语义上「归一后匹配」标 exact 略误导，建议未来加 `normalize` 标签。

3. **[低] date_window 配对 + compareColumns 冲突 → `__match_mode="conflict"`** — `reconcile-core.ts` L351，date_window 配对成功但值冲突时 matchMode 标 `conflict`（非 `date_window`），丢失「经日期窗口配上」的信息。非静默择优（status 仍 conflict），正确性无影响。

4. **[低] recipe-project 对 `__` 列是「无条件跳过」** — `recipe-project.ts` `isReservedAuditColumn` 对 `as`/`from` 均跳过，用户无法用显式 `columns[].from` 带走审计列；backlog §0 写「默认不映射，显式 from 可带走」。当前实现更严格（完全禁止），比 backlog 更安全，但偏离原意。可接受，或后续补显式覆盖通道。

5. **[极低] `dateToDay` 非标准日期字符串走 `Date.parse`（本地时区）** — `reconcile-core.ts` L103；标准 `YYYY-MM-DD`/`YYYY/M/D` 走 `Date.UTC`（L95-101）无时区问题，业务由 connector 归一 ISO date，基本不触发。

**已确认正确（抽查）：** exact 向后兼容（输出 headers 无审计列、行序不变，测试 L96 回归）；Stage A(trim)→B(keyNormalize)→C(date_window) 决策树顺序符合 backlog §B1.3；tie 最小差 → conflict 不静默择优（测试 L218）；auditColumns 默认 `matchMode !== "exact"`（L377）；handler/manifest 参数解析与 core 一致；recipe-project LF 归一（185 行换行，真实改动 8+/3-，已用 `--ignore-space-at-eol` 核对）。

## 进度 log

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| 2026-08-17 | design | Claude Code | `—` | 从 backlog §B1 摘出 + 补现状锚点（reconcile-core.ts L31/L62、reconcile.ts L8/L18、handler L184、manifest、recipe-project L20） |
| 2026-08-17 | coding | Codex CLI | `dfdeb18` | B1 核心：matchMode 决策树（exact/normalize/date_window）+ `__match_mode/__match_score/__review` 审计列 + manifest/handler 透传 + recipe-project 跳过 `__` 列；单测 15 项全绿（前端 241 / 后端 121 / typecheck），dirty fixture 集成核验 SKU-016/17/18 收回（matched +10） |
| 2026-08-17 | review | Claude Code | `—` | 只读 review：无阻塞缺陷；5 条非阻塞 note（异名日期列不支持 / normalize 标 exact / date_window 冲突标 conflict / project 无条件跳过 __ / dateToDay 时区） |
