@echo off
title ShiBass Social Studio Desktop
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install
)

REM Keep Electron attached to THIS console, not a parent PowerShell pipeline.
REM A closed parent pipe used to crash the main process with:
REM   Error: EPIPE: broken pipe, write
set ELECTRON_NO_ATTACH_CONSOLE=1
echo Starting ShiBass Social Studio...
call npm start
