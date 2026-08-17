@echo off
setlocal
REM ============================================================
REM  git-flow.bat
REM  双击版：在 Git Bash 里跑 git-flow.sh，参数透传。
REM  无参数时默认跑 check（开工前检查）。
REM  前置：Git for Windows（提供 bash.exe）。
REM  常用：git-flow.bat start 取数    git-flow.bat finish --test
REM ============================================================

REM 切到仓库根（scripts 的上一级），保证相对路径可用
cd /d "%~dp0.."

set "SH_SCRIPT=%~dp0git-flow.sh"
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
  echo        ./scripts/git-flow.sh check
  pause
  exit /b 1
)

REM 无参数时默认 check
set "ARGS=%*"
if "%ARGS%"=="" set "ARGS=check"

"%BASH%" "%SH_SCRIPT%" %ARGS%
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo [完成] 退出码 0。
) else (
  echo [失败] 退出码 %RC%，见上方输出。
)
pause
endlocal & exit /b %RC%
