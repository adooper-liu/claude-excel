# 任务：Gate 1e — 分析能力扩展（多维 + 复合键 + 标记）

## 交接指令

> `docs/tasks/gate-1e-analysis-ops.md` · `feat/gate-1e-analysis-ops`

```bash
git checkout master && git pull && git checkout -b feat/gate-1e-analysis-ops
```

> **依赖**：建议 Gate 1d（`sumifs_multi` / 多条件公式生成器）已合 master，以便 `cross_tab` 复用 SUMIFS 生成。若并行，须先抽出共享 `sumifsFormulaN`。  
> 本 brief 是唯一交接载体。上游：[`gate-1d-operator-vocab.md`](gate-1d-operator-vocab.md)、[`post-gate-1b-capability-backlog.md`](post-gate-1b-capability-backlog.md) §Gate 1d/1e。

- **分支**：`feat/gate-1e-analysis-ops`
- **状态**：`blocked`（等 1d，或明确并行共享公式生成器后再改 `ready`）
- **主责（当前阶段）**：未开工

## 目标

补齐「多维动态汇总 / 复合键查找 / 行级条件标记」，仍全部生成为 **Excel 活公式或确定性标记列**，不经模型算数。

| 算子 | 落点 | 作用 |
|---|---|---|
| `cross_tab` | `calculate-core.ts`（或独立 `cross-tab-core.ts`） | 行×列交叉表，格内 SUMIFS/COUNTIFS/AVERAGEIFS 公式 |
| `lookup_multi` | `calculate-core.ts` | 复合键 INDEX/MATCH（或 XLOOKUP 等价、Office 版本需约定） |
| `flag_rows` | `calculate-core.ts` 或 reshape | 多条件 → `__flag` / 审计列（与 reconcile `__review` 同构） |

## 边界 / 不做

- **不做** 通用循环、脚本引擎、VBA。
- **不做** 替代 `create_pivot`：pivot 仍服务「快速切片 UI」；`cross_tab` 服务「要活公式联动假设/源表」的场景。
- **不做** 模糊匹配进核心。
- `cross_tab` 的行头/列头唯一值必须 **Office JS 本地抽取**，禁止把维值列表送进模型。
- 超大交叉（行唯一×列唯一格数）设硬上限（建议默认 ≤ 2e5 格，与 reshape 量级纪律对齐），超出拒绝并提示改用透视。

## 方案（实现要点）

### 1. `cross_tab`

- 入参：`tableName`、`rowField`、`columnField`、`valueField`、`aggregation: sum|count|average`。
- 步骤：读唯一行维、唯一列维（排序稳定）→ 写表头 → 每格写 `SUMIFS`/`COUNTIFS`/`AVERAGEIFS`（复用 1d 多条件生成器）。
- 输出：新 sheet；改源表后交叉表重算。
- 单测：2×3 维金样公式字符串；超限拒绝。

### 2. `lookup_multi`

- 入参：多键列数组 + 返回列；实现可用辅助列拼接键（写在结果表或隐藏列），或 `MATCH` 多条件数组公式（兼容性写进 brief：优先「结果表辅助键列 + INDEX/MATCH」，避免旧 Excel 动态数组差异）。
- 单测：两键命中 / 未命中。

### 3. `flag_rows`

- 入参：`rules: Array<{ column, operator, value }>`，`flagValue` 默认 `"需复核"`，输出列名默认 `__flag`。
- 语义：行满足**任一**规则则标记（OR）；若需 AND，用单条 rule 组或后续扩展 `match: all|any`（默认 `any`）。
- 只写新列或新表；不删源列。
- 单测：两规则 OR；无命中空标记。

## 验收

- [ ] 1d 相关金样不回退
- [ ] `test:unit` + `typecheck` 全绿
- [ ] `cross_tab` 手工：改源 value 列 → 交叉表格变化
- [ ] `flag_rows` 与 `sort_filter` 可组合（先标记再筛）不互相破坏

## 预估

约 150–250 行 TS + 单测。

## Review notes

（空）

## 进度 log

| 日期 | 说明 |
|---|---|
| 2026-08-24 | brief 落盘；blocked on 1d |
