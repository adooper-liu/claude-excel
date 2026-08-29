# plan 生命周期 + 交接机制优化（2026-08-28）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复二段协同交接链的两个实测缺陷——(1) `codex-execute-latest-plan.sh` 靠 `ls -t | head -1`（mtime）拾取 plan，会把**已完成/已合入**的旧 plan 当最新重跑（本次实测：`review-fix-venv.md`(18:02) 盖过待执行的 `install-bat-npm.md`(17:58)）；(2) 交接前靠人工清点工作区/plan 状态，漫不经心就撞 `git status` 非空挡。优化 = 给 `docs/superpowers/plans/*.md` 加机器可读 frontmatter `status`（复用既有 `docs/tasks/` 的机制与 `git-flow.sh status` 的 awk 解析），交接脚本**按 status=pending 而非 mtime 拾取**，并输出交接前阻塞清单。另补两条 plan 写作约定（可断言验收锚点、真机验收归位）。

**Architecture:** 复用仓库既有机制——`docs/tasks/*.md` 已有 frontmatter `status` + `git-flow.sh status` 用 awk 读 `status:` 字段（`scripts/git-flow.sh:144`）。本改进把**同一约定**扩展到 `docs/superpowers/plans/*.md`，改 `codex-execute-latest-plan.sh` 的拾取逻辑（`status: pending` 优先，无 pending 时才回落 mtime 并告警），不新造解析器。

**Context / 已核实事实（不要重测）：**
- `scripts/codex-execute-latest-plan.sh` 现逻辑：分支自检 → `git status --porcelain` 非空即 exit 1 → `PLAN_FILE="$(ls -t "$PLANS_DIR"/*.md 2>/dev/null | head -1)"` → 注入 prompt 给 `codex exec`。
- `scripts/codex-execute-latest-plan.bat` 只是 .sh 的 Git Bash 包装，不改。
- `docs/superpowers/plans/` 现有 8 个 plan，均无 frontmatter。
- `scripts/git-flow.sh` 的 status 已解析 `docs/tasks/*.md` 的 `status:`；本次把 plans/ 也纳入其扫描（或至少交接脚本内联同样的 awk）。
- 仓库纪律（CLAUDE.md / coordination.md）：单一真相、机器可校验状态、每个任务一条分支、交接前工作区干净。
- 本次实测事故：mtime 最新 (`review-fix-venv.md` 18:02) ≠ 实际待执行 (`install-bat-npm.md` 17:58)。

## Global Constraints

- **只改交接链**：`scripts/codex-execute-latest-plan.sh` + `docs/superpowers/plans/` 下 plan 文件加 frontmatter + （可选）`scripts/git-flow.sh` 的 status 纳入 plans/。**不动** `backend/`、`addin/`、`scripts/service/`、`config_store.py`、`server.py`、plan 的正文实现内容。
- **复用既有解析方式**：frontmatter 解析用同一 awk 写法（`scripts/git-flow.sh:144`），不另造。status 取值沿用既有枚举语义（`pending` / `in-progress` / `done` / `merged`；brief 用 `in-progress`/`done`，plan 用 `pending`/`in-progress`/`done`）。
- **向后兼容**：无 frontmatter 的旧 plan 仍可被拾取（回落 mtime + 告警提示"缺 status，建议补"），**不强制迁移全部旧文件**（coordination.md 对旧 brief 的处理精神：读不到不报错、不强制）。
- **拾取规则优先级**：`status: pending` 的 plan 优先于 mtime；**有多个 pending 时报错列出、让人定（串行化）**；无 pending 才回落 mtime 最新并告警。
- **阻塞清单**：交接脚本在 exit 1 前，把「工作区未提交项 / 存在多个 pending plan / 当前分支非任务分支 / 无 status 的旧 plan 数」一次性列出，不再只给一句通用报错。
- **验收锚点约定（写进 plan 写作规范，不强制脚本）**：每个 Task 的「Expected」尽量写可跑命令+期望退出码/输出特征（如 `rg` 断言为空、`pytest` 2/2），少用自然语言。
- **真机验收归位约定（写进 plan 写作规范）**：管理员/真机才能验的步骤（装服务、杀进程、Windows 服务自愈）单独列在 plan 尾部「真机验收（管理员，不代跑）」段，明确标出沙箱/普通权限验不到，禁止 Codex 假装验过。

---

### Task 1: plans/ 加 frontmatter status + 交接脚本按 status 拾取

**Files:**
- Modify: `scripts/codex-execute-latest-plan.sh`（拾取逻辑 + 阻塞清单）
- Modify: 现有 8 个 `docs/superpowers/plans/*.md` 加 frontmatter（每个文件首行前插入 `---\nstatus: <值>\n---\n`，正文不动）

**Interfaces:**
- Produces: 机器可读 plan 队列（pending = 待执行）。交接脚本第一次就能拿到"该执行哪个"。
- Consumes: `ls` / `awk`（既有解析）。

**现状缺陷：**
- `PLAN_FILE="$(ls -t ... | head -1)"`（脚本 L35）——mtime 会被任何写/checkout 干扰，实测盖错。
- 脚本 exit 1 只给一句通用报错，不给"为什么挡"的具体清单。

- [ ] **Step 1: 给 8 个现有 plan 加 frontmatter**（正文首行前插入三行；值按各 plan 实际状态）：
  - `2026-08-26-service-deployment.md` → `status: done`（已实现已合 master）
  - `2026-08-26-export-import-backup.md` → `status: done`
  - `2026-08-25-fix-backend-url-ipv4.md` → `status: done`
  - `2026-08-17-third-party-pack-market.md` → `status: done`
  - `2026-08-28-service-deployment-review-fix.md` → `status: done`（已合 master，merge 265669a）
  - `2026-08-28-service-deployment-review-fix-venv.md` → `status: done`（已合 master，merge 008c516）
  - `2026-08-28-service-deployment-install-bat-npm.md` → `status: pending`（待执行）
  - `2026-08-28-service-deployment-review-fix-venv-seed.md` → `status: pending`（待执行）
  - 注意：这两个 pending 的**先后**由人定义——seed 修正应先于 install-bat npm；但按「串行化」拾取一次只给一个，人的职责是先只留一个 pending 再交接。**本 plan 只把 `install-bat-npm` 标 pending、`venv-seed` 标 pending 但交接顺序由你在交接前按需调整（或本 plan 执行后由交接脚本报「多个 pending」让你定）。**
- [ ] **Step 2: 改交接脚本拾取逻辑**（替换 `PLAN_FILE="$(ls -t ... | head -1)"` 段）：

```bash
# --- 找待执行的 plan（status: pending 优先；无则回落 mtime 并告警） ---
PLANS_DIR="${PLANS_DIR:-$REPO_ROOT/docs/superpowers/plans}"
# 复用 git-flow.sh status 的 awk 解析（scripts/git-flow.sh:144）
plan_status() { awk 'BEGIN{n=0} /^---[[:space:]]*$/{n++; next} n==1 && /^status:[[:space:]]*/{sub(/^status:[[:space:]]*/,""); sub(/[[:space:]]*$/,""); print; exit}' "$1"; }
PENDING_COUNT=0
PENDING_FILES=""
for f in "$PLANS_DIR"/*.md; do
  st="$(plan_status "$f")"
  if [ "$st" = "pending" ]; then PENDING_COUNT=$((PENDING_COUNT+1)); PENDING_FILES="$PENDING_FILES"$'\n'"$(basename "$f")"; fi
done
if [ "$PENDING_COUNT" -eq 1 ]; then
  PLAN_FILE="$(echo "$PENDING_FILES" | sed 's/^/'"$PLANS_DIR"'\//' | sed -n '2p')"   # 单 pending → 唯一待执行
elif [ "$PENDING_COUNT" -gt 1 ]; then
  echo "⚠️ 存在 $PENDING_COUNT 个 pending plan（串行化）：$PENDING_FILES" >&2
  echo "   二段协同要求同一时刻只有 1 个 pending。先把非当前的标 done，再跑本脚本。" >&2
  exit 1
else
  PLAN_FILE="$(ls -t "$PLANS_DIR"/*.md | head -1)"   # 无 pending：回落 mtime + 告警
  echo "⚠️ 无 pending plan，回落 mtime 最新（$(basename "$PLAN_FILE")）。建议给待执行 plan 标 status: pending。" >&2
fi
```

  （若单 pending 取文件路径的写法更简洁：确认只有一个后 `PLAN_FILE=$(ls -d "$PLANS_DIR"/*.md | while read f; do [ "$(plan_status "$f")" = pending ] && echo "$f"; done)`。实现取清晰可读者。）

- [ ] **Step 3: 阻塞清单**（在**第一个** `exit 1` 前——现状 L21 `工作区有未提交改动` 是第一个挡点——先聚合输出）：

```bash
# --- 交接前阻塞清单（聚合输出，不再只给一句） ---
BLOCKERS=""
if [ "$BRANCH" = "master" ] && [ "${ALLOW_MASTER:-0}" != "1" ]; then BLOCKERS="$BLOCKERS"$'\n'"- 当前在 master（需 ALLOW_MASTER=1 或任务分支）"; fi
DIRTY="$(git status --porcelain | head -20)"
if [ -n "$DIRTY" ]; then BLOCKERS="$BLOCKERS"$'\n'"- 工作区未提交项（$? 项）："; BLOCKERS="$BLOCKERS"$'\n'"$DIRTY"; fi
NOSTATUS="$(for f in "$PLANS_DIR"/*.md; do [ -z "$(plan_status "$f")" ] && echo "  - $(basename "$f")"; done)"
if [ -n "$NOSTATUS" ]; then BLOCKERS="$BLOCKERS"$'\n'"- 无 status 的旧 plan：$NOSTATUS"; fi
if [ -n "$BLOCKERS" ]; then echo "🚫 交接阻塞：$BLOCKERS" >&2; exit 1; fi
```

- [ ] **Step 4: 语法自检** — `bash -n scripts/codex-execute-latest-plan.sh` → 无输出（exit 0）。
- [ ] **Step 5: 验证** — 在 `feat/` 分支、工作区干净、只有一个 pending 时跑 `./scripts/codex-execute-latest-plan.sh`，前段应输出「❌ 无 pending？……」的分支确认/正确拾取单个 pending；故意造脏工作区（`echo x > /tmp/x` 后 `git status` 有项）应输出阻塞清单而非一句报错。
- [ ] **Step 6: 提交** —
  `git add scripts/codex-execute-latest-plan.sh docs/superpowers/plans/*.md && git commit -m "feat(plans): plan 生命周期 frontmatter status + 交接脚本按 pending 拾取 + 阻塞清单"`

---

### Task 2: 交接脚本结尾注入 plan 写作两约定（可断言锚点 / 真机归位）

**Files:**
- Modify: `scripts/codex-execute-latest-plan.sh`（注入 prompt 段加约定；不是硬校验）

**Interfaces:**
- Produces: Codex 每次执行都收到"计划写作约定"提示，落进 `docs/superpowers/plans/` 后续计划。
- Consumes: 无。

**现状缺陷：** plan 的「Expected」常是自然语言（"看日志应出现…"），Codex 是否做到只能人眼；真机项（管理员装服务/杀进程/自愈）混在普通 Task 里，Codex 在沙箱没权限却可能假装已验证。这两点是 review 成本高的主因。

- [ ] **Step 1: 在注入 prompt 的「本仓库协同纪律」段后追加**：

```text
计划写作约定（改 plan 文档时遵守）：
- 每个 Task 的验证步骤写「可跑命令 + 期望退出码/输出特征」（如 rg 断言为空、命令 exit 0），少用「应看到 X」这类自然语言。
- 管理员/真机才能验的步骤（装 Windows 服务、杀进程、服务自愈、sc.exe 查询）单独列在 plan 尾部「真机验收（管理员，不代跑）」段，明确标注沙箱验不到；没权限的步骤禁止声称已验证，只写「待真机验收」。
- plan 加 frontmatter status：待执行=pending、执行中=in-progress、完成待合=done；一次只允许 1 个 pending。
```

- [ ] **Step 2: 语法自检** — `bash -n scripts/codex-execute-latest-plan.sh` → 无输出。
- [ ] **Step 3: 提交** —
  `git add scripts/codex-execute-latest-plan.sh && git commit -m "feat(plans): 交接注入 plan 写作约定（可断言锚点/真机归位/status）"`

---

## 收尾

1. `bash -n scripts/codex-execute-latest-plan.sh` → exit 0。
2. `rg "status:" docs/superpowers/plans/*.md | head` → 8 个 plan 全有 frontmatter。
3. 手动验证（分支 + 干净 + 单 pending）：`./scripts/codex-execute-latest-plan.sh` 应拾取那个 pending；造脏工作区应输出阻塞清单。
4. 回写本优化依赖的旧 plan 状态已在 Task1 done（`review-fix-venv.md`、`review-fix.md` 等标 done），避免下次交接时被当 pending 重跑。
5. 全部通过后：按 `docs/coordination.md`，实现完成，review 交回 Claude 对照本 plan 逐粒核对。