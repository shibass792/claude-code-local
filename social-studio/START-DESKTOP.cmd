@echo off
title ShiBass Social Studio
cd /d "%~dp0"

if not exist "node_modules\electron" (
  echo Installing Social Studio dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting ShiBass Social Studio...
call npm start
if errorlevel 1 pause
