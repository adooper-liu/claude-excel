#!/bin/bash
# git-flow.sh
# 把 AGENTS.md §4 的 git 操作流程封装成可执行脚本，覆盖多工具协同串行化 + 单开发者日常。
# 用法（Git Bash，仓库任意子目录均可）：
#   ./scripts/git-flow.sh check              # 开工前检查（只读）
#   ./scripts/git-flow.sh start <名字>       # 从最新 master 开分支 feat/<名字>
#   ./scripts/git-flow.sh sync               # 同步 master（切到 master + pull）
#   ./scripts/git-flow.sh update             # 把最新 origin/master 合进当前任务分支（合并前防冲突）
#   ./scripts/git-flow.sh push-branch        # 推送当前任务分支到 origin（交接/备份）
#   ./scripts/git-flow.sh finish [--test]    # 合入 master + push + 删分支；--test 先跑测试
# 双击版见 git-flow.bat（无参数时默认跑 check）。
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

usage() {
  cat <<'EOF'
用法：git-flow.sh <子命令>

子命令（对应 AGENTS.md §4 的分支生命周期）：
  check              开工前检查（只读）：fetch + status + log + 未合并分支，发现进行中工作会提醒
  start <名字>       从最新 master 开分支（自动 fetch + 更新 master）；名字含 / 则原样，否则加 feat/ 前缀
  sync               同步 master：切到 master + pull（云端同步）
  update             把最新 origin/master 合进当前任务分支（合并前防冲突）
  push-branch        推送当前任务分支到 origin（交接/备份用）
  finish [--test]    合入 master + push + 删分支；加 --test 先跑 pytest / test:unit / typecheck
EOF
}

# --- 检查工作区干净；不干净则退出 ---
require_clean() {
  if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️ 工作区有未提交改动，会混进提交。先 commit 或 stash。" >&2
    exit 1
  fi
}

# --- 当前分支名 ---
current_branch() {
  git rev-parse --abbrev-ref HEAD
}

# --- check：开工前检查（只读，多工具开工前必跑） ---
check() {
  echo "🔍 开工前检查（只读）..."
  git fetch --quiet
  local branch
  branch="$(current_branch)"
  echo ""
  echo "📍 当前分支：$branch"
  echo ""
  echo "— 工作区状态："
  git status --short
  if [ -n "$(git status --porcelain)" ]; then
    echo "  ⚠️ 有未提交改动：先 commit 或 stash，别另起炉灶。"
  fi
  echo ""
  echo "— 最近 5 条提交："
  git log --oneline -5
  echo ""
  echo "— 未合入 master 的本地分支（进行中工作）："
  git branch --no-merged master 2>/dev/null || true
  if [ "$branch" != "master" ] && git rev-parse --verify --quiet @{u} >/dev/null 2>&1; then
    local behind
    behind="$(git rev-list --count @..@{u} 2>/dev/null || echo 0)"
    if [ -n "$behind" ] && [ "$behind" -gt 0 ] 2>/dev/null; then
      echo "  ⚠️ 本地落后上游 $behind 个提交。"
    fi
  fi
  echo ""
  echo "✅ 检查完成。无进行中工作即可开新任务：$0 start <名字>"
}

# --- start：从最新 master 开新分支 ---
start() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    echo "❌ 缺少分支名。用法：$0 start <名字>" >&2
    exit 1
  fi
  # 名字含 / 则原样（如 feat/xxx / fix/xxx），否则加 feat/ 前缀
  local branch="$name"
  case "$name" in
    */*) ;;
    *) branch="feat/$name" ;;
  esac
  require_clean
  if git rev-parse --verify --quiet "$branch" >/dev/null 2>&1; then
    echo "⚠️ 分支 $branch 已存在，先确认是否已有进行中工作。" >&2
    exit 1
  fi
  git fetch --quiet
  git checkout master
  git pull --quiet
  git checkout -b "$branch"
  echo "✅ 已基于最新 master 开分支 $branch"
}

# --- sync：同步 master 到云端 ---
sync_master() {
  require_clean
  git checkout master
  git pull --quiet
  echo "✅ master 已同步到 origin/master。"
}

# --- update：把最新 origin/master 合进当前任务分支（合并前防冲突） ---
update() {
  local branch
  branch="$(current_branch)"
  if [ "$branch" = "master" ]; then
    echo "⚠️ 已在 master，无需 update（要同步用 $0 sync）。" >&2
    exit 1
  fi
  require_clean
  git fetch --quiet
  git merge origin/master
  echo "✅ 已把最新 origin/master 合进 $branch。有冲突就手动解决后 commit，再 $0 finish。"
}

# --- push-branch：推送当前任务分支到 origin（交接/备份） ---
push_branch() {
  local branch
  branch="$(current_branch)"
  if [ "$branch" = "master" ]; then
    echo "⚠️ master 不要走 push-branch，同步用 $0 sync。" >&2
    exit 1
  fi
  git push -u origin "$branch"
  echo "✅ 已推送 $branch 到 origin。"
}

# --- 测试门禁：pytest + test:unit + typecheck 全绿才算过 ---
run_tests() {
  echo "🧪 跑测试门禁：后端 pytest + 前端 test:unit + typecheck"
  mkdir -p "$REPO_ROOT/tmp/pytest-basetemp"
  (cd "$REPO_ROOT" && python -m pytest backend/tests --basetemp="$REPO_ROOT/tmp/pytest-basetemp")
  (cd "$REPO_ROOT/addin" && npm run test:unit)
  (cd "$REPO_ROOT/addin" && npm run typecheck)
}

# --- finish：合入 master + push + 删本地分支 ---
finish() {
  local run_test=0
  if [ "${1:-}" = "--test" ]; then
    run_test=1
  fi
  local branch
  branch="$(current_branch)"
  if [ "$branch" = "master" ]; then
    echo "⚠️ 在 master 上，没有任务分支可合并。" >&2
    exit 1
  fi
  require_clean
  echo "ℹ️ 合并前请确认已测绿（pytest + test:unit + typecheck）。加 --test 自动跑。"
  if [ "$run_test" = "1" ]; then
    run_tests
  fi
  git fetch --quiet
  if [ -n "$(git log --oneline master..origin/master)" ]; then
    echo "⚠️ origin/master 有新提交，当前分支可能落后。建议先：$0 update"
  fi
  git checkout master
  git pull --quiet
  if ! git merge --ff-only "$branch"; then
    echo "❌ 非 fast-forward，无法直接合入。先回分支把最新 master 合进去再 finish：" >&2
    echo "   git checkout $branch && git merge origin/master" >&2
    git checkout "$branch" 2>/dev/null || true
    exit 1
  fi
  git push origin master
  git branch -d "$branch"
  echo "✅ 已合入并推送 master，本地分支 $branch 已删除。"
  if git rev-parse --verify --quiet "origin/$branch" >/dev/null 2>&1; then
    echo "ℹ️ 远端仍有 origin/$branch，需手动删：git push origin --delete $branch"
  fi
}

cmd="${1:-}"
case "$cmd" in
  check) check ;;
  start) start "${2:-}" ;;
  sync) sync_master ;;
  update) update ;;
  push-branch) push_branch ;;
  finish) finish "${2:-}" ;;
  ""|-h|--help|help) usage ;;
  *) echo "❌ 未知子命令：$cmd" >&2; usage >&2; exit 1 ;;
esac
