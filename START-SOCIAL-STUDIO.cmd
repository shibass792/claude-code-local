@echo off
title ShiBass Social Studio
cd /d "H:\shibass-ai\promo-publisher"
if not exist "H:\shibass-ai\promo-publisher\main.js" (
  echo Missing promo-publisher. Run INSTALL-SHIBASS-UPDATES.cmd first.
  pause
  exit /b 1
)
call START-DESKTOP.cmd
