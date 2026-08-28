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
