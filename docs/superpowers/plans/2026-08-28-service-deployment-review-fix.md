# 服务化部署 review 修正计划（2026-08-28）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复合入 master 的服务化部署实现（`8a6b1f9`，特性 commit `e6c3983` `522d7a2`）中 review 发现的缺陷——四个 `scripts/service/*.ps1` 的路径定位 off-by-one、NSSM 深坑规避未落地（`2>&1`、缺 Unblock-File 自愈、缺 NSSM 下载）、健康检查退回进程名判定、证书续期缺失、互斥锁失效、nssm install 参数串错。

**Architecture:** 本次是**修正**已合入 master 的 `docs/superpowers/plans/2026-08-26-service-deployment.md` 计划产物的 review 发现。修复完成后服务化逻辑应达到 plan 原意：NSSM 包装 `start-service.ps1` 成 Windows 服务（LocalSystem），崩溃自愈（AppExit Restart + AppRestartDelay 5000 + AppThrottle 30000），健康检查按**端口归属 + 自起时间**（连续 3 miss 判不健康），单实例互斥锁有效，证书自检带过期续期（失败不阻塞回退 http）。

**Tech Stack:** PowerShell 7（ps1）+ NSSM + Python uvicorn（`backend/server.py`）。无新 Python 依赖。

**Spec:** `docs/superpowers/specs/2026-08-26-service-deployment-design.md`（规范约束来源）；参考 `docs/service-deployment.md` §1.2/§1.4/§1.5（NSSM 深坑规避、端口归属健康检查、单实例互斥锁的已验证解法）。原实现 plan：`docs/superpowers/plans/2026-08-26-service-deployment.md`。

## Global Constraints

- **只绑 127.0.0.1**：host="127.0.0.1" 不变，禁止 0.0.0.0。
- **项目根定位正确**：`$ROOT` 必须解析到项目根（`<repo>/`），不是 `scripts/`。当前代码（`Split-Path $MyInvocation.MyCommand.Path` → `scripts/service`，再 `Split-Path` → `scripts`）是 **off-by-one**，`$BACKEND_DIR` 变成了不存在的 `scripts/backend`。修正用：`$ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)`（`$PSScriptRoot`=`scripts/service`，两跳到达项目根）。四个脚本同改。⚠️ 注意：原 plan 的 `$ROOT = Split-Path -Parent $PSScriptRoot` 注释"`scripts/service` → 项目根"**也是错的**（`-Parent` 一次只到 `scripts`），不要照抄原 plan 那行。
- **NSSM 深坑规避（全部强制）**：
  - `$PSNativeCommandUseErrorActionPreference = $false`
  - 原生命令（pip/sc/nssm/openssl/curl）一律 `Start-Process -RedirectStandardOutput/Error`，**禁止 `2>&1`**（PS 把原生命令 stderr 当 ErrorRecord）。
  - 下载的 nssm.exe 必须 `Unblock-File`，且每次跑都幂等 Unblock。
- **健康检查按端口归属 + 自起时间，不查 PID 存活**：`Test-PortOwnedBySelf` 用 `Get-NetTCPConnection` 拿 OwningProcess → `Get-Process` StartTime `>= $script:StartedAt`（区分"我起的" vs 残留孤儿）。**不用 WMI**（`Get-CimInstance` 本机间歇静默失败）。连续 3 miss 才判不健康 → exit 1。
- **单实例互斥锁有效**：`New Object Mutex($false, "Global\SheetWiseBackend_start_ps1")` + `WaitOne(0)`，拿不到立刻退出并 Release。禁止用 `OpenExisting`+catch-`New`（两实例并发会各自 New 新锁，互斥失效；且当前代码 New 后从不 Release，锁残留导致服务重启永远误判"已运行"）。正确处理 AbandonedMutexException（置为已获取）。
- 脚本需管理员：`setup-service.ps1` / `uninstall-service.ps1`；`status-service.ps1` 只读无需管理员。
- 测试以手动/状态裁决为主（仓库无 ps1 测试设施），每 Task 附一条可执行的验证命令。
- **只改 `scripts/service/*.ps1` 与 `docs/service-deployment.md`（若改文档）**。不碰 `backend/config_store.py`（已正确支持 `SHEETWISE_USER_HOME`）、`backend/server.py`、`install.bat`、`docs/document-usage.md`（migration 行已恢复——见 Task 5）。

---

### Task 1: 修正 start-service.ps1（路径 + 互斥锁 + 证书续期 + 健康检查 + 残留清理）

**Files:**
- Modify: `scripts/service/start-service.ps1`（整文件重写为 97 行以下，见下方目标代码）

**Interfaces:**
- Produces: 服务入口（NSSM 拉起）。`Start-Service` 入口环境含 `SHEETWISE_USER_HOME`（setup 注入）。`$ROOT` 正确指向项目根。
- Consumes: `backend/server.py`（uvicorn :8765）、`backend/cert.pem`+`key.pem`、`npx office-addin-dev-certs`（证书重生成）。

**现状缺陷（对照代码行号）：**
1. `$SCRIPT_DIR`/`$REPO_ROOT` off-by-one（[start-service.ps1:17-19](scripts/service/start-service.ps1#L17-L19)）→ `$BACKEND_DIR` = `scripts\backend` 不存在 → uvicorn `-WorkingDirectory` 失败。
2. 互斥锁用 `OpenExisting`+catch-`New`（[start-service.ps1:8-14](scripts/service/start-service.ps1#L8-L14)）→ 并发双启互斥失效；且 New 后正常路径不 Release，锁残留。
3. 证书只查存在性（[start-service.ps1:30](scripts/service/start-service.ps1#L30)），不查有效期 <7 天；用 `openssl req` 而非 `npx office-addin-dev-certs`，失败 `exit 1` 阻塞（spec 要求失败不阻塞回退 http）。
4. 残留清理杀所有 `python*server.py*`（[start-service.ps1:40](scripts/service/start-service.ps1#L40)），误杀手动 launch.bat 实例（应只杀占 8765/8766 的）。
5. 健康检查 `-eq "python"` 进程名判定（[start-service.ps1:65-70](scripts/service/start-service.ps1#L65-L70)），非端口归属 + 自起时间。
6. stderr 用 `2>&1`（[start-service.ps1:32](scripts/service/start-service.ps1#L32)），违反深坑规避。

- [ ] **Step 1: 重写脚本** — 将 `scripts/service/start-service.ps1` 整体替换为（目标代码，已修全部缺陷；`$script:StartedAt` 必须在清残留前记录，用于区分"我起的"）：

```powershell
# start-service.ps1 — 服务模式启动 backend（由 NSSM 调用）
# 必填 env: SHEETWISE_USER_HOME（真实用户目录）
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false   # NSSM 深坑 §1.2

$ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # scripts/service → 项目根（两跳）
$logDir = Join-Path $ROOT "scripts\service\logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-SvcLog {
    param([string]$msg, [string]$Severity = "Info")
    "$(Get-Date -Format u) [$Severity] $msg" | Out-File -FilePath (Join-Path $logDir "service.log") -Append -Encoding utf8
}

# ---- 单实例互斥锁（防双启分脑，§1.5）：New + WaitOne(0)，拿不到立刻退出 ----
$mutex = New-Object System.Threading.Mutex($false, "Global\SheetWiseBackend_start_ps1")
$acquired = $false
try { $acquired = $mutex.WaitOne(0) }
catch [System.Threading.AbandonedMutexException] { $acquired = $true }
if (-not $acquired) {
    Write-SvcLog "Another start-service instance holds the mutex — exiting" "WARN"
    exit 0
}

# 记录本实例开始时刻，用于 Test-PortOwnedBySelf（区分"我起的" vs 残留孤儿）
$script:StartedAt = Get-Date

# ---- 证书自检（存在且有效期 >=7 天才算新鲜；NSSM 自愈重启时自动续期）----
$certFile = Join-Path $ROOT "backend\cert.pem"
$keyFile  = Join-Path $ROOT "backend\key.pem"
function Test-CertFresh {
    if (-not (Test-Path $certFile) -or -not (Test-Path $keyFile)) { return $false }
    $inner = "try{`$c=[System.Security.Cryptography.X509Certificates.X509Certificate2]::new('$certFile');`$ch=New-Object System.Security.Cryptography.X509Certificates.X509Chain;`$ch.ChainPolicy.RevocationMode='NoCheck';`$ok=`$ch.Build(`$c);if(`$ok -and `$c.NotAfter -gt (Get-Date).AddDays(7)){'YES'}}catch{}"
    $r = & powershell.exe -NoProfile -Command $inner
    return ($r -match "YES")
}
if (-not (Test-CertFresh)) {
    Write-SvcLog "Certificate missing/expiring — regenerating..." "WARN"
    Push-Location (Join-Path $ROOT "addin")
    # 失败不阻塞：server.py 无证书时回退 http:8765（spec §3.3）
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

# ---- 健康检查：按端口归属 + 自起时间（§1.4），不用 WMI ----
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

# ---- 残留清理：只杀占 8765/8766 的进程（不含手动 launch.bat 的其它 python）----
Write-SvcLog "Cleaning stale listeners on 8765/8766..."
foreach ($port in 8765, 8766) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 1

# ---- 起 uvicorn（后台隐藏；避 PS stderr 用 Redirect，不 2>&1）----
Write-SvcLog "Starting uvicorn :8765..."
$stdoutLog = Join-Path $logDir "backend-stdout.log"
$stderrLog = Join-Path $logDir "backend-stderr.log"
$proc = Start-Process -FilePath (Get-Command python).Source `
    -ArgumentList (Join-Path $ROOT "backend\server.py") `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
Write-SvcLog "uvicorn PID=$($proc.Id)"

# ---- 健康循环：连续 3 miss 才不健康（NSSM 自愈）----
$maxMiss = 3
$misses  = 0
try {
    while ($true) {
        Start-Sleep -Seconds 5
        if (Test-PortOwnedBySelf -Port 8765) { $misses = 0 }
        else {
            $misses++
            Write-SvcLog "8765 not owned by our own process tree (miss $misses/$maxMiss)" "WARN"
        }
        if ($misses -ge $maxMiss) {
            Write-SvcLog "Unhealthy: :8765 not served by our process — exiting for SCM restart" "ERROR"
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

- [ ] **Step 2: 语法检查** — `powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('scripts/service/start-service.ps1', [ref]$null, [ref]$null) | Out-Null; 'OK'"`
  Expected: `OK`。
- [ ] **Step 3: 冒烟跑（不装服务）** — `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/service/start-service.ps1`（前台 15 秒后 Ctrl+C）
  Expected: `scripts/service/logs/service.log` 出现「Starting uvicorn :8765」；证书存在时 `curl -sk https://localhost:8765/api/health` 返回 ok；Ctrl+C 后 8765/8766 释放、锁释放（再跑一次能正常拿锁）。若第二次跑立即出现「Another instance holds the mutex」且 Ctrl+C 后仍如此 → 锁未释放，报错。
- [ ] **Step 4: 提交** —
  `git add scripts/service/start-service.ps1 && git commit -m "fix(service): start-service.ps1 路径定位/互斥锁/证书续期/端口归属健康检查修正"`

---

### Task 2: 修正 setup-service.ps1（NSSM 深坑 + 下载自愈 + 完整 NSSM 配置 + 正确的 install 参数）

**Files:**
- Modify: `scripts/service/setup-service.ps1`

**Interfaces:**
- Produces: Windows 服务 `SheetWiseBackend`（NSSM），`SHEETWISE_USER_HOME` 环境注入，NSSM 下载自愈（`scripts/service/nssm/nssm.exe`）。
- Consumes: `start-service.ps1`、`Invoke-Nssm` 内部函数、`Ensure-Nssm`（下载 + Unblock-File）、`SHEETWISE_USER_HOME`。

**现状缺陷（对照代码）：**
1. 找不到 nssm.exe 直接 `exit` 让用户手装（[setup-service.ps1:58-63](scripts/service/setup-service.ps1#L58-L63)），不自愈。而「下载 NSSM」块（:110-130）是死代码：检查失败已 exit，且下载到 `$env:TEMP\nssm.exe` 与 PATH 无关，从不被使用。
2. `nssm install` 参数串错（[setup-service.ps1:90-94](scripts/service/setup-service.ps1#L90-L94)）：把 `-RedirectStandardOutput/Error $log` 作为 `powershell.exe` 参数传给 NSSM，那是 `Start-Process` 的参数，不是 powershell.exe 的开关 → 服务命令行参数绑定失败。应照 plan 用 `nssm set AppParameters "-NoProfile -ExecutionPolicy Bypass -File <path>"`。
3. 未设 `ObjectName LocalSystem`、`DisplayName "SheetWise Backend"`、`AppStdout/AppStderr`、`AppRotateFiles 1` + `AppRotateBytes 10485760`（spec §3.2 硬要求）。
4. 未设 Machine 级 `SHEETWISE_USER_HOME`（[setup-service.ps1:102](scripts/service/setup-service.ps1#L102) 只 `nssm set AppEnvironment`，未同时设 Machine 级）。
5. 卸载分支删 `.claude-excel-web\logs`（[setup-service.ps1:48-51](scripts/service/setup-service.ps1#L48-L51)，范围外）、用 `2>&1`、未清 Machine env。
6. `$REPO_ROOT` off-by-one（[setup-service.ps1:35-36](scripts/service/setup-service.ps1#L35-L36)）。

- [ ] **Step 1: 重写脚本** — 将 `scripts/service/setup-service.ps1` 整体替换为（目标代码，全修；`-UserHome` 必填校验 + 探测 `C:\Users` 逻辑与 plan 一致）：

```powershell
# setup-service.ps1 — 一次性：把后端 :8765 装成 Windows 服务（NSSM 包装 start-service.ps1）。
# 借鉴 C:\ClaudeOfficeGateway\setup-service.ps1 的 NSSM 模式与坑（见 docs/service-deployment.md）。
param(
    [switch]$Uninstall,
    [string]$UserHome,          # 服务模式下真实用户目录（必填；LocalSystem 自己解析 ~ 会跑偏）
    [string]$ServiceName = "SheetWiseBackend"
)
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false   # 深坑 §1.2

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    throw "需要管理员 PowerShell（右键 → 以管理员身份运行）。创建/删除 Windows 服务必须提升权限。"
}

$ROOT    = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # 项目根（两跳）
$service = "scripts\service"
$logDir  = Join-Path $ROOT "$service\logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

# ---- UserHome 校验/探测（卸载模式不需要）----
if (-not $Uninstall) {
    if (-not $UserHome) {
        $userHomes = @(Get-ChildItem C:\Users -Directory | Where-Object { $_.Name -notmatch '^(Public|Default|Default User)$' })
        if ($userHomes.Count -eq 1) { $UserHome = $userHomes[0].FullName }
        else { throw "无法唯一判断用户目录。请显式传入 -UserHome，例如：.\setup-service.ps1 -UserHome C:\Users\你的用户名" }
    }
}
if (-not $UserHome) { throw "参数错误：-UserHome 必填（服务以 LocalSystem 跑，必须指向真实用户目录）" }
Write-Host "UserHome = $UserHome"

# ---- Invoke-Nssm：Start-Process + Redirect 绕开 PS stderr 深坑（§1.2），幂等 ----
function Invoke-Nssm {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    $outFile = Join-Path $env:TEMP "nssm-out-$(Get-Random).txt"
    $errFile = Join-Path $env:TEMP "nssm-err-$(Get-Random).txt"
    try {
        $p = Start-Process -FilePath $nssmExe -ArgumentList $Args -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $outFile -RedirectStandardError $errFile
        return @{ ExitCode = $p.ExitCode; Output = "$(Get-Content $outFile -Raw -ErrorAction SilentlyContinue)$(Get-Content $errFile -Raw -ErrorAction SilentlyContinue)" }
    } finally { Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue }
}

# ---- Ensure-Nssm：下载到 scripts/service/nssm/nssm.exe + Unblock-File（MOTW 阻碍执行，§1.2）----
$nssmExe = Join-Path $ROOT "$service\nssm\nssm.exe"
function Ensure-Nssm {
    if (Test-Path $nssmExe) { Unblock-File $nssmExe -ErrorAction SilentlyContinue; return }
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
    } finally { Remove-Item $zip, $extract -Recurse -Force -ErrorAction SilentlyContinue }
    Unblock-File $nssmExe -ErrorAction SilentlyContinue
}

# ---- Uninstall 分支：停+删服务、清 Machine env、删日志（范围=plan：停/删/清 env）----
if ($Uninstall) {
    Write-Host "卸载服务 $ServiceName ..."
    Invoke-Nssm stop $ServiceName | Out-Null
    Invoke-Nssm remove $ServiceName confirm | Out-Null
    sc.exe delete $ServiceName 2>$null | Out-Null
    [Environment]::SetEnvironmentVariable("SHEETWISE_USER_HOME", $null, "Machine")
    Write-Host "服务已卸载，SHEETWISE_USER_HOME 已清除。"
    exit 0
}

Ensure-Nssm
Unblock-File $nssmExe -ErrorAction SilentlyContinue

# ---- 建服务（先清残留，幂等）----
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

- [ ] **Step 2: 语法检查** — `powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('scripts/service/setup-service.ps1', [ref]$null, [ref]$null) | Out-Null; 'OK'"`
  Expected: `OK`。
- [ ] **Step 3: 手动安装验证（需管理员，手动执行——给指令但不代跑）** — 管理员 PowerShell，项目根：
  `.\scripts\service\setup-service.ps1 -UserHome C:\Users\<你的用户名>`
  Expected: 输出「服务状态: Running」；`Get-Service SheetWiseBackend` Running；`curl -sk https://localhost:8765/api/health` 返回 ok。特别验证：`sc.exe qc SheetWiseBackend` 显示 `SERVICE_NAME`、`BINARY_PATH_NAME` 含 `start-service.ps1`、`SERVICE_START_NAME: LocalSystem`、`DisplayName` 为 `SheetWise Backend`（若无这些 → 报错，禁止声称成功）。
  若已有旧服务残留，先 `.\scripts\service\setup-service.ps1 -Uninstall` 再装。
- [ ] **Step 4: 提交** —
  `git add scripts/service/setup-service.ps1 && git commit -m "fix(service): setup-service.ps1 NSSM 下载自愈/完整配置/install 参数修正"`

---

### Task 3: 修正 uninstall-service.ps1 + status-service.ps1（深坑/范围/命令用对）

**Files:**
- Modify: `scripts/service/uninstall-service.ps1`
- Modify: `scripts/service/status-service.ps1`

**现状缺陷（对照代码）：**
1. uninstall 用 `& nssm ... 2>&1`（[uninstall-service.ps1:25-30](scripts/service/uninstall-service.ps1#L25-L30)）违反深坑规避；且清 `.claude-excel-web\logs`（:33-37）是范围外。
2. uninstall 未清 Machine 级 `SHEETWISE_USER_HOME`（plan Task4/原设计要求「卸载清 Machine env」）。
3. status-service 用 `Get-NetTCPConnection`（[status-service.ps1:16-19](scripts/service/status-service.ps1#L16-L19)）而非 plan 要求的 `netstat -ano`（来源验证过 Get-NetTCPConnection 也可能被系统影响；plan Task4 明确用 netstat，避开 WMI 同类的不可靠路径）；`$REPO_ROOT` off-by-one（:11-13）。

- [ ] **Step 1: 重写 uninstall-service.ps1** —

```powershell
<#
.SYNOPSIS
    卸载 SheetWiseBackend 服务（管理员）。
.DESCRIPTION
    停止并删除 Windows 服务，清除 Machine 级 SHEETWISE_USER_HOME 环境变量。
#>
param([string]$ServiceName = "SheetWiseBackend")
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # 项目根（两跳）

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    throw "需要管理员 PowerShell。"
}

$nssmExe = Join-Path $ROOT "scripts\service\nssm\nssm.exe"
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

- [ ] **Step 2: 重写 status-service.ps1** — 端口归属改用 `netstat -ano`（plan Task4），`$REPO_ROOT` 两跳修正：

```powershell
<#
.SYNOPSIS
    SheetWise 服务状态检查（只读、无需管理员）。
.DESCRIPTION
    检查服务状态、8765/8766 端口归属（netstat -ano，避 WMI 同类的不可靠路径）、
    /api/health，输出 OK / DEGRADED / DOWN + 最近错误日志。
#>
param([int]$LogLines = 8)
$ErrorActionPreference = "Continue"
$ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # 项目根（两跳）
$logDir = Join-Path $ROOT "scripts\service\logs"

function Write-Section([string]$Title) { Write-Host "`n=== $Title ===" }

# 端口归属：用 netstat（避 WMI，见 service-deployment.md §1.4）
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
# 自签证书：curl.exe -k（借鉴来源）
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

- [ ] **Step 3: 语法检查（两个文件）** — `powershell -NoProfile -Command "foreach($f in @('scripts/service/uninstall-service.ps1','scripts/service/status-service.ps1')){[System.Management.Automation.Language.Parser]::ParseFile($f,[ref]$null,[ref]$null)|Out-Null}; 'OK'"`
  Expected: `OK`。
- [ ] **Step 4: 手动验证 status（无管理员，直接跑）** — `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/service/status-service.ps1`
  Expected: 服务 Running + 8765 UP + `/api/health OK` → 输出 `OK`。
- [ ] **Step 5: 手动验证 uninstall（管理员）** — `.\\scripts\\service\\uninstall-service.ps1`
  Expected: 服务消失、8765/8766 释放、Machine env `SHEETWISE_USER_HOME` 已清（`[Environment]::GetEnvironmentVariable('SHEETWISE_USER_HOME','Machine')` 为 $null）。
- [ ] **Step 6: 提交** —
  `git add scripts/service/uninstall-service.ps1 scripts/service/status-service.ps1 && git commit -m "fix(service): uninstall/status 深坑规避+范围收敛+netstat 端口归属"`

---

### Task 4: 文档同步（service-deployment.md 修正 off-by-one 注释 + 清理占位）

**Files:**
- Modify: `docs/service-deployment.md`

**现状缺陷：** [service-deployment.md](docs/service-deployment.md#L101) 残留 `EXCEL_ADDIN_USER_HOME`（实际实现统一用 `SHEETWISE_USER_HOME`）——文档与代码不一致，违反「单一真相」纪律。

- [ ] **Step 1: 修正** — 将 `service-deployment.md` 中 `EXCEL_ADDIN_USER_HOME` 改为 `SHEETWISE_USER_HOME`（保持与 config_store.py / setup / start 三处一致）。
- [ ] **Step 2: 提交** —
  `git add docs/service-deployment.md && git commit -m "docs(service): service-deployment.md 环境变量名统一为 SHEETWISE_USER_HOME"`

---

## 收尾

全部 4 个任务完成后：

1. Run: 三个语法检查（Task1-3 的 Step2/Step3）→ 全 `OK`。
2. Run: `cd backend && python -m pytest tests/test_config_store.py -v` → 两个 PASS（确认未碰 config_store.py，行为不变）。
3. 手动端到端（管理员）：
   - `.\\scripts\\service\\setup-service.ps1 -UserHome C:\\Users\\<你的用户名>` → Running，`sc.exe qc SheetWiseBackend` 显示 LocalSystem + DisplayName "SheetWise Backend" + start-service.ps1 路径
   - `.\\scripts\\service\\status-service.ps1` → OK
   - 杀 uvicorn 进程（模拟崩溃）→ 等 ~10 秒 → 服务自愈回 Running、8765 可连
   - 并发验证互斥锁：服务运行时再跑一次 `start-service.ps1` → 日志出现「Another instance holds the mutex」立即退出
   - **CONFIG_DIR 验证**：确认服务模式下 `config.json` 落在 `-UserHome/.claude-excel-web/`（不是 systemprofile），且已有配置/知识库可见
   - Excel 开插件直连 `https://localhost:8765`，不跑 launch.bat
4. 全部通过后：按 `docs/coordination.md`，修正完成，review 交给 Claude 对照本 plan 逐粒核对（Codex 只实现、不自行 review）。