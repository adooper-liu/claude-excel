# 任务：<简短标题>

> 复制本文件为 `docs/tasks/<任务名>.md`，作为 Claude Code × Cursor 的**唯一交接载体**。
> 禁止在聊天里互贴长方案/状态；另一方 `git pull` 后读此文件。

- **分支**：`feat/xxx` 或 `fix/xxx`
- **状态**：`design` | `coding` | `review` | `fix` | `done`
- **主责（当前阶段）**：Claude Code | Cursor | 人类

## 目标

（要达成什么，1–3 句）

## 边界 / 不做

（引用 `CLAUDE.md` 或 `docs/*.md`；明确不进核心、不写格路径等）

## 验收

- [ ] 后端 `pytest backend/tests` 全绿
- [ ] 前端 `npm run test:unit` + `npm run typecheck` 全绿
- [ ] （任务特有条目）

## 方案（Claude Code 填，design 阶段）

（架构决策、文件清单、步骤；必要时先改 `docs/` 再写代码）

## Review notes（Claude Code 填，review 阶段，只读不改代码）

（缺陷优先；每条对应文件/行号或 commit）

## 进度 log（谁改谁 append，一行一条）

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| YYYY-MM-DD | design | Claude Code | `abc1234` | 初稿 brief |
