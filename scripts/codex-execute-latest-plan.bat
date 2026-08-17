@echo off
setlocal
REM ============================================================
REM  codex-execute-latest-plan.bat
REM  双击版：在 Git Bash 里跑 codex-execute-latest-plan.sh
REM  前置：Git for Windows（提供 bash.exe）；codex CLI 在 PATH。
REM ============================================================

REM 切到仓库根（scripts 的上一级），保证相对路径可用
cd /d "%~dp0.."

REM 可选：指定 Codex 模型；留空 = 用 codex 默认模型。
set "CODEX_MODEL="
REM set "CODEX_MODEL=codex-mini"

set "SH_SCRIPT=%~dp0codex-execute-latest-plan.sh"
if not exist "%SH_SCRIPT%" (
  echo [错误] 找不到脚本: %SH_SCRIPT%
  pause
  exit /b 1
)

REM 定位 Git Bash：先找 PATH 里的 bash，再找常见安装路径。
set "BASH="
where bash >nul 2>nul && set "BASH=bash"
if not defined BASH if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined BASH (
  echo [错误] 找不到 Git Bash（bash.exe）。请安装 Git for Windows，或在 Git Bash 里直接跑：
  echo        ./scripts/codex-execute-latest-plan.sh
  pause
  exit /b 1
)

echo [Git Bash] %BASH%
echo [执行] %SH_SCRIPT%
echo.

"%BASH%" "%SH_SCRIPT%"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo [完成] 退出码 0。提交见 git log；review 交给 Claude 对照 plan 逐粒核对。
) else (
  echo [失败] 退出码 %RC%，见上方输出。
)
pause
endlocal & exit /b %RC%
