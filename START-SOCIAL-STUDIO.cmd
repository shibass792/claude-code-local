@echo off
title ShiBass Social Studio
cd /d "H:\shibass-ai\promo-publisher"
if not exist "H:\shibass-ai\promo-publisher\main.js" (
  echo Missing promo-publisher. Run INSTALL-SHIBASS-UPDATES.cmd first.
  pause
  exit /b 1
)
if exist "START-DESKTOP.cmd" call START-DESKTOP.cmd
if not exist "START-DESKTOP.cmd" (
  echo Starting Studio HTTP API on port 4052
  set STUDIO_API_PORT=4052
  node studio-api.js
)
