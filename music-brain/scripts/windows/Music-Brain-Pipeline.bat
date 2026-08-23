@echo off
title Music Brain — First Pipeline
cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pipeline-first-run.ps1"
pause
