# 每日在线扫描：抓取腾讯文档、应届生求职网等真实来源并更新数据库
$node = "C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$root = "E:\job_search\china-campus-ops"
$logDir = Join-Path $root "local"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$log = Join-Path $logDir "scan-online.log"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $log -Value "===== $stamp 开始在线扫描 ====="
& $node (Join-Path $root "scripts\daily-scan.mjs") --online *>> $log 2>&1
Add-Content -Path $log -Value "===== $stamp 扫描结束 ====="
