<#
.SYNOPSIS
    SheetWise 服务状态检查（无需管理员权限）

.DESCRIPTION
    检查服务运行状态、端口占用、HTTP 健康端点，输出 OK/DEGRADED/DOWN 状态
#>

$PSNativeCommandUseErrorActionPreference = $false

$SCRIPT_DIR = Split-Path $MyInvocation.MyCommand.Path
$REPO_ROOT = Split-Path $SCRIPT_DIR
$logDir = Join-Path $REPO_ROOT ".claude-excel-web\logs"
$LogLines = 5

function Get-PortListeners($port) {
    Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | 
    Where-Object { $_.State -eq "Listen" -or $_.State -eq "Established" }
}

function Write-Section($title) {
    Write-Host ""
    Write-Host $title -ForegroundColor Cyan
}

Write-Host "SheetWise 服务状态检查"

# 服务状态
Write-Section "服务"
try {
    $svc = Get-Service -Name "SheetWiseBackend" -ErrorAction SilentlyContinue
    if ($svc) { 
        Write-Host ("  {0,-10} {1}" -f "Status:", $svc.Status) 
    } else {
        Write-Host "  Status: (服务未安装)"
    }
} catch {
    Write-Host "  Status: (cannot query service)"
}

# 端口检查
Write-Section "端口"
$up82 = @(Get-PortListeners 8765).Count -gt 0
$up86 = @(Get-PortListeners 8766).Count -gt 0
Write-Host ("  {0}  :8765  backend" -f $(if ($up82) { "UP  " } else { "DOWN" }))
Write-Host ("  {0}  :8766  ingest"  -f $(if ($up86) { "UP  " } else { "DOWN" }))

# HTTP 健康检查
Write-Section "HTTP 健康"
# 自签证书：用 curl.exe -k（借鉴来源）
$code = & curl.exe -sk --max-time 8 -o NUL -w "%{http_code}" "https://localhost:8765/api/health" 2>&1
$ok = ($code -eq "200")
Write-Host ("  /api/health  {0}  (HTTP {1})" -f $(if ($ok) { "OK" } else { "FAIL" }), $code)

# 错误日志
Write-Section "最近错误"
foreach ($f in @("service.log", "backend-stderr.log")) {
    $path = Join-Path $logDir $f
    if (-not (Test-Path $path)) { Write-Host "  -- $f -- (missing)"; continue }
    $hits = @(Get-Content $path -Tail 300 -ErrorAction SilentlyContinue |
        Where-Object { $_ -match "ERROR|Error|failed|Traceback|Exception" } |
        Select-Object -Last $LogLines)
    Write-Host "  -- $f --"
    if ($hits) { $hits | ForEach-Object { Write-Host "    $_" } } else { Write-Host "    (no errors)" }
}

# 最终判定
Write-Section "判定"
if ($up82 -and $ok)      { Write-Host "  OK" -ForegroundColor Green }
elseif ($svc -and $svc.Status -eq "Running" -and -not $up82) { 
    Write-Host "  DEGRADED — 服务 Running 但 8765 无人听（可能是分脑/崩溃自愈中）" -ForegroundColor Yellow 
} else { 
    Write-Host "  DOWN — 后端不可用。管理员: .\setup-service.ps1 或重启服务" -ForegroundColor Red 
}