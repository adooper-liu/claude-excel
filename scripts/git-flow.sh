#!/bin/bash
# git-flow.sh
# 把 AGENTS.md §4 的 git 操作流程封装成可执行脚本，覆盖多工具协同串行化 + 单开发者日常。
# 会话生命周期（harness 四件套适配）：开始(env) → 选择(status) → 执行 → 收尾(finish)。
# 用法（Git Bash，仓库任意子目录均可）：
#   ./scripts/git-flow.sh check              # 开工前检查（只读）：git + 环境自检
#   ./scripts/git-flow.sh env                # 环境自检（只读）：node / node_modules / python 依赖 / 后端
#   ./scripts/git-flow.sh status             # 任务状态扫描（只读）：docs/tasks/*.md 串行化 + done 需证据
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

子命令（对应 AGENTS.md §4 的分支生命周期 + 会话生命周期）：
  check              开工前检查（只读）：fetch + status + log + 未合并分支 + 环境自检，发现进行中工作会提醒
  env                环境自检（只读）：node / addin/node_modules / python 依赖 / 后端 :8765（init.sh 适配）
  status             任务状态扫描（只读）：docs/tasks/*.md 的 frontmatter status，校验串行化 + done 需证据（feature_list.json 适配）
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
  echo "✅ Git 检查完成。无进行中工作即可开新任务：$0 start <名字>"
  echo ""
  echo "— 环境自检（只读，缺项按提示补）："
  env_check || true
}

# --- env：开工前环境自检（只读，对应 harness 四件套的 init.sh） ---
env_check() {
  local ok=1 py=""
  # node
  if command -v node >/dev/null 2>&1; then
    echo "  ✓ node: $(node --version)"
  else
    echo "  ✗ node 不在 PATH。addin 依赖 Node.js，装好后再开工。" >&2; ok=0
  fi
  # addin 依赖
  if [ -d "$REPO_ROOT/addin/node_modules" ]; then
    echo "  ✓ addin/node_modules 已安装"
  else
    echo "  ⚠️ addin/node_modules 不存在：cd addin && npm install（测试门禁 test:unit / typecheck 会失败）" >&2
  fi
  # python + 后端依赖
  if command -v python >/dev/null 2>&1; then
    py="python"
  elif command -v python3 >/dev/null 2>&1; then
    py="python3"
  fi
  if [ -n "$py" ]; then
    echo "  ✓ $py: $("$py" --version 2>&1)"
    if "$py" -c "import flask" >/dev/null 2>&1; then
      echo "  ✓ 后端依赖（flask）已装"
    else
      echo "  ⚠️ 后端依赖未装：pip install -r backend/requirements.txt" >&2
    fi
  else
    echo "  ✗ python 不在 PATH。后端依赖 Python，装好后再开工。" >&2; ok=0
  fi
  # 后端 :8765
  if curl -s -m 2 http://localhost:8765/api/health 2>/dev/null | grep -q ok; then
    echo "  ✓ 后端 :8765 在线"
  elif curl -sk -m 2 https://localhost:8765/api/health 2>/dev/null | grep -q ok; then
    echo "  ✓ 后端 :8765 在线（https）"
  else
    echo "  ℹ️ 后端 :8765 未在线（跑测试不需要；跑 addin 调试用 launch.bat）"
  fi
  if [ "$ok" = "0" ]; then
    echo "❌ 有硬性缺项（node / python），先处理再开工。" >&2
    return 1
  fi
  echo "✅ 环境就绪（⚠️ 项可按提示补，不阻塞开工）。"
}

# --- status：扫描任务 brief 状态（只读，对应 harness 四件套的 feature_list.json） ---
status() {
  local tasks_dir="$REPO_ROOT/docs/tasks"
  if [ ! -d "$tasks_dir" ]; then
    echo "⚠️ 没有 docs/tasks/ 目录。"
    return 0
  fi
  echo "🔍 任务状态扫描（docs/tasks/*.md frontmatter status）..."
  local in_progress=0 done_unchecked=0 noshow=0
  local f name s
  for f in "$tasks_dir"/*.md; do
    [ -f "$f" ] || continue
    name="$(basename "$f")"
    case "$name" in _template.md|README.md) continue ;; esac
    # frontmatter 优先；无 frontmatter 回落老模板的「**状态**」行
    s="$(awk 'BEGIN{n=0} /^---[[:space:]]*$/{n++; next} n==1 && /^status:[[:space:]]*/{sub(/^status:[[:space:]]*/,""); sub(/[[:space:]]*$/,""); print; exit}' "$f" || true)"
    if [ -z "$s" ]; then
      # 老模板：- **状态**：`done`（已合 master ...）→ 取该行第一个小写反引号 token
      s="$(grep -m1 '\*\*状态\*\*' "$f" 2>/dev/null | grep -oE '`[a-z][a-z_]*`' | head -1 | tr -d '`' || true)"
    fi
    if [ -z "$s" ]; then
      printf "  · %-44s %s\n" "$name" "— 未标状态"
      noshow=$((noshow+1))
      continue
    fi
    case "$s" in
      coding|fix|review)
        in_progress=$((in_progress+1))
        printf "  · %-44s %s\n" "$name" "🟡 $s"
        ;;
      done)
        if grep -q '\[ \]' "$f"; then
          done_unchecked=$((done_unchecked+1))
          printf "  · %-44s %s\n" "$name" "🟢 done（⚠️ 仍有未勾选验收项）"
        else
          printf "  · %-44s %s\n" "$name" "🟢 done"
        fi
        ;;
      blocked) printf "  · %-44s %s\n" "$name" "🔴 blocked" ;;
      design) printf "  · %-44s %s\n" "$name" "⚪ design" ;;
      *) printf "  · %-44s %s\n" "$name" "❔ $s" ;;
    esac
  done
  echo ""
  if [ "$in_progress" -gt 1 ]; then
    echo "⚠️  有 $in_progress 个 brief 同时处于进行中（coding/review/fix）。AGENTS.md 串行化：同一时刻只允许一个，先对齐。"
  elif [ "$in_progress" -eq 1 ]; then
    echo "✅ 进行中任务 1 个（符合串行化）。"
  else
    echo "ℹ️  无进行中任务。"
  fi
  [ "$done_unchecked" -gt 0 ] && echo "⚠️  $done_unchecked 个标 done 但验收项未全勾——「无验证证据不得标 done」，补勾或改回状态。"
  [ "$noshow" -gt 0 ] && echo "ℹ️  $noshow 个 brief 无 frontmatter status（旧格式），按旧「**状态**」行尽力解析。"
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
  # ff-only 合并成功 = 分支 commit 全在 master；用 -D 强删，避免 -d 因「本地领先远端分支」误拒
  git branch -D "$branch"
  # 项目约定「合并即删」，同步删远端；远端已不存在时忽略报错
  git push origin --delete "$branch" 2>/dev/null || true
  echo "✅ 已合入并推送 master，本地 + 远端分支 $branch 已清理。"
  echo ""
  echo "📌 收尾别忘：在对应 docs/tasks/<任务>.md 更新 frontmatter status（done）+ append 一行进度 log（跨会话交接物）。"
}

cmd="${1:-}"
case "$cmd" in
  check) check ;;
  env) env_check ;;
  status) status ;;
  start) start "${2:-}" ;;
  sync) sync_master ;;
  update) update ;;
  push-branch) push_branch ;;
  finish) finish "${2:-}" ;;
  ""|-h|--help|help) usage ;;
  *) echo "❌ 未知子命令：$cmd" >&2; usage >&2; exit 1 ;;
esac
