@echo off
title ShiBass Social Studio
cd /d "H:\shibass-ai\promo-publisher"
if not exist "H:\shibass-ai\promo-publisher\main.js" (
  echo Missing promo-publisher. Run INSTALL-SHIBASS-UPDATES.cmd first.
  pause
  exit /b 1
)
REM Launch in a new console so a closing PowerShell / pipeline cannot
REM take stdout with it and trigger EPIPE in the Electron main process.
start "ShiBass Social Studio Desktop" /D "H:\shibass-ai\promo-publisher" cmd /c START-DESKTOP.cmd
