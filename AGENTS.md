# AGENTS.md — 多工具协同约定（Claude Code × Cursor）

本仓库由 **Claude Code** 与 **Cursor** 两个 AI 工具共同维护。为避免重复劳动、目录混淆和提交冲突，所有工具（含人类开发者）开工前必须遵守本约定。

## 主目录与分支（单一真相）

- **主工作目录**：`D:\claude-excel`，分支 `master`。所有代码改动只发生在这里。
- `d:\claude-excel.worktrees\project-issue-analysis` 是**只读分析 worktree**，禁止在其内改代码。
- 跨工具协同**不用 worktree 隔离**（会互相看不到），用「分支 + 完成即合并 + 合并即同步」。

## 串行化规则（最重要）

> **同一时刻，只有一个工具在 master 上工作。**

一个工具开始改代码前，先确认 master 上没有另一个工具的进行中工作。用「私有分支 → 完成 → 合并 → 同步 → 弃用分支 → 下一任务从最新 master 再开」串行化，不靠记忆。

## 开工前必做（防重复）

```bash
git fetch
git status                # 有没有未提交改动
git log --oneline -5      # 最近提交，确认别人是否已做过
git branch -a             # 有没有进行中的分支
```

发现有进行中分支 / 未提交改动 → **先停下来对齐**，不另起炉灶。

## 分支（一个任务一条）

- 每个任务从最新 `master` 开 `feat/xxx` 或 `fix/xxx`；不在 master 上改代码（docs 单行链接除外）。
- 测绿 → 合入 master → push 后，**下一任务再从最新 master 开新分支**；不长期占用旧分支。
- **不是**「每个工具固定一条分支」并行长期占用；**是**每个任务一条分支，合完即结束。

## 工作时

- 在任务分支上改；改完自行验证：后端 `pytest backend/tests`、前端 `test:unit`、`typecheck` 全绿。

## 阶段分工（方案 → 代码 → 评审 → 修正）

| 阶段 | 主责 | 产出（落盘，不贴聊天） |
|---|---|---|
| 定方案 / 边界 | Claude Code | `docs/` 或 `docs/tasks/<任务>.md` |
| 写代码 / 补测试 | Cursor | 任务分支上的代码 + commit |
| 评审（**只读**） | Claude Code | `Review notes` 或 PR 评论 |
| 按评审修正 | Cursor | 同分支继续 commit，测绿后合 master |

**交接**：用 `docs/tasks/<任务>.md` + Git；聊天只传任务文件名、分支名、commit hash。**禁止**互贴长方案/状态。

完整阶段表见 [docs/coordination.md](docs/coordination.md) §3。

## 收尾

- **提交**：谁改谁提交，按仓库现有风格；多工具协作加 `Co-authored-by: <工具>`。
- **合并**：先 `git fetch` + `git log master..origin/master`；有新提交先 `git merge origin/master` 解决冲突再合。
- **push**：合并到 master 后 `git push origin master`。推之前确认无未提交改动 / 无进行中分支冲突。

## 一致性保证

- **单一真相文档**：`CLAUDE.md`（边界/纪律）、`docs/user-packs.md`、`docs/user-extensions-security.md`（架构决策）。改架构先改文档再改代码。
- **测试门禁**：任何改动合入 master 前全绿（CI 也会跑）。
- **版本同步**：picker `PICKER_VER`、manifest 版本等一处改动同步各处。

完整流程见 [docs/coordination.md](docs/coordination.md)。
