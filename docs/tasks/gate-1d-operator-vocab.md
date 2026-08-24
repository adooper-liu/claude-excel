# 任务：Gate 1d — 算子词汇扩展（编排减负）

## 交接指令

> `docs/tasks/gate-1d-operator-vocab.md` · `feat/gate-1d-operator-vocab`

- **分支**：`feat/gate-1d-operator-vocab`
- **状态**：`review`（实现完成，单测/typecheck 绿；待手工验收与合入）
- **主责（当前阶段）**：Cursor 实现

## 目标

扩展算子词汇：`sumifs` 多条件/多分组、`arithmetic`、`conditional_column`、`reshape flatten_reconcile`。

## 验收

- [x] `npm run test:unit` + `npm run typecheck` 全绿（实现中验证）
- [x] 现有 sumifs / lookup 金样不回退
- [x] 四能力各 ≥2 单测
- [ ] 手工：flatten_reconcile → 再 reconcile
- [ ] 手工：arithmetic 净利列活公式

## 进度 log

| 日期 | 说明 |
|---|---|
| 2026-08-24 | brief 落盘；状态 ready |
| 2026-08-24 | 实现核心 + 接线 + 单测；`test:unit` 279 绿 + typecheck；顺带修 `/计算器` 被 isSetupRequest「生成」短路 |
