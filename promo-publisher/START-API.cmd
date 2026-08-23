@echo off
cd /d "%~dp0"
echo Starting ShiBass Studio API on http://127.0.0.1:4051
node api-server.js
pause
