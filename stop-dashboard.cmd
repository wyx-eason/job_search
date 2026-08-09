@echo off
rem Stop the background dashboard server on port 8787
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8787.*LISTENING"') do taskkill /F /PID %%p
echo Dashboard stopped (if it was running).
