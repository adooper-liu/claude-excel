# 服务化 venv 种子修复（2026-08-28）：每台机器 python 路径不同 + venv 创建不走 Start-Process 重定向

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复已合 master 的 venv 补丁（merge `008c516`）里 `Ensure-PythonEnv` 的 venv 创建方式。根因（已实测复现）：`python -m venv` 经 `Start-Process -RedirectStandardOutput/Error -NoNewWindow` 调用时，参数被拼坏，python 未收到 `-m venv` 而落入 `_pyrepl` 交互控制台，在重定向句柄下抛 `WinError 6`（无效句柄）。**不动 seed「来源」**——seed 仍运行期解析，使每台机器各自生效（本机无 `py` launcher、PATH 首位是 conda base，纯属正常差异，不是缺陷）。

## Global Constraints

- **禁止写死任何 python 绝对路径**（`D:\miniconda3\python.exe`、`py -3`、任何 `C:\Users\...` 路径都不得进脚本）。每台机器 python 路径不同，这是硬边界。
- **venv 路径固定为仓库相对路径**：`$ROOT\backend\.venv`（`$ROOT` 两跳，现有 `PSScriptRoot` 逻辑不变）。venv 解释器永远是 `$ROOT\backend\.venv\Scripts\python.exe`，与机器无关，与 seed 无关。
- **venv 创建改直接调用**：`& $seedPy -m venv <venvDir>`，不经过 `Start-Process -Redirect`（那正是把参数拼坏、触发 pyrepl 崩溃的东西）。成功判定用 `$LASTEXITCODE`。
- pip 安装（into venv）：在管理员交互终端运行，同样改直接调用 `& $venvPy -m pip install -r ...` + `$LASTEXITCODE` 判定（`$PSNativeCommandUseErrorActionPreference=$false` 已在文件头，交互终端无 stderr-as-ErrorRecord 问题）。Start-Process-Redirect 仅保留给给**非交互环境**（start-service.ps1 服务场景），setup-service.ps1 不再用它跑 venv/pip。
- 幂等保持：venv 已存在则跳过。
- 只改 `scripts/service/setup-service.ps1` 的 `Invoke-NativePip`/`Ensure-PythonEnv` 两函数。不动 start-service.ps1（它已正确用 venv 路径，与本修复无关）、不动 config_store.py / server.py / install.bat / 其他脚本。

## 现状（已验）

`setup-service.ps1` 当前 `Ensure-PythonEnv`（L62-87）：
- `$seedPy = (Get-Command python).Source` → 本机 `D:\miniconda3\python.exe`（正常，每台机器不同）
- `Invoke-NativePip $seedPy @("-m","venv", <venvDir>)` → **经 Start-Process-Redirect，触发崩溃**（实测 WinError 6，见用户贴出 traceback）

## Task 1: Ensure-PythonEnv 改直接调用（venv + pip），去掉 Invoke-NativePip

**Files:**
- Modify: `scripts/service/setup-service.ps1`

**Interfaces:**
- Produces: `$ROOT\backend\.venv\Scripts\python.exe` + requirements 依赖装入 venv。
- Consumes: 每台机器 PATH 首位的 `python`（seed，仅用于一次性创建，不进入服务运行时）。

- [ ] **Step 1: 替换 Ensure-PythonEnv（删掉 Invoke-NativePip，venv 创建与 pip 都改直接调用）**

删除现有 `Invoke-NativePip`（L64-76）整个函数，并将 `Ensure-PythonEnv`（L77-87）替换为：

```powershell
# ---- Ensure-PythonEnv：服务用项目自身 venv（不与交互 python 共享），幂等 ----
# 每台机器 python 路径不同：seed 运行期从 PATH 首个 python 解析，禁止写死绝对路径。
# venv 创建/安装都直接调用（不经过 Start-Process-Redirect——那会把 -m venv 参数拼坏，
# python 落入交互控制台并在重定向句柄下抛 WinError 6，实测复现）。
$venvPython = Join-Path $ROOT "backend\.venv\Scripts\python.exe"
$venvDir     = Join-Path $ROOT "backend\.venv"
function Ensure-PythonEnv {
    if (Test-Path $venvPython) { Write-Host "venv 已存在: $venvPython"; return }
    $seedPy = (Get-Command python).Source   # 每台机器 PATH 首个 python（本机是 conda base，属正常）
    Write-Host "创建后端 venv（seed=$seedPy）..."
    & $seedPy -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { throw "venv 创建失败（exit=$LASTEXITCODE）：$seedPy -m venv $venvDir" }
    Write-Host "安装 requirements 到 venv..."
    & $venvPython -m pip install -r (Join-Path $ROOT "backend\requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "pip install 失败（exit=$LASTEXITCODE）" }
    Write-Host "venv 就绪: $venvPython"
}
```

调用位置不变：`Ensure-Nssm` / `Unblock-File` 之后、建服务之前（现 L103）。

- [ ] **Step 2: 语法检查** — `powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('scripts/service/setup-service.ps1', [ref]$null, [ref]$null) | Out-Null; 'OK'"`
  Expected: `OK`。
- [ ] **Step 3: 真机冒烟（需管理员，手动执行——只给指令不代跑）** — 管理员 PowerShell，项目根：
  `.\scripts\service\setup-service.ps1 -UserHome C:\Users\<你的用户名>`
  Expected: 输出「创建后端 venv（seed=…）…」「安装 requirements 到 venv…」「venv 就绪…」，随后建服务、Running、`sc.exe qc SheetWiseBackend` 显示 start-service.ps1 路径。若本机已有 venv，则应输出「venv 已存在」并跳过（幂等验证）。
- [ ] **Step 4: 提交** —
  `git add scripts/service/setup-service.ps1 && git commit -m "fix(service): Ensure-PythonEnv 改直接调用建 venv/pip（不再 Start-Process-Redirect，修 WinError 6；seed 运行期解析，不写死 python 路径）"`

## 收尾

1. `git diff` 确认：只动 setup-service.ps1，无 python 绝对路径进入脚本（`rg "miniconda|C:\\\\Users|py -3" scripts/service/` 为空）。
2. 手动端到端（管理员）：setup 冒烟通过 → `status-service.ps1` → OK → 杀 uvicorn 验证自愈 → `config.json` 落在 `-UserHome/.claude-excel-web/`。
3. 全部通过后：按 `docs/coordination.md`，review 交回 Claude（Codex 只实现、不自 review）。