@echo off
title ShiBass OS :4000
cd /d "%~dp0"
if not exist "tools\os-bridge\listen.js" (
  echo Missing tools\os-bridge\listen.js
  echo Run: powershell -ExecutionPolicy Bypass -File INSTALL-OS-BRIDGE.ps1
  pause
  exit /b 1
)
if not exist "server.js" (
  echo Writing standalone server.js
  node tools\os-bridge\apply.js "%cd%"
)
set OS_PORT=4000
node server.js
pause
