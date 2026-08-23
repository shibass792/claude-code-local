@echo off
title ShiBass Social Studio Desktop
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install
)

echo Starting ShiBass Social Studio...
call npm start
