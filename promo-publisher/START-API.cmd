@echo off
title ShiBass Social Studio API
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install
)

echo Starting ShiBass real API on http://127.0.0.1:4050
call npm run api
