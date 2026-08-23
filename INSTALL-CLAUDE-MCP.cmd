@echo off
title ShiBass - Install Claude MCP on this PC
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL-CLAUDE-MCP.ps1"
if errorlevel 1 (
  echo.
  echo FAILED. Check internet, then try again.
  pause
  exit /b 1
)
echo.
pause
