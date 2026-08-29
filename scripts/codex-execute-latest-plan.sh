#!/bin/bash
# codex-execute-latest-plan.sh
# 分两段工作流（方案二：Git 当桥，不贴聊天）：
#   分支自检 → 找最新 superpowers plan → 注入 codex exec 执行。
# 用法（Git Bash，任务分支上）：
#   ./scripts/codex-execute-latest-plan.sh
# 可选：ALLOW_MASTER=1 允许在 master 上跑；CODEX_MODEL=xxx 指定模型（默认用 codex 默认模型）。
# 需要：codex CLI（codex exec）、Git Bash。双击版见 codex-execute-latest-plan.bat。
set -euo pipefail

# --- 仓库根 + 分支自检（遵守 AGENTS.md 串行化） ---
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
# git pull 前自检：落后上游则提醒（不硬挡，留给你决定）
if git rev-parse --verify --quiet @{u} >/dev/null 2>&1; then
  BEHIND="$(git rev-list --count @..@{u} 2>/dev/null || true)"
  if [ -n "$BEHIND" ] && [ "$BEHIND" -gt 0 ] 2>/dev/null; then
   echo "⚠️ 本地落后上游 $BEHIND 个提交，建议先 git pull 再执行（避免 review 时冲突）。" >&2
  fi
fi

# --- 复用 git-flow.sh status 的 awk 解析（scripts/git-flow.sh:144） ---
PLANS_DIR="${PLANS_DIR:-$REPO_ROOT/docs/superpowers/plans}"

plan_status() {
  awk 'BEGIN{n=0} /^---[[:space:]]*$/{n++; next} n==1 && /^status:[[:space:]]*/{sub(/^status:[[:space:]]*/,""); sub(/[[:space:]]*$/,""); print; exit}' "$1"
}

# --- 交接前阻塞清单（聚合输出，不再只给一句通用报错） ---
BLOCKERS=""
if [ "$BRANCH" = "master" ] && [ "${ALLOW_MASTER:-0}" != "1" ]; then
  BLOCKERS+=$'\n'"- 当前在 master（实现必须走任务分支；确认要跑就设 ALLOW_MASTER=1）"
fi

DIRTY="$(git status --porcelain || true)"
if [ -n "$DIRTY" ]; then
  DIRTY_COUNT="$(printf '%s\n' "$DIRTY" | wc -l)"
  BLOCKERS+=$'\n'"- 工作区未提交项（$DIRTY_COUNT 项），会混进 Codex 的提交："
  BLOCKERS+=$'\n'"$DIRTY"
fi

NOSTATUS=""
for file in "$PLANS_DIR"/*.md; do
  [ -e "$file" ] || continue
  if [ -z "$(plan_status "$file")" ]; then
    NOSTATUS+=$'\n'"  - $(basename "$file")"
  fi
done
if [ -n "$NOSTATUS" ]; then
  NOSTATUS_COUNT="$(printf '%s\n' "$NOSTATUS" | sed '1d' | wc -l)"
  echo "⚠️ 有 $NOSTATUS_COUNT 个 plan 缺 status，建议补 frontmatter（本次仍可按 mtime 回落）：$NOSTATUS" >&2
fi

if [ -n "$BLOCKERS" ]; then
  echo "🚫 交接阻塞：$BLOCKERS" >&2
  exit 1
fi

# --- 找待执行 plan（status: pending 优先；无则回落 mtime 并告警） ---
PENDING_COUNT=0
PENDING_FILE=""
for file in "$PLANS_DIR"/*.md; do
  [ -e "$file" ] || continue
  if [ "$(plan_status "$file")" = "pending" ]; then
    PENDING_COUNT=$((PENDING_COUNT + 1))
    PENDING_FILE="$file"
    echo "  - $(basename "$file")" >&2
  fi
done

if [ "$PENDING_COUNT" -gt 1 ]; then
  echo "⚠️ 存在 $PENDING_COUNT 个 pending plan（串行化），列表见上。" >&2
  echo "   同一时刻只允许 1 个 pending；先把非当前项标 done，再跑本脚本。" >&2
  exit 1
elif [ "$PENDING_COUNT" -eq 1 ]; then
  PLAN_FILE="$PENDING_FILE"
else
  PLAN_FILE="$(ls -t "$PLANS_DIR"/*.md 2>/dev/null | head -1 || true)"
  if [ -n "$PLAN_FILE" ]; then
    echo "⚠️ 无 pending plan，回落 mtime 最新（$(basename "$PLAN_FILE")）。建议给待执行 plan 标 status: pending。" >&2
  fi
fi

if [ -z "$PLAN_FILE" ]; then
  echo "❌ 没找到 plan：$PLANS_DIR/*.md" >&2
  exit 1
fi
echo "📋 Executing plan: $PLAN_FILE"

PROMPT="$(cat <<EOF
$(cat "$PLAN_FILE")

严格按以上计划逐粒执行。每个 Task：
- 照计划里的 Step 跑测试/构建，把真实输出贴出来；没通过的步骤不许声称完成。
- 测试/构建失败时：贴出失败断言/报错原文 + 你认为的根因，不要只写「失败」。
- 计划里该 Task 有「提交」步骤就照它的 commit message 提交；没有就跳过，别乱提交。
- 遇阻立刻停，不猜测、不盲改、不扩大计划范围。

本仓库协同纪律（先读这些再动手）：
- docs/coordination.md（分支/提交粒度/串行化）+ AGENTS.md（摘要）。
计划写作约定（改 plan 文档时遵守）：
- 每个 Task 的验证步骤写「可跑命令 + 期望退出码/输出特征」（如 rg 断言为空、命令 exit 0），少用「应看到 X」这类自然语言。
- 管理员/真机才能验的步骤（装 Windows 服务、杀进程、服务自愈、sc.exe 查询）单独列在 plan 尾部「真机验收（管理员，不代跑）」段，明确标注沙箱验不到；没权限的步骤禁止声称已验证，只写「待真机验收」。
- plan 加 frontmatter status：待执行=pending、执行中=in-progress、完成待合=done；一次只允许 1 个 pending。
提交纪律（强制）：
- 每个 Task 独立一个 commit，按计划里该 Task 的 commit message 提交；不得把多个 Task 的改动堆在一起。
- 只做计划里的改动，不加计划外文件/全局 hack（禁止 sitecustomize.py 之类临时文件、禁止改测试配置绕沙箱）。
- 改现有文件用精改（Edit/替换），禁止整文件覆盖导致内容重复。
- 不 commit master、不 push；做完留在任务分支，review 交给 Claude 对照 plan 逐粒核对。
本脚本运行即代表用户授权按计划提交，计划里「提交前需用户确认」在此不适用。
全部结束后：
1. 若有未提交改动：git add -A && git commit -m "feat: implement $(basename "$PLAN_FILE" .md) per plan"
2. 输出执行总结：完成/受阻的 Task、每 Task 验证输出、剩余项。
EOF
)"

args=(-C "$REPO_ROOT" --sandbox workspace-write)
if [ -n "${CODEX_MODEL:-}" ]; then
  args+=(--model "$CODEX_MODEL")
fi

# 用 stdin 传 prompt：Windows 下 plan 常超过 32KB 命令行上限，codex 的 node shim 会
# 「Argument list too long」。codex exec 的 `-` 表示从 stdin 读指令。
printf '%s\n' "$PROMPT" | codex exec "${args[@]}" -

echo "✅ Codex 执行完毕。提交见 git log；review 交给 Claude 对照 plan 逐粒核对。"
