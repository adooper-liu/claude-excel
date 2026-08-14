@echo off
setlocal
cd /d "%~dp0"
title Mind for Sheet

echo ====================================================
echo       Mind for Sheet launcher
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
if not exist "backend\cert.pem" (
    if not exist "%USERPROFILE%\.office-addin-dev-certs\localhost.crt" (
        echo Installing Office dev certificates...
        pushd addin
        call npx --yes office-addin-dev-certs install
        popd
    )
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
start "Mind-for-Sheet-Backend" /D "%~dp0" python backend\server.py

echo [4/5] Waiting for backend...
set /a count=0
:wait_backend
set /a count+=1
if %count% gtr 25 (
    echo Error: Backend did not respond in time.
    echo Check the Mind-for-Sheet-Backend window.
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
