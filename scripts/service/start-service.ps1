# start-service.ps1 — 服务模式启动 backend（由 NSSM 调用）
# 必填 env: SHEETWISE_USER_HOME（真实用户目录）

$PSNativeCommandUseErrorActionPreference = $false  # 避免 nssm/uvicorn 原生命令抛异常

# 1. 单实例互斥锁
$mutexName = "Global\SheetWiseBackend_start_ps1"
try {
    $mutex = [System.Threading.Mutex]::OpenExisting($mutexName)
    Write-Host "ERROR: 另一个 start-service.ps1 正在运行"
    exit 1
} catch {
    $mutex = [System.Threading.Mutex]::New($false, $mutexName)
}

# 2. 工作目录定位
$SCRIPT_DIR = Split-Path $MyInvocation.MyCommand.Path
$REPO_ROOT = Split-Path $SCRIPT_DIR
$BACKEND_DIR = Join-Path $REPO_ROOT "backend"
$LOG_DIR = Join-Path $REPO_ROOT ".claude-excel-web\logs"

# 3. 日志目录
if (-not (Test-Path $LOG_DIR)) {
    New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null
}

# 4. 证书自检（过期重生成）
$CERT = Join-Path $BACKEND_DIR "cert.pem"
$KEY = Join-Path $BACKEND_DIR "key.pem"
if (-not (Test-Path $CERT) -or -not (Test-Path $KEY)) {
    Write-Host "证书缺失，生成中..."
    & openssl req -x509 -newkey rsa:2048 -keyout $KEY -out $CERT -days 365 -nodes -subj "/CN=localhost" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: 证书生成失败"
        exit 1
    }
}

# 5. 残余清理（僵死 uvicorn 进程）
Get-Process | Where-Object { $_.ProcessName -eq "python" -and $_.CommandLine -like "*server.py*" } | Stop-Process -Force

# 6. 注入 SHEETWISE_USER_HOME 并起 uvicorn
$UserHome = $env:SHEETWISE_USER_HOME
if (-not $UserHome) {
    Write-Host "ERROR: SHEETWISE_USER_HOME 未设置"
    exit 1
}

$Env:SHEETWISE_USER_HOME = $UserHome

# 设置 PATH 为后端目录，确保导入本地模块正确
$Env:PYTHONPATH = $BACKEND_DIR

$UVICORN_LOG = Join-Path $LOG_DIR "backend-stderr.log"

# 启动 uvicorn（绑定 127.0.0.1:8765）
Start-Process python `
    -ArgumentList "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8765", "--ssl-keyfile", $KEY, "--ssl-certfile", $CERT `
    -WorkingDirectory $BACKEND_DIR `
    -RedirectStandardOutput $UVICORN_LOG `
    -RedirectStandardError $UVICORN_LOG `
    -NoNewWindow

# 7. 健康检查循环（按端口归属，不查 PID 存活）
function Test-PortOwnedBySelf($port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if (-not $conn) { return $false }
        $process = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        return $process -and $process.ProcessName -eq "python"
    } catch {
        return $false
    }
}

$missCount = 0
$healthyThreshold = 3

while ($true) {
    Start-Sleep -Seconds 5
    
    $up = Test-PortOwnedBySelf 8765
    if ($up) {
        $missCount = 0
        continue
    }
    
    $missCount++
    Write-Host "端口 8765 无人听 ($missCount/$healthyThreshold)"
    
    if ($missCount -ge $healthyThreshold) {
        Write-Host "健康检查失败，退出让 NSSM 重启"
        $mutex.ReleaseMutex()
        $mutex.Dispose()
        exit 1
    }
}