# 多工具协同方案（Claude Code × Cursor）

> 目的：两个 AI 工具 + 人类开发者共同维护本仓库时，**不冲突、不重复、一致**。
> 摘要见根目录 [AGENTS.md](../AGENTS.md)；本文是完整版。

---

## 1. 为什么需要（已发生的两个坑）

| 坑 | 根因 | 本方案怎么防 |
|---|---|---|
| 曾在 `project-issue-analysis` worktree 查代码，而改动在 `D:\claude-excel` | 对「主目录」无共识 | §2 固定主目录，禁止在 worktree 改代码 |
| `9c4e7f3` 那批修复已存在，差点重复提交 | 两边同时改同一批文件、未同步 | §4 开工前 fetch+log；§5 分支隔离 |

## 2. 主目录与分支（单一真相）

- **主工作目录**：`D:\claude-excel`，分支 `master`。所有代码改动只发生在这里。
- **只读分析 worktree**：`d:\claude-excel.worktrees\project-issue-analysis`，只读分析、不改代码。
- 本机多开 Claude Code 会话：可用 worktree 隔离。
- 跨工具（Claude/Cursor）：**不用 worktree**（互相看不到），用「分支 + 完成即合并 + 合并即同步」。

## 3. 任务分工建议（避免重复劳动）

| 任务类型 | 建议工具 | 理由 |
|---|---|---|
| 纯代码重构 / 批量改 / 测试驱动 | Cursor | 多文件机械改动，Cursor 顺手 |
| 架构设计 / 安全评审 / 跨模块边界 | Claude Code | 长上下文、多轮核对、要「拒绝 AI 虚幻」的判断 |
| 测试验证 / 提交 / push | 任一，但**必须先同步** | 见 §4 |

## 4. 操作规范（强制，两边都遵守）

### 开工前（防重复）

```bash
git fetch
git status                        # 有没有未提交改动
git log --oneline -5              # 最近提交，确认别人是否已做过
git branch -a                     # 有没有进行中的分支
```

- 发现有进行中分支 / 未提交改动 → **先停下来对齐**，不另起炉灶。

### 工作时

- 在**私有分支**上改（`feat/xxx` / `fix/xxx`），不在 master 直接改。
- 改完自行验证：`python -m pytest backend/tests`（Windows 上若遇 temp PermissionError，加 `--basetemp=...`）+ `npm run test:unit` + `npm run typecheck` 全绿。

### 收尾（提交 → 合并 → 推送）

1. **提交**：谁改谁提交，按仓库现有风格；多工具协作加 `Co-authored-by: <工具>`。
2. **合并**：先 `git fetch` + `git log master..origin/master`；有新提交先 `git merge origin/master` 解决冲突再合。
3. **push**：合并到 master 后 `git push origin master`。推之前确认无未提交改动 / 无进行中分支冲突。

### 串行化规则（最重要）

> **同一时刻，只有一个工具在 master 上工作。**

一个工具开始改代码前，先确认 master 上没有另一个工具的进行中工作。用「私有分支 → 完成 → 合并 → 同步」串行化，不靠记忆。

## 5. 一致性保证

| 机制 | 内容 |
|---|---|
| **单一真相文档** | `CLAUDE.md`（边界/纪律）+ `docs/user-packs.md` / `user-extensions-security.md`（架构决策） |
| **测试门禁** | 任何改动合入 master 前：后端 `pytest` + 前端 `test:unit` + `typecheck` 全绿（CI 也会跑） |
| **版本同步** | picker `PICKER_VER`、manifest 版本等一处改动同步各处（0.4.4→0.4.9 那类曾漏改） |

## 6. 落地

- 摘要：根目录 `AGENTS.md`（主目录/串行化/测试门禁），两边启动可见。
- 完整版：本文 `docs/coordination.md`。
- 改架构：先改文档再改代码（`CLAUDE.md` 与 docs 是单一真相）。
