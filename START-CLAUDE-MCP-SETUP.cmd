@echo off
setlocal
title ShiBass Claude MCP Setup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\claude-mcp-setup\Setup-ShiBass-Claude-MCP.ps1"
if errorlevel 1 (
  echo.
  echo PowerShell setup failed — writing settings.json with Node instead...
  node "%~dp0tools\claude-mcp-setup\ensure-claude-settings.js"
)
echo.
pause
endlocal
