@echo off
title Music Brain — Install
cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
