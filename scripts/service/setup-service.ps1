<#
.SYNOPSIS
    安装 SheetWise 为 Windows 服务

.PARAMETER UserHome
    真实用户目录（必填）：服务模式下 Path.home() 会解析到 systemprofile，
    必须通过 SHEETWISE_USER_HOME 环境变量注入真实用户目录。

.PARAMETER Uninstall
    卸载服务
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$UserHome,

    [switch]$Uninstall
)

$PSNativeCommandUseErrorActionPreference = $false

# 验证管理员权限
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: 此脚本需要管理员权限"
    exit 1
}

# 验证用户目录
if (-not (Test-Path $UserHome)) {
    Write-Host "ERROR: 用户目录不存在: $UserHome"
    exit 1
}

$SCRIPT_DIR = Split-Path $MyInvocation.MyCommand.Path
$REPO_ROOT = Split-Path $SCRIPT_DIR

if ($Uninstall) {
    # 卸载服务
    Write-Host "卸载 SheetWise 服务..."
    
    # 停止并删除服务
    & nssm stop SheetWiseBackend 2>&1 | Out-Null
    Start-Sleep -Seconds 1
    & nssm remove SheetWiseBackend confirm 2>&1 | Out-Null
    
    # 清理日志
    $logDir = Join-Path $REPO_ROOT ".claude-excel-web\logs"
    if (Test-Path $logDir) {
        Remove-Item $logDir -Recurse -Force
    }
    
    Write-Host "服务已卸载"
    exit 0
}

# 检查 NSSM
$nssmPath = "nssm.exe"
$nssm = Get-Command $nssmPath -ErrorAction SilentlyContinue
if (-not $nssm) {
    Write-Host "ERROR: 未找到 nssm.exe，请从 https://nssm.cc 下载并添加到 PATH"
    exit 1
}

# 检查服务是否已存在
$existingService = Get-Service -Name "SheetWiseBackend" -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "服务已存在，先卸载..."
    & nssm stop SheetWiseBackend 2>&1 | Out-Null
    Start-Sleep -Seconds 1
    & nssm remove SheetWiseBackend confirm 2>&1 | Out-Null
}

# 创建日志目录
$logDir = Join-Path $REPO_ROOT ".claude-excel-web\logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

# 安装服务
$serviceName = "SheetWiseBackend"
$scriptPath = Join-Path $SCRIPT_DIR "start-service.ps1"
$serviceLog = Join-Path $logDir "service.log"

Write-Host "安装 SheetWise 服务..."
Write-Host "  用户目录: $UserHome"
Write-Host "  脚本路径: $scriptPath"

# 安装 NSSM 服务
& nssm install $serviceName powershell.exe `
    -ExecutionPolicy Bypass `
    -File $scriptPath `
    -RedirectStandardOutput $serviceLog `
    -RedirectStandardError $serviceLog

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: 服务安装失败"
    exit 1
}

# 配置服务环境变量（SHEETWISE_USER_HOME）
& nssm set $serviceName AppEnvironment SHEETWISE_USER_HOME $UserHome

# 配置服务重启策略
& nssm set $serviceName AppExit Default Restart
& nssm set $serviceName AppRestartDelay 5000
& nssm set $serviceName AppThrottle 30000
& nssm set $serviceName AppDirectory $REPO_ROOT

# 下载 NSSM（如果需要）
$nssmTemp = Join-Path $env:TEMP "nssm.exe"
if (-not (Test-Path $nssmTemp)) {
    Write-Host "下载 NSSM..."
    $nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
    $nssmZip = Join-Path $env:TEMP "nssm.zip"
    
    # 使用 curl 下载（避免 Invoke-WebRequest 的证书问题）
    & curl.exe -L -o $nssmZip $nssmUrl
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: NSSM 下载失败"
        exit 1
    }
    
    # 解压
    $tempDir = Join-Path $env:TEMP "nssm"
    Expand-Archive $nssmZip $tempDir -Force
    $nssmExe = Get-ChildItem $tempDir -Filter "nssm.exe" -Recurse | Select-Object -First 1
    Copy-Item $nssmExe.FullName $nssmTemp
    Unblock-File $nssmTemp
}

# 启动服务
Write-Host "启动服务..."
& nssm start $serviceName

if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: 服务启动失败，请检查日志: $serviceLog"
    Write-Host "手动启动: nssm start $serviceName"
    exit 1
}

Write-Host "服务安装成功！"
Write-Host "  服务名: $serviceName"
Write-Host "  日志: $serviceLog"
Write-Host "  状态检查: powershell -File $(Join-Path $SCRIPT_DIR 'status-service.ps1')"