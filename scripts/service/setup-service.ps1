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

Ensure-PythonEnv

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
