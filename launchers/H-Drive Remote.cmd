@echo off
setlocal EnableExtensions
REM H-Drive Remote — give Claude Code control of H:\
REM Double-click or run from a terminal on Windows.

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
set "CTL=%REPO_ROOT%\scripts\h-drive\h_drive_ctl.py"
set "SETUP=%REPO_ROOT%\scripts\h-drive\setup-mcp.ps1"

if not exist "%CTL%" (
  echo Missing %CTL%
  exit /b 1
)

if "%~1"=="setup" goto :setup
if "%~1"=="serve" goto :serve
if "%~1"=="" goto :help

if "%H_DRIVE_ROOT%"=="" set "H_DRIVE_ROOT=H:\"
python "%CTL%" %*
exit /b %ERRORLEVEL%

:setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%SETUP%" %2 %3 %4 %5
exit /b %ERRORLEVEL%

:serve
if "%H_DRIVE_ROOT%"=="" set "H_DRIVE_ROOT=H:\"
echo Starting H:\ remote-control API on http://127.0.0.1:18765
echo Root: %H_DRIVE_ROOT%
python "%CTL%" serve --host 127.0.0.1 --port 18765
exit /b %ERRORLEVEL%

:help
echo.
echo H-Drive Remote — Claude Code control for H:\
echo.
echo Usage:
echo   "H-Drive Remote.cmd" setup          Register MCP + install h-drive.cmd
echo   "H-Drive Remote.cmd" serve          Localhost API on port 18765
echo   "H-Drive Remote.cmd" list [path]    List files under H:\
echo   "H-Drive Remote.cmd" read path      Read a file
echo   "H-Drive Remote.cmd" write path txt Write a file
echo   "H-Drive Remote.cmd" mkdir path     Create a directory
echo   "H-Drive Remote.cmd" rm path        Remove a file
echo.
echo Env:
echo   H_DRIVE_ROOT   Override root ^(default H:\^)
echo   H_DRIVE_TOKEN  Optional bearer token for serve
echo.
exit /b 0
