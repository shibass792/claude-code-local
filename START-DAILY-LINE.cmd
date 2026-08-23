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

echo Generating dated psy_pack_v3 (50 MIDI, Phrygian Family)...
pushd "%PP%"
node cli.js psy 50
echo.
node cli.js sprint
popd

echo.
echo Desktop Electron — not Chrome.
echo Cubase drop: H:\ShiBass_Cubase_Projects\Audix_Templates\psy_pack_inbox
echo MIDI dated:  H:\shibass-ai\10_OUTPUTS\MIDI_EXPORT\psy_pack_v3\YYYY-MM-DD
echo Dual goal:   Audix track + Producer Pack + Wave 1 (you turn ads on)
echo.
start "ShiBass Desktop" cmd /c "cd /d %PP% && npm start"
pause
