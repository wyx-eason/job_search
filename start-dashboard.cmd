@echo off
rem china-campus-ops dashboard launcher: starts server hidden, survives window close
setlocal
set "NODE=C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist "%NODE%" (
  echo [ERROR] Bundled node not found: %NODE%
  echo Fix the NODE variable at the top of this file.
  pause
  exit /b 1
)
if not exist "local" mkdir "local"

rem 关闭残留的投递浏览器会话（仅本项目的专用 profile，不碰日常浏览器）
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*chrome-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

rem ??? 8787 ?????????????
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8787.*LISTENING"') do taskkill /F /PID %%p >nul 2>&1
start "" /b "%NODE%" dashboard\server.mjs > local\dashboard.log 2>&1
if exist "%CHROME%" (
  start "" "%CHROME%" http://127.0.0.1:8787
) else (
  start "" http://127.0.0.1:8787
)
echo Dashboard starting: http://127.0.0.1:8787 (log: local\dashboard.log)
