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
