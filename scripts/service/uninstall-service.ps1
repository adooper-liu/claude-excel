<#
.SYNOPSIS
    卸载 SheetWise Windows 服务

.DESCRIPTION
    停止并删除 SheetWiseBackend 服务，清理相关日志文件
#>

$PSNativeCommandUseErrorActionPreference = $false

# 验证管理员权限
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: 此脚本需要管理员权限"
    exit 1
}

$SCRIPT_DIR = Split-Path $MyInvocation.MyCommand.Path
$REPO_ROOT = Split-Path $SCRIPT_DIR

Write-Host "卸载 SheetWise 服务..."

# 停止服务
Write-Host "  停止服务..."
& nssm stop SheetWiseBackend 2>&1 | Out-Null
Start-Sleep -Seconds 1

# 删除服务
Write-Host "  删除服务..."
& nssm remove SheetWiseBackend confirm 2>&1 | Out-Null

# 清理日志（可选）
$logDir = Join-Path $REPO_ROOT ".claude-excel-web\logs"
if (Test-Path $logDir) {
    Write-Host "  清理日志..."
    Remove-Item $logDir -Recurse -Force
}

Write-Host "服务已卸载"