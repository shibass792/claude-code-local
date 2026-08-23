@echo off
title ShiBass Studio API
cd /d "%~dp0promo-publisher"
if not exist "studio-api.js" (
  echo Missing promo-publisher\studio-api.js
  pause
  exit /b 1
)
if exist "config\.env.example" if not exist "config\.env" copy /Y "config\.env.example" "config\.env" >nul
call npm install
set STUDIO_API_PORT=4052
node studio-api.js
pause
