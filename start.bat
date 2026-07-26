@echo off
echo ==========================================
echo   Claude Excel
echo ==========================================
echo.
cd /d "%~dp0backend"
python server.py
pause
