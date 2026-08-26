# 服务化部署 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把后端 `server.py`（uvicorn :8765）从「手动 launch.bat 黑框」升级为「Windows 服务常驻」——开机自启、崩溃自愈、健康自检；用户只开 Excel 就能用。借鉴 `C:\ClaudeOfficeGateway` 验证过的 NSSM 服务模式（详见 `docs/service-deployment.md`）。

**Architecture:** NSSM 包装 `powershell.exe -File scripts/service/start-service.ps1` 成 Windows 服务（LocalSystem）。start-service.ps1 内部：单实例互斥锁 → 证书自检（过期重生成）→ 残余清理 → 起 uvicorn → `Test-PortOwnedBySelf :8765` 健康循环，连续 3 miss 才 exit 1 让 NSSM 自愈。**关键差异**：服务模式下 `Path.home()` 会解析到 systemprofile（跑偏用户目录），所以在 `config_store.py` 让 `CONFIG_DIR` 读 `SHEETWISE_USER_HOME` 环境变量，安装时注入真实用户目录。

**Tech Stack:** PowerShell 7（ps1）+ NSSM（nssm.cc）+ Python uvicorn + 现有 `backend/server.py`。无新 Python 依赖。

**Spec:** `docs/superpowers/specs/2026-08-26-service-deployment-design.md`（本计划所有约束来自该 spec，执行者两个都要读）。借鉴记录：`docs/service-deployment.md`。

## Global Constraints

- **只绑 127.0.0.1**：服务化后 server.py 的 `host="127.0.0.1"` 不变，禁止 0.0.0.0。
- **CONFIG_DIR 必须落在真实用户目录**：`config_store.py` 改读 `SHEETWISE_USER_HOME/.claude-excel-web`；未设该变量时行为与现在完全一致（`Path.home()` / `expanduser("~")`）。服务安装时 `-UserHome` 必填并注入。
- **NSSM 深坑规避**（照抄来源）：`$PSNativeCommandUseErrorActionPreference=$false`；对 pip/sc/npx 等所有原生命调用 `Start-Process -RedirectStandardOutput/Error`（不 `2>&1`）；下载的 nssm.exe 必须 `Unblock-File`。
- **健康检查按端口归属，不查 PID 存活**：`Test-PortOwnedBySelf` 用 `Get-NetTCPConnection`+`Get-Process` StartTime（不用 WMI），连续 3 miss 才不健康。
- **单实例互斥锁**：`Global\SheetWiseBackend_start_ps1`，拿不到立刻退出。
- 开发模式 `npm start` 不碰；`launch.bat` 保留只做手动调试。
- 服务崩溃自愈：`AppExit Default Restart` + `AppRestartDelay 5000` + `AppThrottle 30000`。
- 脚本需管理员：`setup-service.ps1` / `uninstall-service.ps1`；`status-service.ps1` 只读无需管理员。
- 测试以**手动/状态裁决**为主（仓库无 ps1 测试设施），每 Task 附一条可执行的验证命令。

---

### Task 1: config_store.py — CONFIG_DIR 支持 SHEETWISE_USER_HOME

**Files:**
- Modify: `backend/config_store.py:1-12`（顶部 import 区与 CONFIG_DIR 定义）
- Test: `backend/tests/test_config_store.py`（若不存在则新建）

**Interfaces:**
- Produces: `CONFIG_DIR` 在设 `SHEETWISE_USER_HOME` 时 = `<env>/.claude-excel-web`；否则 = `~/.claude-excel-web`（行为不变）。所有下游模块（fetch_recipe/knowledge_store/user_skills_store 等 10+）import 的 `CONFIG_DIR` 自动跟随。
- Consumes: 无。

- [ ] **Step 1: 写失败的测试**

创建/修改 `backend/tests/test_config_store.py`：

```python
"""config_store: CONFIG_DIR honors SHEETWISE_USER_HOME (for service mode)."""

import importlib
import subprocess
import sys
from pathlib import Path


def test_config_dir_default_is_user_home(monkeypatch):
    # 未设 SHEETWISE_USER_HOME 时 = expanduser("~")/.claude-excel-web
    import config_store
    assert config_store.CONFIG_DIR == Path.home() / ".claude-excel-web"


def test_config_dir_honors_env_in_fresh_process(tmp_path):
    # 服务模式：SHEETWISE_USER_HOME 指向真实用户目录。用子进程保证 config_store
    # 在设了 env 的情况下全新 import（CONFIG_DIR 是 import 时冻结的）。
    code = (
        "import sys; sys.path.insert(0, 'backend'); "
        "import config_store; print(config_store.CONFIG_DIR)"
    )
    env = {"SHEETWISE_USER_HOME": str(tmp_path)}
    # 保留 PYTHONPATH 所需的最小环境
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[2],
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == str(tmp_path / ".claude-excel-web")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_config_store.py -v`
Expected: `test_config_dir_honors_env_in_fresh_process` FAIL（`CONFIG_DIR` 仍是 `Path.home()/...`，没有用 env）。

- [ ] **Step 3: 实现**

修改 `backend/config_store.py` 顶部（当前第 1-12 行）：

```python
"""config_store.py — Persist provider config to ~/.claude-excel-web/config.json

多 provider 并存：每个 provider 各存一套 {apiKey, baseUrl, model, smallFastModel}，
`activeProvider` 标记当前生效的那个。旧版单套配置在 load 时自动迁移。
"""

import json
import os
from pathlib import Path

# 服务模式：Windows 服务以 LocalSystem 跑，Path.home() 会解析到 systemprofile
# （跑偏用户目录）。服务安装时注入 SHEETWISE_USER_HOME 指向真实用户目录；
# 未设该变量时行为与现在完全一致（普通 launch.bat / npm start）。
CONFIG_DIR = Path(os.environ.get("SHEETWISE_USER_HOME") or os.path.expanduser("~")) / ".claude-excel-web"
CONFIG_FILE = CONFIG_DIR / "config.json"
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_config_store.py -v`
Expected: 两个测试 PASS。且 `cd backend && python -c "import config_store; print(config_store.CONFIG_DIR)"` 输出 `~/.claude-excel-web`（默认行为不变）。

- [ ] **Step 5: 提交**

```bash
git add backend/config_store.py backend/tests/test_config_store.py
git commit -m "feat(config): CONFIG_DIR 支持 SHEETWISE_USER_HOME（服务模式指向真实用户目录）"
```

---

### Task 2: start-service.ps1 — 服务入口（证书自检 + 单实例 + 起 uvicorn + 健康循环）

**Files:**
- Create: `scripts/service/start-service.ps1`

**Interfaces:**
- Produces: 服务入口（NSSM 拉起的进程）。`$ROOT` 自动探测（`$PSScriptRoot` 上级）；`Test-PortOwnedBySelf`, `Stop-StalePort`, `Write-SvcLog` 内部函数。`-UserHome` 从环境 `SHEETWISE_USER_HOME` 读取（由 setup 注入）。
- Consumes: `backend/server.py`（uvicorn :8765）、`backend/cert.pem`+`key.pem`、`npx office-addin-dev-certs`（证书重生成）、`SHEETWISE_USER_HOME`（env，已由 Task 1 支持）。

- [ ] **Step 1: 创建脚本**

创建 `scripts/service/start-service.ps1`：

```powershell
param()

$ErrorActionPreference = "Stop"
# 深坑：PS 把原生命令 stderr 当 ErrorRecord 升级成终止异常。只关退出码还不够，
# 必须用 Start-Process -Redirect 绕开 PS 错误机制（见 docs/service-deployment.md §1.2）。
$PSNativeCommandUseErrorActionPreference = $false

$ROOT = Split-Path -Parent $PSScriptRoot   # scripts/service -> 项目根
$logDir = Join-Path $ROOT "scripts\service\logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-SvcLog {
    param([string]$msg, [string]$Severity = "Info")
    "`$(Get-Date -Format u) [$Severity] $msg" | Out-File -FilePath (Join-Path $logDir "service.log") -Append -Encoding utf8
}

# ---- 单实例互斥锁（防双启分脑，见 service-deployment.md §1.5）----
$mutex = New-Object System.Threading.Mutex($false, "Global\SheetWiseBackend_start_ps1")
$acquired = $false
try { $acquired = $mutex.WaitOne(0) }
catch [System.Threading.AbandonedMutexException] { $acquired = $true }
if (-not $acquired) {
    Write-SvcLog "Another start-service instance holds the mutex — exiting" "WARN"
    exit 0
}

# 记录本实例开始时刻，用于 Test-PortOwnedBySelf 区分"我起的" vs"残留孤儿"
$script:StartedAt = Get-Date

# ---- 证书自检（复用 launch.bat 逻辑：有效期 <7 天则重生成）----
$certFile = Join-Path $ROOT "backend\cert.pem"
$keyFile  = Join-Path $ROOT "backend\key.pem"
function Test-CertFresh {
    if (-not (Test-Path $certFile)) { return $false }
    $inner = "try{`$c=[System.Security.Cryptography.X509Certificates.X509Certificate2]::new('$certFile');`$ch=New-Object System.Security.Cryptography.X509Certificates.X509Chain;`$ch.ChainPolicy.RevocationMode='NoCheck';`$ok=`$ch.Build(`$c);if(`$ok -and `$c.NotAfter -gt (Get-Date).AddDays(7)){'YES'}}catch{}"
    $r = & powershell.exe -NoProfile -Command $inner
    return ($r -match "YES")
}
if (-not (Test-CertFresh)) {
    Write-SvcLog "Certificate missing/expiring — regenerating..." "WARN"
    Push-Location (Join-Path $ROOT "addin")
    & npx.cmd --yes office-addin-dev-certs install
    Pop-Location
    $crt = Join-Path $env:USERPROFILE ".office-addin-dev-certs\localhost.crt"
    $key = Join-Path $env:USERPROFILE ".office-addin-dev-certs\localhost.key"
    if (Test-Path $crt) {
        Copy-Item $crt $certFile -Force
        Copy-Item $key $keyFile  -Force
        Write-SvcLog "Certificate regenerated."
    } else {
        Write-SvcLog "Certificate regen had no output files — server will fall back to http:8765" "WARN"
    }
}

# ---- 残留清理：杀掉已占 8765 的旧进程（防幽灵占端口）----
function Test-PortOwnedBySelf {
    param([int]$Port)
    $owner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty OwningProcess
    if (-not $owner) { return $false }
    $proc = Get-Process -Id $owner -ErrorAction SilentlyContinue
    if (-not $proc) { return $false }
    try { return ($proc.StartTime -ge $script:StartedAt) }
    catch { return $false }   # 拿不到 StartTime 的进程，fail-closed 按"非我起的"处理
}
Write-SvcLog "Cleaning stale listeners on 8765..."
Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
# 清理 8766（扩展 ingest 随后端常驻）
Get-NetTCPConnection -LocalPort 8766 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }

# ---- 起 uvicorn（后台隐藏；避 PS stderr 用 Redirect，不 2>&1）----
Write-SvcLog "Starting uvicorn :8765..."
$stdoutLog = Join-Path $logDir "backend-stdout.log"
$stderrLog = Join-Path $logDir "backend-stderr.log"
$proc = Start-Process -FilePath (Get-Command python).Source `
    -ArgumentList (Join-Path $ROOT "backend\server.py") `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
Write-SvcLog "uvicorn PID=`$($proc.Id)"

# ---- 健康循环：按端口归属，连续 3 miss 才不健康（NSSM 自愈）----
$maxMiss = 3
$misses  = 0
try {
    while ($true) {
        Start-Sleep -Seconds 5
        if (Test-PortOwnedBySelf -Port 8765) { $misses = 0 }
        else {
            $misses++
            Write-SvcLog "8765 not owned by our own process tree (miss $misses/`$maxMiss)" "WARN"
        }
        if ($misses -ge $maxMiss) {
            Write-SvcLog "Unhealthy: :8765 not served by our process for $misses checks — exiting for SCM restart" "ERROR"
            exit 1
        }
    }
}
finally {
    Write-SvcLog "=== Stopping service ==="
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    Write-SvcLog "=== Stopped ==="
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
```

- [ ] **Step 2: 语法检查**

Run: `powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('scripts/service/start-service.ps1', [ref]\$null, [ref]\$null) | Out-Null; 'OK'"`
Expected: 输出 `OK` 无语法错误。

- [ ] **Step 3: 冒烟跑（不装服务，直接跑脚本验证自愈前提）**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/service/start-service.ps1`（前台跑 15 秒后 Ctrl+C）
Expected: 日志出现「Starting uvicorn :8765」；`curl -sk https://localhost:8765/api/health` 返回 ok（证书存在时）；Ctrl+C 后 8765 释放。若直接跑时有既有 8765 占用，应看到「Cleaning stale listeners」。

- [ ] **Step 4: 提交**

```bash
git add scripts/service/start-service.ps1
git commit -m "feat(service): start-service.ps1 服务入口（单实例+证书自检+起 uvicorn+端口归属健康循环）"
```

---

### Task 3: setup-service.ps1 — NSSM 安装（下载/解压/建服务/注入 UserHome）

**Files:**
- Create: `scripts/service/setup-service.ps1`

**Interfaces:**
- Produces: Windows 服务 `SheetWiseBackend`（NSSM），`SHEETWISE_USER_HOME` 环境注入（Machine 级 + start 脚本传递）。NSSM 放 `scripts/service/nssm/nssm.exe`。
- Consumes: `start-service.ps1`、`Invoke-Nssm` 内部函数、`Ensure-Nssm`（下载+Unblock-File）。

- [ ] **Step 1: 创建脚本**

创建 `scripts/service/setup-service.ps1`：

```powershell
# 一次性：把后端 :8765 装成 Windows 服务（NSSM 包装 start-service.ps1）。
# 借鉴 C:\ClaudeOfficeGateway\setup-service.ps1 的 NSSM 模式与坑（见 docs/service-deployment.md）。

param(
    [switch]$Uninstall,
    [string]$UserHome,      # 服务模式下真实用户目录（必填，LocalSystem 自己解析 ~ 会跑偏）
    [string]$ServiceName = "SheetWiseBackend"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    throw "需要管理员 PowerShell（右键 → 以管理员身份运行）。创建/删除 Windows 服务必须提升权限。"
}

$ROOT    = Split-Path -Parent $PSScriptRoot
$service = "scripts\service"
$logDir  = Join-Path $ROOT "$service\logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

# ---- UserHome 必填校验 ----
if ($Uninstall) {
    # 卸载模式不需要
} elseif (-not $UserHome) {
    # 未显式传则尝试探测：取当前登录用户的 profile（排除 SYSTEM / 默认）
    $userHomes = @(Get-ChildItem C:\Users -Directory | Where-Object { $_.Name -notmatch '^(Public|Default|Default User)$' })
    if ($userHomes.Count -eq 1) { $UserHome = $userHomes[0].FullName }
    else {
        throw "无法唯一判断用户目录。请显式传入 -UserHome，例如：.\setup-service.ps1 -UserHome C:\Users\你的用户名"
    }
}
if (-not $UserHome) { throw "参数错误：-UserHome 必填（服务以 LocalSystem 跑，必须指向真实用户目录）" }
Write-Host "UserHome = $UserHome"

# ---- Invoke-Nssm：Start-Process + Redirect 绕开 PS stderr 深坑（service-deployment.md §1.2）----
function Invoke-Nssm {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    $outFile = Join-Path $env:TEMP "nssm-out-$(Get-Random).txt"
    $errFile = Join-Path $env:TEMP "nssm-err-$(Get-Random).txt"
    try {
        $p = Start-Process -FilePath $nssmExe -ArgumentList $Args -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $outFile -RedirectStandardError $errFile
        return @{ ExitCode = $p.ExitCode; Output = "$(Get-Content $outFile -Raw -ErrorAction SilentlyContinue)$(Get-Content $errFile -Raw -ErrorAction SilentlyContinue)" }
    } finally {
        Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
    }
}

# ---- Ensure-Nssm：下载 + Unblock-File（MOTW 阻碍执行，见 service-deployment.md §1.2）----
$nssmExe = Join-Path $ROOT "$service\nssm\nssm.exe"
function Ensure-Nssm {
    if (Test-Path $nssmExe) { return }
    Write-Host "nssm.exe missing — downloading..."
    $zip = Join-Path $env:TEMP "nssm-setup.zip"
    $extract = Join-Path $env:TEMP "nssm-extract"
    try {
        Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zip -TimeoutSec 60 -ErrorAction Stop
        Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
        Expand-Archive -Path $zip -DestinationPath $extract -Force
        $src = Get-ChildItem $extract -Recurse -Filter "nssm.exe" | Where-Object { $_.FullName -like "*win64*" } | Select-Object -First 1
        if (-not $src) { throw "nssm.exe not found in archive" }
        New-Item -ItemType Directory -Path (Split-Path $nssmExe) -Force | Out-Null
        Copy-Item $src.FullName $nssmExe -Force
    } finally {
        Remove-Item $zip, $extract -Recurse -Force -ErrorAction SilentlyContinue
    }
    Unblock-File $nssmExe -ErrorAction SilentlyContinue
}

# ---- Uninstall 分支 ----
if ($Uninstall) {
    Write-Host "卸载服务 $ServiceName ..."
    Invoke-Nssm stop $ServiceName | Out-Null
    Invoke-Nssm remove $ServiceName confirm | Out-Null
    sc.exe delete $ServiceName 2>$null | Out-Null
    Write-Host "服务已卸载。"
    exit 0
}

Ensure-Nssm
Unblock-File $nssmExe -ErrorAction SilentlyContinue

# ---- 建服务 ----
Invoke-Nssm stop $ServiceName | Out-Null
Invoke-Nssm remove $ServiceName confirm | Out-Null
sc.exe delete $ServiceName 2>$null | Out-Null
Start-Sleep -Seconds 1

$install = Invoke-Nssm install $ServiceName "powershell.exe"
if ($install.ExitCode -ne 0) { throw "nssm install failed: $($install.Output)" }

Invoke-Nssm set $ServiceName AppParameters "-NoProfile -ExecutionPolicy Bypass -File `"$ROOT\scripts\service\start-service.ps1`"" | Out-Null
Invoke-Nssm set $ServiceName AppDirectory $ROOT | Out-Null
Invoke-Nssm set $ServiceName DisplayName "SheetWise Backend" | Out-Null
Invoke-Nssm set $ServiceName Description "SheetWise Excel add-in backend (LLM proxy :8765, loopback only)" | Out-Null
Invoke-Nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
Invoke-Nssm set $ServiceName ObjectName LocalSystem | Out-Null
Invoke-Nssm set $ServiceName AppStdout "$logDir\service-stdout.log" | Out-Null
Invoke-Nssm set $ServiceName AppStderr "$logDir\service-stderr.log" | Out-Null
Invoke-Nssm set $ServiceName AppRotateFiles 1 | Out-Null
Invoke-Nssm set $ServiceName AppRotateBytes 10485760 | Out-Null
Invoke-Nssm set $ServiceName AppExit Default Restart | Out-Null
Invoke-Nssm set $ServiceName AppRestartDelay 5000 | Out-Null
Invoke-Nssm set $ServiceName AppThrottle 30000 | Out-Null

# ---- 注入 SHEETWISE_USER_HOME（Machine 级，start-service 里 server.py 读它）----
[Environment]::SetEnvironmentVariable("SHEETWISE_USER_HOME", $UserHome, "Machine")
Write-Host "SHEETWISE_USER_HOME=$UserHome（Machine 级已设置）"

Start-Service $ServiceName
Start-Sleep -Seconds 8
$svc = Get-Service $ServiceName
Write-Host "服务状态: $($svc.Status)"
if ($svc.Status -ne "Running") {
    Write-Warning "服务未 Running。查看 logs\service.log + backend-stderr.log 定位。"
    exit 1
}
Write-Host "安装完成。用 .\status-service.ps1 验证。"
```

- [ ] **Step 2: 语法检查**

Run: `powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('scripts/service/setup-service.ps1', [ref]\$null, [ref]\$null) | Out-Null; 'OK'"`
Expected: 输出 `OK`。

- [ ] **Step 3: 手动安装验证（需管理员，手动执行——plan 只给指令不代跑）**

Run（管理员 PowerShell，项目根）：
```powershell
.\scripts\service\setup-service.ps1 -UserHome C:\Users\<你的用户名>
```
Expected: 输出「服务状态: Running」；`Get-Service SheetWiseBackend` Running；`curl -sk https://localhost:8765/api/health` 返回 ok。

若已有旧服务残留，先 `.\scripts\service\setup-service.ps1 -Uninstall` 再装。

- [ ] **Step 4: 提交**

```bash
git add scripts/service/setup-service.ps1
git commit -m "feat(service): setup-service.ps1 NSSM 安装（下载/建服务/注入 UserHome/崩溃自愈）"
```

---

### Task 4: uninstall-service.ps1 + status-service.ps1

**Files:**
- Create: `scripts/service/uninstall-service.ps1`
- Create: `scripts/service/status-service.ps1`

**Interfaces:**
- Produces: 卸载（停+删服务、清 Machine env）；只读体检（服务状态 + 8765/8766 端口归属 + /api/health 裁决 OK/DEGRADED/DOWN + 最近错误日志）。
- Consumes: NSSM（uninstall）、`SHEETWISE_USER_HOME`（status 不读，无管理员场景保持只读）。

- [ ] **Step 1: 创建 uninstall-service.ps1**

创建 `scripts/service/uninstall-service.ps1`：

```powershell
# 卸载 SheetWiseBackend 服务（管理员）。
param([string]$ServiceName = "SheetWiseBackend")

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$ROOT = Split-Path -Parent $PSScriptRoot
$nssmExe = Join-Path $ROOT "scripts\service\nssm\nssm.exe"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    throw "需要管理员 PowerShell。"
}

$outFile = Join-Path $env:TEMP "nssm-out-$(Get-Random).txt"
$errFile = Join-Path $env:TEMP "nssm-err-$(Get-Random).txt"
function Invoke-Nssm {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    $p = Start-Process -FilePath $nssmExe -ArgumentList $Args -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    return @{ ExitCode = $p.ExitCode; Output = "$(Get-Content $outFile -Raw -ErrorAction SilentlyContinue)$(Get-Content $errFile -Raw -ErrorAction SilentlyContinue)" }
}
try {
    if (Test-Path $nssmExe) {
        Invoke-Nssm stop $ServiceName | Out-Null
        Invoke-Nssm remove $ServiceName confirm | Out-Null
    } else {
        sc.exe stop $ServiceName 2>$null | Out-Null
        sc.exe delete $ServiceName 2>$null | Out-Null
    }
    [Environment]::SetEnvironmentVariable("SHEETWISE_USER_HOME", $null, "Machine")
    Write-Host "服务 $ServiceName 已卸载，SHEETWISE_USER_HOME 已清除。"
} finally {
    Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
}
```

- [ ] **Step 2: 创建 status-service.ps1**

创建 `scripts/service/status-service.ps1`（只读、无需管理员，借鉴来源 status.ps1）：

```powershell
# status-service.ps1 — 只读体检。不停服务、不杀进程，不需要管理员。
param([int]$LogLines = 8)

$ErrorActionPreference = "Continue"
$ROOT = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $ROOT "scripts\service\logs"

function Write-Section([string]$Title) { Write-Host "`n=== $Title ===" }

# 端口归属：用 netstat（避 WMI 间歇失败，见 service-deployment.md §1.4）
function Get-PortListeners([int]$Port) {
    netstat -ano | Select-String "LISTENING" | ForEach-Object {
        $line = $_.Line
        if ($line -notmatch (":$Port\s")) { return }
        if ($line -notmatch "\s+(\d+)\s*$") { return }
        [pscustomobject]@{ Pid = [int]$Matches[1] }
    }
}

Write-Section "Service"
$svc = $null
try { $svc = Get-Service -Name "SheetWiseBackend" -ErrorAction Stop } catch { Write-Host "  (cannot query service)" }
if ($svc) { Write-Host ("  {0,-10} {1}" -f "Status:", $svc.Status) }

Write-Section "Ports"
$up82 = @(Get-PortListeners 8765).Count -gt 0
$up86 = @(Get-PortListeners 8766).Count -gt 0
Write-Host ("  {0}  :8765  backend" -f $(if ($up82) { "UP  " } else { "DOWN" }))
Write-Host ("  {0}  :8766  ingest"  -f $(if ($up86) { "UP  " } else { "DOWN" }))

Write-Section "HTTP health"
# 自签证书：Invoke-WebRequest 难跳过校验，用 curl.exe -k（借鉴来源）
$code = & curl.exe -sk --max-time 8 -o NUL -w "%{http_code}" "https://localhost:8765/api/health"
$ok = ($code -eq "200")
Write-Host ("  /api/health  {0}  (HTTP {1})" -f $(if ($ok) { "OK" } else { "FAIL" }), $code)

Write-Section "Recent errors"
foreach ($f in @("service.log", "backend-stderr.log")) {
    $path = Join-Path $logDir $f
    if (-not (Test-Path $path)) { Write-Host "  -- $f -- (missing)"; continue }
    $hits = @(Get-Content $path -Tail 300 -ErrorAction SilentlyContinue |
        Where-Object { $_ -match "ERROR|Error|failed|Traceback|Exception" } |
        Select-Object -Last $LogLines)
    Write-Host "  -- $f --"
    if ($hits) { $hits | ForEach-Object { Write-Host "    $_" } } else { Write-Host "    (no errors)" }
}

Write-Section "Verdict"
if ($up82 -and $ok)      { Write-Host "  OK" }
elseif ($svc -and $svc.Status -eq "Running" -and -not $up82) { Write-Host "  DEGRADED — 服务 Running 但 8765 无人听（可能是分脑/崩溃自愈中）" }
else                     { Write-Host "  DOWN — 后端不可用。管理员: .\setup-service.ps1 或重启服务" }
```

- [ ] **Step 3: 语法检查（两个文件）**

Run: `powershell -NoProfile -Command "foreach($f in @('scripts/service/uninstall-service.ps1','scripts/service/status-service.ps1')){[System.Management.Automation.Language.Parser]::ParseFile($f,[ref]\$null,[ref]\$null)|Out-Null}; 'OK'"`
Expected: `OK`。

- [ ] **Step 4: 手动验证 status（无管理员，直接跑）**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/service/status-service.ps1`
Expected: 服务 Running + 8765 UP + `/api/health OK` → 输出 `OK`；卸载场景输出 `DOWN` 合理。

- [ ] **Step 5: 手动验证 uninstall（管理员，手动执行）**

Run: `.\scripts\service\setup-service.ps1 -Uninstall`（或 `uninstall-service.ps1`）
Expected: 服务消失，`status-service.ps1` 输出 DOWN，8765 释放。

- [ ] **Step 6: 提交**

```bash
git add scripts/service/uninstall-service.ps1 scripts/service/status-service.ps1
git commit -m "feat(service): uninstall-service.ps1 + status-service.ps1（只读体检 OK/DEGRADED/DOWN）"
```

---

### Task 5: 配套文档 + 提交收尾

**Files:**
- Modify: `docs/document-usage.md`（挂 service-deployment 行）
- Modify: `install.bat`（加「可选：安装为后台服务」提示，执行 setup-service.ps1 需管理员——只加说明/调用，不改既有流程）

**Interfaces:**
- Consumes: 前面 Task 产物。文档挂进消费链；install.bat 只加可选分支。

- [ ] **Step 1: 挂文档消费链**

在 `docs/document-usage.md` 的 C 段（`docs/migration.md` 行之后）加一行：

```markdown
| `docs/service-deployment.md` | 人 · Codex · Claude | 服务化部署（借鉴 ClaudeOfficeGateway + 本项目落地映射；实施以 spec/plan 为准） |
```

- [ ] **Step 2: install.bat 加可选服务安装提示**

在 `install.bat` 的结束段（「安装完成！」区块前）加：

```bat
echo.
echo 可选：把后端装成 Windows 服务（后台常驻、开机自启，Excel 直连不用开黑框）：
echo   管理员 PowerShell 运行：scripts\service\setup-service.ps1 -UserHome C:\Users\你的用户名
echo   只读体检：scripts\service\status-service.ps1
echo.
```

- [ ] **Step 3: 提交**

```bash
git add docs/document-usage.md install.bat
git commit -m "docs(service): 挂 service-deployment 消费链 + install.bat 可选服务安装提示"
```

---

## 收尾

全部 5 个任务完成后：

1. Run: `cd backend && python -m pytest tests/test_config_store.py -v` → 两个 PASS。
2. Run: 三个 ps1 语法检查 → 全 `OK`。
3. 手动端到端（管理员）：
   - `.\scripts\service\setup-service.ps1 -UserHome C:\Users\<你的用户名>` → Running
   - `.\scripts\service\status-service.ps1` → OK
   - 杀 uvicorn 进程（模拟崩溃）→ 等 ~10 秒 → 服务自愈回 Running、8765 可连（验证 AppExit Restart）
   - **CONFIG_DIR 验证**：确认服务模式下 `config.json` 落在 `-UserHome/.claude-excel-web/`（不是 systemprofile），且已有配置/知识库可见
   - Excel 开插件直连 `https://localhost:8765`，不跑 launch.bat
4. 全部通过后：按 `docs/coordination.md`，实现已完成，review 交给 Claude 对照 plan 逐粒核对（Codex 只实现、不自行 review）。