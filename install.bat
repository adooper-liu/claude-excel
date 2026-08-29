@echo off
chcp 65001 >nul
echo ==========================================
echo   SheetWise - 首次安装
echo ==========================================
echo.

cd /d "%~dp0"

where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo 未找到 Python，请先安装 Python 3.11+ 并加入 PATH
    pause
    exit /b 1
)
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo 未找到 npm，请先安装 Node.js 20+
    pause
    exit /b 1
)

echo [1/4] 生成并信任 Office 开发证书...
call npx office-addin-dev-certs install
if %ERRORLEVEL% neq 0 (
    echo 证书生成失败，请确认已安装 Node.js
    pause
    exit /b 1
)
if not exist "%USERPROFILE%\.office-addin-dev-certs\localhost.crt" (
    echo 未找到 Office 开发证书：%USERPROFILE%\.office-addin-dev-certs\localhost.crt
    pause
    exit /b 1
)
if not exist "%USERPROFILE%\.office-addin-dev-certs\localhost.key" (
    echo 未找到 Office 开发私钥：%USERPROFILE%\.office-addin-dev-certs\localhost.key
    pause
    exit /b 1
)
certutil -user -addstore -f Root "%USERPROFILE%\.office-addin-dev-certs\ca.crt" >nul
if %ERRORLEVEL% neq 0 (
    echo 开发证书 CA 信任失败
    pause
    exit /b 1
)
copy /Y "%USERPROFILE%\.office-addin-dev-certs\localhost.crt" "backend\cert.pem" >nul
copy /Y "%USERPROFILE%\.office-addin-dev-certs\localhost.key" "backend\key.pem" >nul
echo 证书已配置。

echo.
echo [2/4] 安装并构建 addin 前端（生产模式下后端从 :8765 托管 addin\dist）...
cd addin
call npm install
if %ERRORLEVEL% neq 0 (
    echo npm install 失败，请确认已安装 Node.js
    cd ..
    exit /b 1
)
call npm run build
if %ERRORLEVEL% neq 0 (
    echo npm run build 失败 -> 后端 :8765 将无法提供 taskpane（生产模式不可用）
    cd ..
    exit /b 1
)
cd ..
echo 前端 dist 已构建。

echo.
echo [3/4] 安装 Python 依赖...
if not exist "backend\.venv\Scripts\python.exe" (
    python -m venv backend\.venv
)
if not exist "backend\.venv\Scripts\python.exe" (
    echo 创建 backend\.venv 失败
    pause
    exit /b 1
)
"backend\.venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
if %ERRORLEVEL% neq 0 (
    echo Python 依赖安装失败
    pause
    exit /b 1
)
"backend\.venv\Scripts\python.exe" -m pip install "pytesseract>=0.3.13"
if %ERRORLEVEL% neq 0 (
    echo pytesseract 安装失败；后端可运行，但扫描件本地 OCR 不可用
)
where tesseract >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo 安装本地 OCR 引擎 Tesseract（UB-Mannheim 版，默认含 chi_sim）...
    winget install -e --id UB-Mannheim.TesseractOCR --accept-package-agreements --accept-source-agreements
    if %ERRORLEVEL% neq 0 (
        echo Tesseract 安装失败；后端可运行，但扫描件本地 OCR 不可用
    )
) else (
    echo 已找到本地 OCR 引擎 Tesseract。
)
echo 安装 Chromium（ERP 网页登录用，仅本机）...
"backend\.venv\Scripts\python.exe" -m playwright install chromium
if %ERRORLEVEL% neq 0 (
    echo Chromium 安装失败；后端可运行，但网页抓取功能不可用
    pause
    exit /b 1
)
echo 依赖已安装。

echo.
echo [4/4] 注册 Excel 加载项...
reg delete "HKCU\Software\Microsoft\Office\16.0\Wef\Developer" /v b8c7e1a2-4f3d-4a5b-9c6d-7e8f1a2b3c4d /f >nul 2>nul
pushd addin
call npx --yes office-addin-dev-settings register .\dist\manifest.xml
if %ERRORLEVEL% neq 0 (
    echo 加载项注册失败
    popd
    exit /b 1
)
popd

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
