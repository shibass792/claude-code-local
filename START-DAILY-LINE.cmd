@echo off
chcp 65001 >nul
title ShiBass — Daily production line
set "ROOT=H:\shibass-ai"
set "PP=%ROOT%\promo-publisher"

if not exist "%PP%\api-server.js" (
  echo Missing Studio API. Run INSTALL-ALL-SHIBASS.cmd first.
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

echo Starting library compat :4000 if IDE is down ...
start "ShiBass Library Compat 4000" /MIN cmd /c "cd /d %PP% && node line-compat-4000.js"

timeout /t 2 /nobreak >nul

echo Generating morning psy_pack_v3 (10 MIDI, E Phrygian, 142)...
pushd "%PP%"
node -e "console.log(JSON.stringify(require('./modules/psy-pack').generatePsyPack({count:10,root:'E',bpm:142}),null,2))"
popd

echo.
echo Studio:      http://127.0.0.1:4051/
echo Transcriber: http://127.0.0.1:4340/api/health
echo Cubase drop: H:\ShiBass_Cubase_Projects\Audix_Templates\psy_pack_inbox
echo 14-day goal: Producer Pack v1 — button "ארוז Producer Pack" in Studio
echo.
start "" "http://127.0.0.1:4051/"
pause
