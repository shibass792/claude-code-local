@echo off
title ShiBass - mount /api/sb-daw/jobs/
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL-SB-DAW-JOBS.ps1" -TargetRoot "H:\shibass-ai"
if errorlevel 1 (
  echo.
  echo FAILED. Need Node.js on PATH and H:\shibass-ai\server.js
  pause
  exit /b 1
)
echo.
echo Restart node server.js (port 4000), then reload
echo http://127.0.0.1:8788/sb-daw.html
pause
