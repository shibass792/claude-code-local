@echo off
chcp 65001 >nul
title ShiBass — live quality scan
set "ROOT=H:\shibass-ai"
set "PP=%ROOT%\promo-publisher"

if not exist "%PP%\cli.js" (
  echo Missing promo-publisher. Run INSTALL-ALL-SHIBASS.cmd first.
  pause
  exit /b 1
)

echo Live local scan — node --check / py_compile on this PC.
echo Not a template. If you see PHPStan Level 9 or 826,500 files, that is the old simulator.
echo.
pushd "%PP%"
node cli.js quality
popd
echo.
echo Same report: http://127.0.0.1:4051/api/quality
pause
