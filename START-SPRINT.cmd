@echo off
chcp 65001 >nul
title ShiBass — 14-day sprint (desktop, no Chrome)
set "ROOT=H:\shibass-ai"
set "PP=%ROOT%\promo-publisher"

if not exist "%PP%\cli.js" (
  echo Missing promo-publisher. Run INSTALL-ALL-SHIBASS.cmd first.
  pause
  exit /b 1
)

if not exist "%PP%\node_modules\" (
  pushd "%PP%"
  call npm install
  popd
)

echo Starting Studio API :4051 ...
start "ShiBass Studio API" /MIN cmd /c "cd /d %PP% && node api-server.js"

echo Starting Transcriber :4340 ...
start "ShiBass Transcriber" /MIN cmd /c "cd /d %PP% && node transcriber-server.js"

timeout /t 2 /nobreak >nul

echo Sprint status:
pushd "%PP%"
node cli.js sprint
popd

echo Opening Electron desktop (not Chrome)...
start "ShiBass Desktop" cmd /c "cd /d %PP% && npm start"
echo.
echo Tabs: ספרינט 14 · סולם אמנים · Ops חי · Wave 1 Ads
echo Wave 1 stays PAUSED until you turn it on in Ads Manager.
pause
