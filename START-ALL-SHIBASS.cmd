@echo off
chcp 65001 >nul
title ShiBass — Start all (API + Social Studio)
set "ROOT=H:\shibass-ai"
set "PP=%ROOT%\promo-publisher"

if not exist "%PP%\api-server.js" (
  echo Missing live API files. Run INSTALL-ALL-SHIBASS.cmd first.
  pause
  exit /b 1
)

if not exist "%PP%\node_modules\" (
  echo npm install...
  pushd "%PP%"
  call npm install
  popd
)

echo Starting Studio API on http://127.0.0.1:4051 ...
start "ShiBass Studio API" /MIN cmd /c "cd /d %PP% && node api-server.js"

timeout /t 2 /nobreak >nul

echo Starting Social Studio desktop...
start "ShiBass Social Studio" cmd /c "cd /d %PP% && call START-DESKTOP.cmd"

echo.
echo API UI:  http://127.0.0.1:4051/
echo Desktop: Social Studio window
echo Optional stack: powershell -ExecutionPolicy Bypass -File %ROOT%\scripts\start-shibass-stack.ps1 -IncludeStudioApi
echo.
pause
