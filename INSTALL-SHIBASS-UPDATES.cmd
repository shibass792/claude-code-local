@echo off
title ShiBass — Download updates to H:\shibass-ai
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL-SHIBASS-UPDATES.ps1" -TargetRoot "H:\shibass-ai" -Branch "cursor/real-apis-instapy-player-87eb"
if errorlevel 1 (
  echo.
  echo FAILED. Try running PowerShell as Administrator or check internet.
  pause
  exit /b 1
)
echo.
pause
