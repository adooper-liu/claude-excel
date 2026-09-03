---
status: coding          # design | coding | review | fix | blocked | done
branch: feat/gate-1b-h3-sensitivity
---

# 任务：H3 finance-sensitivity 工具白名单（P0 同构补齐）

> 源起：`docs/tasks/gate-1b-h3-sensitivity.md` Review notes 第 1 条（2026-09-03）——P0（`finance-reconciliation`）已收窄工具面，`finance-sensitivity`（`/业财敏感性`）仍走默认全量，`find_replace`/`web_fetch` 等无关工具对 H3 可见。同类"工具面不受控"，补齐保持同 Pack 一致。

## 交接指令（复制给 Cursor，不用手敲）

> `docs/tasks/finance-sensitivity-allowlist.md` · 实现并入 `feat/gate-1b-h3-sensitivity`（与 H3 一起合入 master，不合两次）

## 目标

在 `addin/src/services/tools-for-request.ts` 给 `skillId === "finance-sensitivity"` 加白名单分支，allow 集合 = H3 `finance-sensitivity/SKILL.md` 的**工具边界**（L11 明示 9 个）：`get_sheet_names` / `inspect_table` / `read_range` / `write_inputs` / `write_to_sheet` / `sort_filter` / `format_range` / `append_pack_audit` / `complete`。

## 边界 / 不做

- **不复制** P0 的 21 个工具集合——H3 不取数、不对账、不透视，不需要 `reconcile_tables` / `calculate_table` / `create_pivot` / `ensure_table` / `fill_range` / `data_validation` / `inspect_formulas` / `scan_formula_errors` / `read_selection` / `write_formula` / `write_to_range` 等
- **保留** `user.*` 前缀放行（与 P0 分支一致：`t.name.startsWith("user.") || allow.has(t.name)`）——user.* 走独立注册表 + 信任门，放行无害，且保持同一 Pack 内两个 skill 行为一致
- **不动** 其它分支与 `NATIVE_HINT` / `NATIVE_BLOCKED` / `nativeSkill`
- **不改** SKILL.md / brief（H3 文档已合基准）

## 验收

- [x] 前端 `npm run test:unit` 全绿（含新增 test case）
- [x] 前端 `npm run typecheck` 通过
- [x] `tools-for-request.test.js` 新增 ≥ 2 case：
  1. `skillId="finance-sensitivity"` + 任意 userText → 白名单**不含** `find_replace` / `web_fetch` / `reconcile_tables` / `calculate_table` / `create_pivot`
  2. `skillId="finance-sensitivity"` → 白名单**含** 9 个工具（`get_sheet_names` / `inspect_table` / `read_range` / `write_inputs` / `write_to_sheet` / `sort_filter` / `format_range` / `append_pack_audit` / `complete`）
- [x] 现有 case 全部仍绿（无回归）

## 方案

### 1. 改动文件

| 文件 | 改动 |
|---|---|
| `addin/src/services/tools-for-request.ts` | `finance-reconciliation` 分支后加 `finance-sensitivity` 分支（9 工具 allow + user.* 放行） |
| `addin/test/unit/tools-for-request.test.js` | 新增 2 case |

### 2. 分支骨架（参考 P0，最终实现以测试为准）

```typescript
if (skillId === "finance-sensitivity") {
  const allow = new Set([
    "get_sheet_names",   // 探路
    "inspect_table",     // 探路（利润表/假设表结构）
    "read_range",        // 读现状/逐档读净利
    "write_inputs",      // 临时改 B{x} + 立即还原（H3 核心）
    "write_to_sheet",    // 写 H3_敏感性_<参数> 矩阵
    "sort_filter",       // 临界行排序
    "format_range",      // 临界行标红
    "append_pack_audit", // 审计（note 场景摘要）
    "complete",          // 三段式结论
  ]);
  return tools.filter((t) => t.name.startsWith("user.") || allow.has(t.name));
}
```

### 3. 与 H3 SKILL.md 一致性

H3 SKILL.md L11「工具边界」正是这 9 个；白名单 = SKILL 明示的封闭集合（结构隔离），不额外放行编排未用的工具。

## 进度 log（谁改谁 append，一行一条）

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| 2026-09-03 | design | Claude Code | (本次提交) | 据 H3 review note 1 立项：9 工具白名单 + user.* 放行 |
| 2026-09-03 | coding | Claude Code | (本次提交) | 实现分支 + 2 test case（改动极小，不假手执行器） |