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
- **一个任务一条分支**：合入 master 后弃用/删除该分支；下一任务从最新 master 再开（不是每个工具长期占一条分支）。

## 3. 阶段分工（方案 → 代码 → 评审 → 修正）

默认**串行**：定方案 → 写代码 → 评审（只读）→ 修正 → 合 master → 下一任务。

| 阶段 | 主责 | 辅责 | 产出（落盘，不贴聊天） |
|---|---|---|---|
| **1. 定方案 / 边界** | Claude Code | 人类拍板 | `docs/*.md`、`CLAUDE.md` 补丁；[任务 brief 模板](tasks/_template.md)（目标、边界、验收） |
| **2. 写代码 / 补测试** | Cursor | — | 任务分支上的代码 + 测试；commit message 对应 brief 条目 |
| **3. 评审（只读）** | Claude Code | — | brief 内 **Review notes**，或 PR 评论；**不改代码** |
| **4. 按评审修正** | Cursor | Claude 只读确认 | 同分支继续 commit；测绿后合 master |
| **5. 合入 / push** | 完成阶段 4 的一方 | 另一方先 `git fetch` | merge 到 `master` |

同一任务**不要** Claude 与 Cursor 同时在同一分支改代码。评审阶段 Claude **只读**。

### 各工具默认擅长

| 任务类型 | 建议工具 | 理由 |
|---|---|---|
| 架构 / Pack 边界 / `user.*` 安全 / 写 docs | Claude Code | 长上下文、边界核对、拒绝 AI 虚幻 |
| 多文件实现 / 重构 / 补单测 / 跑 CI | Cursor | 机械改动、测试驱动顺手 |
| 口径拍板 / 是否合 master | 人类 | 最终决策 |

### 交接规则（禁止聊天复制粘贴）

| ❌ 不要 | ✅ 要 |
|---|---|
| 把 Claude 长回复贴给 Cursor | 方案写进 `docs/tasks/<任务>.md`，commit 后 `git pull` 读文件 |
| 两边各自复述「当前状态」 | `git log` + `git status` + brief 内 **进度 log** |
| 「按上次说的做」 | brief 里写清目标 / 边界 / 验收 / 当前 **状态** 字段 |

**聊天只传三样：** 任务文件名（如 `docs/tasks/p1-user-runner.md`）、分支名、commit hash。

任务 brief 模板：[docs/tasks/_template.md](tasks/_template.md)

## 4. 操作规范（强制，两边都遵守）

### 开工前（防重复）

```bash
git fetch
git status                        # 有没有未提交改动
git log --oneline -5              # 最近提交，确认别人是否已做过
git branch -a                     # 有没有进行中的分支
```

- 发现有进行中分支 / 未提交改动 → **先停下来对齐**，不另起炉灶。

### 分支生命周期（一个任务一条）

> 私有分支 → 完成 → 合并 → 同步 → 弃用/删除分支 → 下一任务从最新 master 再开

**不是**「Claude 固定一条分支、Cursor 固定一条分支」并行长期占用；**是**每个任务一条分支，合完即结束。

```bash
# 新任务开工
git fetch
git checkout master && git pull
git checkout -b feat/任务名

# ... 改代码、测绿、commit；可选 push 分支到 origin ...

# 合入 master
git checkout master && git pull
git merge --ff-only feat/任务名    # 有冲突则先 rebase/merge origin/master 再合
git push origin master
git branch -d feat/任务名          # 本地删除；远端分支按需 git push origin --delete
```

### 工作时

- 在任务分支上改（`feat/xxx` / `fix/xxx`），不在 master 直接改。
- 改完自行验证：`python -m pytest backend/tests`（Windows 上若遇 temp PermissionError，加 `--basetemp=...`）+ `npm run test:unit` + `npm run typecheck` 全绿。

### 收尾（提交 → 合并 → 推送）

1. **提交**：谁改谁提交，按仓库现有风格；多工具协作加 `Co-authored-by: <工具>`。
2. **合并**：先 `git fetch` + `git log master..origin/master`；有新提交先 `git merge origin/master` 解决冲突再合。
3. **push**：合并到 master 后 `git push origin master`。推之前确认无未提交改动 / 无进行中分支冲突。

### 串行化规则（最重要）

> **同一时刻，只有一个工具在 master 上工作。**

一个工具开始改代码前，先确认 master 上没有另一个工具的进行中工作。用「私有分支 → 完成 → 合并 → 同步 → 弃用分支 → 下一任务从最新 master 再开」串行化，不靠记忆。

## 5. 一致性保证

| 机制 | 内容 |
|---|---|
| **单一真相文档** | `CLAUDE.md`（边界/纪律）+ `docs/user-packs.md` / `user-extensions-security.md`（架构决策） |
| **测试门禁** | 任何改动合入 master 前：后端 `pytest` + 前端 `test:unit` + `typecheck` 全绿（CI 也会跑） |
| **版本同步** | picker `PICKER_VER`、manifest 版本等一处改动同步各处（0.4.4→0.4.9 那类曾漏改） |

## 6. 落地

- 摘要：根目录 `AGENTS.md`（主目录/串行化/阶段分工/测试门禁），两边启动可见。
- 完整版：本文 `docs/coordination.md`。
- 任务 brief：`docs/tasks/_template.md`（每个任务复制一份，作交接唯一载体）。
- 改架构：先改文档再改代码（`CLAUDE.md` 与 docs 是单一真相）。
