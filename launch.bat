@echo off
setlocal
cd /d "%~dp0"
title SheetWise

echo ====================================================
echo       SheetWise launcher
echo ====================================================

echo [1/5] Checking environment...
where python >nul 2>nul
if errorlevel 1 (
    echo Error: Python is not in PATH.
    pause
    exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
    echo Error: Node.js/npm is not in PATH.
    pause
    exit /b 1
)

echo [2/5] Checking certificates...
set "CERT_OK="
if exist "backend\cert.pem" (
    for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "try{$c=[System.Security.Cryptography.X509Certificates.X509Certificate2]::new('backend\cert.pem');$ch=New-Object System.Security.Cryptography.X509Certificates.X509Chain;$ch.ChainPolicy.RevocationMode='NoCheck';$ok=$ch.Build($c);if($ok -and $c.NotAfter -gt (Get-Date).AddDays(7)){'YES'}}catch{}"`) do set "CERT_OK=%%i"
)
if not defined CERT_OK (
    echo Refreshing expiring/untrusted certificates...
    pushd addin
    call npx --yes office-addin-dev-certs install
    popd
    if exist "%USERPROFILE%\.office-addin-dev-certs\localhost.crt" (
        copy /Y "%USERPROFILE%\.office-addin-dev-certs\localhost.crt" "backend\cert.pem" >nul
        copy /Y "%USERPROFILE%\.office-addin-dev-certs\localhost.key" "backend\key.pem" >nul
    )
)
if not exist "backend\cert.pem" (
    echo Error: backend\cert.pem missing.
    echo Run install.bat as Administrator once.
    pause
    exit /b 1
)
echo OK: Certificates ready.

echo [3/5] Starting backend...
set "VENV_PY=%~dp0backend\.venv\Scripts\python.exe"
if not exist "%VENV_PY%" (
    echo Error: backend\.venv missing.
    echo Run install.bat first.
    pause
    exit /b 1
)
rem Use cmd /k so backend window stays open on failure (no flash-close).
start "SheetWise-Backend" /D "%~dp0" cmd /k ""%VENV_PY%" backend\server.py"

echo [4/5] Waiting for backend...
set /a count=0
:wait_backend
set /a count+=1
if %count% gtr 25 (
    echo Error: Backend did not respond in time.
    echo Check the SheetWise-Backend window.
    pause
    exit /b 1
)
curl -sk https://localhost:8765/api/health 2>nul | findstr "ok" >nul
if errorlevel 1 (
    curl -s http://localhost:8765/api/health 2>nul | findstr "ok" >nul
)
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_backend
)
echo OK: Backend is online.

echo [5/5] Starting Excel add-in...
pushd addin
call npm start
popd
echo ====================================================
echo Taskpane: https://localhost:3000
echo Backend:  https://localhost:8765
echo ====================================================
pause
