@echo off
chcp 65001 >nul
title ShiBass — live Ops probe
set "ROOT=H:\shibass-ai"
set "PP=%ROOT%\promo-publisher"

if not exist "%PP%\cli.js" (
  echo Missing promo-publisher. Run INSTALL-ALL-SHIBASS.cmd first.
  pause
  exit /b 1
)

pushd "%PP%"
node cli.js ops
popd
echo.
echo Honest probes only. OFFLINE means nothing is listening.
pause
