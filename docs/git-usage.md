# Git 标准操作指南

> **消费者**：在本仓库做任何 git 操作的人（人 / Claude / Codex / Cursor）。
> **何时读**：开工、提交、合并、救援时对照。
> **怎么用**：按操作类别查命令。
> **关系**：本文是「操作速查」——只写 git 命令与仓库约定；多工具协同的「为什么 / 谁 / 串行化」见 `docs/coordination.md`，脚本化封装见 `scripts/git-flow.sh`。同一事实不复制两处。

## 0. 铁律（本仓库强制）

- **串行化**：同一时刻只有一个工具在 master 上工作。
- **一条任务一条分支**（`feat/xxx` / `fix/xxx`），合入 master 后即删；下一任务从最新 master 再开。
- **不在 master 直接改代码**；合 master 用 fast-forward（`--ff-only`）。
- **合入前测试门禁**：后端 `pytest` + 前端 `test:unit` + `typecheck` 全绿。
- 推 master 前确认：无未提交改动、无进行中分支冲突。

## 1. 开工前检查（防重复）

```bash
git fetch
git status            # 有没有未提交改动
git log --oneline -5  # 最近提交，确认别人是否已做过
git branch -a         # 有没有进行中分支
```

发现进行中分支 / 未提交改动 → **先停下来对齐**，不另起炉灶。
脚本：`./scripts/git-flow.sh check`

## 2. 分支生命周期（一条任务一条）

```bash
# 开新任务分支（从最新 master）
git checkout master && git pull
git checkout -b feat/<任务名>
# 脚本：./scripts/git-flow.sh start <任务名>

# 把最新 origin/master 合进当前任务分支（合并前防冲突）
git fetch
git merge origin/master
# 脚本：./scripts/git-flow.sh update
```

## 3. 日常提交

- **谁改谁提交**；commit message 用仓库现有风格：`feat:` / `fix:` / `docs:` / `chore:` / `revert:` + 中文简述。
- **只 add 本次任务相关文件**，不要 `git add .` 一把梭（会把无关文件卷进去）。
- 多工具协作可加 `Co-authored-by: <工具>`。

```bash
git add <file>...
git commit -m "feat(backup): 描述"
```

- 提交写错、还没 push：`git commit --amend` 改写。

## 4. 合入 master

```bash
git checkout master && git pull
git merge --ff-only feat/<任务名>   # 非 ff 则先回任务分支 merge origin/master 解决冲突
git push origin master
git branch -d feat/<任务名>         # 本地删；远端 git push origin --delete feat/<任务名>
# 脚本：./scripts/git-flow.sh finish --test（合入 + push + 删分支 + 跑测试门禁）
```

**ff-only 失败时**：

```bash
git checkout feat/<任务名>
git merge origin/master   # 解决冲突后提交
# 再回 master 合
```

## 5. 救援 / 撤销

| 场景 | 命令 |
| --- | --- |
| 放弃某文件的工作区改动 | `git checkout -- <file>` |
| 暂存手头改动再切走 | `git stash` → 回来 `git stash pop` |
| 误提交（未 push），保留改动 | `git reset --soft HEAD~1` |
| 误提交（未 push），直接丢弃 | `git reset --hard HEAD~1` |
| 已 push 的错误提交，回滚 | `git revert <commit>`（新增撤销提交，不改历史） |
| 找回被删的分支 | `git reflog` 找 commit → `git checkout -b <name> <commit>` |

## 6. 常见坑（本仓库实测）

- Windows 下 Git 报 `LF will be replaced by CRLF`：正常警告，不用处理。
- `git add -A` 会把无关 untracked 文件卷进提交——提交前 `git status` 检查。
- 别在 Codex / Cursor 正在跑同一分支时动工作区（串行化）。
- `git-flow.sh` / `codex-execute-latest-plan.sh` 需要 Git Bash；Windows 双击版用同名 `.bat`。

## 7. 速查表（脚本入口）

| 要做的事 | 命令 |
| --- | --- |
| 开工前检查（git + 环境） | `./scripts/git-flow.sh check` |
| 环境自检 | `./scripts/git-flow.sh env` |
| 任务状态扫描 | `./scripts/git-flow.sh status` |
| 开任务分支 | `./scripts/git-flow.sh start <名字>` |
| 同步 master | `./scripts/git-flow.sh sync` |
| 合最新 master 进当前分支 | `./scripts/git-flow.sh update` |
| 推送任务分支到 origin | `./scripts/git-flow.sh push-branch` |
| 合入 master + push + 删分支 | `./scripts/git-flow.sh finish --test` |
