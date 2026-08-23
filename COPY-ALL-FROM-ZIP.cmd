@echo off
title Copy ShiBass updates from ZIP
cd /d "H:\shibass-ai"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0COPY-ALL-FROM-ZIP.ps1"
pause
