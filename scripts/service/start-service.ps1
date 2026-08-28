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
