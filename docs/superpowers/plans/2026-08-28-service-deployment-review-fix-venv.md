# 服务化部署 review 修正补丁 A：后端用项目自身 venv（2026-08-28）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复上一轮 review 发现的环境隔离缺陷——服务（LocalSystem）启动时 `start-service.ps1` 用 `(Get-Command python).Source` 从服务进程 PATH 解析 python，落在与交互 shell 不同的解释器，缺 `httpx` 导致 `backend/server.py` import 崩、健康循环 3 miss、服务 DOWN。**方案 A（已定）**：服务用**项目自身 venv**，安装时 `Ensure-PythonEnv`（建 venv → 装 requirements），`start-service.ps1` 改用 venv 解释器拉起 uvicorn，服务与用户交互 python 彻底解耦。

**Architecture:** `backend/.venv`（已被 `.gitignore:41` `.venv/` 覆盖，不入仓库）。`setup-service.ps1`（管理员、一次性）在装服务前 `Ensure-PythonEnv`：venv 不存在则 `python -m venv backend\.venv` → `pip install -r backend\requirements.txt`（幂等）。`start-service.ps1` 不再 `Get-Command python`，改 `$venvPython = Join-Path $ROOT "backend\.venv\Scripts\python.exe"`，存在性检查失败则 fail-closed 记日志退出（NSSM 重启，但 venv 属安装期产物，与 nssm.exe 同级，创建归 setup 管）。

**Context:** 这是在 `docs/superpowers/plans/2026-08-28-service-deployment-review-fix.md`（Task 1-4 已由 Codex 执行并 review 通过）之后追加的独立补丁，单独成 plan 文件，避免 codex-execute-latest-plan.sh 重跑已完成的 Task。**已确认的前置事实（review 已核实，不要重测）：**
- start-service.ps1:79 的 python 来源是 `(Get-Command python).Source`
- setup-service.ps1 目前无任何 venv/pip 逻辑
- requirements.txt 含 `fastapi>=0.115.0`、`uvicorn[standard]>=0.32.0`、`httpx>=0.27.0`
- `.gitignore:41` 已覆盖 `.venv/`
- 服务名 `SheetWiseBackend`、env `SHEETWISE_USER_HOME`（Machine 级）、互斥锁 `Global\SheetWiseBackend_start_ps1`、日志目录 `scripts/service/logs/` —— 全部沿用现有实现，**不改**

## Global Constraints

- **只改两个文件**：`scripts/service/setup-service.ps1`、`scripts/service/start-service.ps1`。不碰 config_store.py / server.py / install.bat / status-service.ps1 / uninstall-service.ps1 / .gitignore（venv 已被覆盖）。
- **venv 固定路径**：`backend\.venv\Scripts\python.exe`（`$ROOT` 两跳规则沿用现有脚本）。
- **NSSM 深坑规避继续生效**（本次新增的 pip/venv 也是原生命令调用）：禁止 `2>&1` 直接用 stderr 重定向，用 `Start-Process -RedirectStandardOutput/Error` 或等效；`$PSNativeCommandUseErrorActionPreference = $false` 已在两个脚本文件头，保留。
- **幂等**：venv 已存在则不重建（不重装 requirements）。安装失败（venv 创建或 pip install 非零退出）→ throw/停，不继续建服务。
- **不删 venv**：卸载不删 venv（与 nssm.exe 同属安装期产物；范围收敛，不放进本次）。

---

### Task 1: setup-service.ps1 加 Ensure-PythonEnv（建 venv + 装 requirements）

**Files:**
- Modify: `scripts/service/setup-service.ps1`

**Interfaces:**
- Produces: `backend/.venv/Scripts/python.exe` + 全部 requirements 依赖装进 venv。`Ensure-PythonEnv` 函数。
- Consumes: 管理员 shell 的 `python`（作为 venv 种子解释器）、`backend/requirements.txt`。

**改动位置**（对照当前文件结构）：在 `Ensure-Nssm`/`Unblock-File` 之后、`Invoke-Nssm stop $ServiceName | Out-Null`（建服务清残留）之前，插入 `Ensure-PythonEnv`。即：先有 nssm、先有 venv，再建服务。

- [ ] **Step 1: 插入 Ensure-PythonEnv 函数**（放在 `Ensure-Nssm` 函数定义之后）：

```powershell
# ---- Ensure-PythonEnv：服务用项目自身 venv（不与用户交互 python 共享），幂等 ----
$venvPython = Join-Path $ROOT "backend\.venv\Scripts\python.exe"
function Invoke-NativePip {
    param(
        [string]$PyExe,
        [string[]]$Args
    )
    $out = Join-Path $env:TEMP "pip-out-$(Get-Random).txt"
    $err = Join-Path $env:TEMP "pip-err-$(Get-Random).txt"
    try {
        $p = Start-Process -FilePath $PyExe -ArgumentList $Args -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $out -RedirectStandardError $err
        return @{ ExitCode = $p.ExitCode; Output = "$(Get-Content $out -Raw -ErrorAction SilentlyContinue)$(Get-Content $err -Raw -ErrorAction SilentlyContinue)" }
    } finally { Remove-Item $out, $err -ErrorAction SilentlyContinue }
}
function Ensure-PythonEnv {
    if (Test-Path $venvPython) { Write-Host "venv 已存在: $venvPython"; return }
    Write-Host "创建后端 venv..."
    $seedPy = (Get-Command python).Source
    $venv = Invoke-NativePip $seedPy @("-m", "venv", (Join-Path $ROOT "backend\.venv"))
    if ($venv.ExitCode -ne 0) { throw "venv 创建失败：$($venv.Output)" }
    Write-Host "安装 requirements 到 venv..."
    $pip = Invoke-NativePip $venvPython @("-m", "pip", "install", "-r", (Join-Path $ROOT "backend\requirements.txt"))
    if ($pip.ExitCode -ne 0) { throw "pip install 失败：$($pip.Output)" }
    Write-Host "venv 就绪: $venvPython"
}
```

- [ ] **Step 2: 调用 Ensure-PythonEnv**（在 `Ensure-Nssm` 与 `Unblock-File $nssmExe` 之后，紧跟插入 `Ensure-PythonEnv` 一行）：

```powershell
Ensure-Nssm
Unblock-File $nssmExe -ErrorAction SilentlyContinue

Ensure-PythonEnv          # ← 新增

# ---- 建服务（先清残留，幂等）----
Invoke-Nssm stop $ServiceName | Out-Null
```

- [ ] **Step 3: 语法检查** — `powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('scripts/service/setup-service.ps1', [ref]$null, [ref]$null) | Out-Null; 'OK'"`
  Expected: `OK`。
- [ ] **Step 4: 提交** —
  `git add scripts/service/setup-service.ps1 && git commit -m "fix(service): setup-service.ps1 Ensure-PythonEnv 建 venv + 装 requirements（服务与交互 python 解耦）"`

---

### Task 2: start-service.ps1 改用 venv 解释器

**Files:**
- Modify: `scripts/service/start-service.ps1`

**Interfaces:**
- Produces: 用 `backend\.venv\Scripts\python.exe` 拉起 `backend/server.py`。
- Consumes: venv 解释器（由 setup-service 的 Ensure-PythonEnv 创建）。

**改动位置**：当前 `start-service.ps1` 第 79 行 `Start-Process -FilePath (Get-Command python).Source`。替换为 venv 路径 + 存在性前置检查。

- [ ] **Step 1: 加 venvPython 定义 + 存在性检查 + 改用 venv 起 uvicorn**（替换起 uvicorn 前的变量区与 Start-Process 调用）：

```powershell
# ---- venv 解释器（服务专用，Ensured by setup-service.ps1；失败 fail-closed 交 NSSM）----
$venvPython = Join-Path $ROOT "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-SvcLog "venv python missing: $venvPython — run setup-service.ps1 first" "ERROR"
    exit 1
}

# ---- 起 uvicorn（后台隐藏；用 venv python，不 2>&1）----
Write-SvcLog "Starting uvicorn :8765 (venv)..."
$stdoutLog = Join-Path $logDir "backend-stdout.log"
$stderrLog = Join-Path $logDir "backend-stderr.log"
$proc = Start-Process -FilePath $venvPython `
    -ArgumentList (Join-Path $ROOT "backend\server.py") `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
Write-SvcLog "uvicorn PID=$($proc.Id)"
```

- [ ] **Step 2: 语法检查** — `powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('scripts/service/start-service.ps1', [ref]$null, [ref]$null) | Out-Null; 'OK'"`
  Expected: `OK`。
- [ ] **Step 3: 提交** —
  `git add scripts/service/start-service.ps1 && git commit -m "fix(service): start-service.ps1 用项目 venv 解释器起 uvicorn（不再 Get-Command python）"`

---

## 收尾

全部 2 个任务完成后：

1. Run: 两个语法检查（Task1-Step3 / Task2-Step2）→ 全 `OK`。
2. Run: `cd backend && python -m pytest tests/test_config_store.py -v` → 2/2 PASS（确认未碰 config_store.py）。
3. 手动端到端（管理员，给指令不代跑）：
   - `.\\scripts\\service\\setup-service.ps1 -UserHome C:\\Users\\<你的用户名>` → 先见「创建后端 venv...」「安装 requirements 到 venv...」再建服务 → 服务 Running
   - `.\scripts\service\status-service.ps1` → 8765 UP + `/api/health OK` → **OK**（这是上一轮 DOWN 的修后判定）
   - `sc.exe qc SheetWiseBackend` → BINARY_PATH_NAME 指向 venv python（`.venv\Scripts\python.exe backend\server.py`），非裸 `python`
   - 杀 uvicorn 进程（模拟崩溃）→ 等 ~10 秒 → 自愈回 Running（venv python 重启）
   - 确认 `[Environment]::GetEnvironmentVariable("SHEETWISE_USER_HOME","Machine")` = `C:\Users\<你的用户名>`
   - Excel 开插件直连 `https://localhost:8765`，不跑 launch.bat
4. 全部通过后：按 `docs/coordination.md`，实现完成，review 交给 Claude 对照本 plan 逐粒核对（Codex 只实现、不自行 review）。