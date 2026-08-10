@echo off
rem china-campus-ops one-click scan launcher (no PATH dependency)
setlocal
set "NODE=C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist "%NODE%" (
  echo [ERROR] Bundled node not found: %NODE%
  echo Fix the NODE variable at the top of this file.
  pause
  exit /b 1
)

echo [1/2] Running online scan (Tencent Docs, yingjiesheng, etc.)
"%NODE%" scripts\daily-scan.mjs --online
if errorlevel 1 (
  echo [ERROR] Scan failed. See output above.
  pause
  exit /b 1
)

echo [2/2] Done.
echo   - Report: reports\daily\
echo   - Database: data\jobs.db
echo.
set /p OPEN_DASH=是否启动仪表盘网页？(Y/N，直接回车默认 Y):
if /i "%OPEN_DASH%"=="N" (
  echo 已跳过。之后可随时运行 start-dashboard.cmd 打开网页。
  pause
  exit /b 0
)
call "%~dp0start-dashboard.cmd"
pause
