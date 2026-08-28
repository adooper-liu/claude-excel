@echo off
chcp 65001 >nul
echo ==========================================
echo   SheetWise - 首次安装
echo ==========================================
echo.

cd /d "%~dp0"

echo [1/3] 生成并信任 Office 开发证书...
call npx office-addin-dev-certs install
if %ERRORLEVEL% neq 0 (
    echo 证书生成失败，请确认已安装 Node.js
    pause
    exit /b 1
)
copy /Y "%USERPROFILE%\.office-addin-dev-certs\localhost.crt" "backend\cert.pem" >nul
copy /Y "%USERPROFILE%\.office-addin-dev-certs\localhost.key" "backend\key.pem" >nul
echo 证书已配置。

echo.
echo [2/3] 安装 Python 依赖...
pip install -r backend\requirements.txt -q
echo 安装 Chromium（ERP 网页登录用，仅本机）...
playwright install chromium
echo 依赖已安装。

echo.
echo [3/3] 注册 Excel 加载项...
powershell -Command "$m='file:///'+(Get-Location).Path.Replace('\','/')+'/addin/manifest.xml';$k='HKCU:\SOFTWARE\Microsoft\Office\16.0\Wef\Developer\';if(-not(Test-Path $k)){New-Item -Path $k -Force};Set-ItemProperty -Path $k -Name 'b8c7e1a2-4f3d-4a5b-9c6d-7e8f1a2b3c4d' -Value $m"

echo.
echo 可选：把后端装成 Windows 服务（后台常驻、开机自启，Excel 直连不用开黑框）：
echo   管理员 PowerShell 运行：scripts\service\setup-service.ps1 -UserHome C:\Users\你的用户名
echo   只读体检：scripts\service\status-service.ps1
echo.
echo ==========================================
echo   安装完成！
echo   以后每次使用：双击 launch.bat
echo   首次配置 API Key：在 Excel 侧边栏点 ⚙
echo ==========================================
pause
