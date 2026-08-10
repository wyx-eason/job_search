@echo off
rem 手动在线扫描：抓取腾讯文档、应届生求职网等真实来源并更新数据库
setlocal
set "NODE=C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist "%NODE%" (
  echo [ERROR] Bundled node not found: %NODE%
  pause
  exit /b 1
)

echo 正在在线扫描（腾讯文档、应届生求职网等）...
"%NODE%" scripts\daily-scan.mjs --online
if errorlevel 1 (
  echo [ERROR] 扫描失败，请查看上方输出。
  pause
  exit /b 1
)
echo.
echo 扫描完成。仪表盘刷新页面即可看到新岗位。
pause
