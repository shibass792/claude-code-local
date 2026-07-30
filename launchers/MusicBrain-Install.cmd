@echo off
setlocal EnableExtensions
title SHIBASS Install
color 0B

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
set "INST=%REPO_ROOT%\scripts\music-brain\install.ps1"

if not exist "%INST%" (
  for %%D in (
    "%USERPROFILE%\claude-code-local"
    "H:\shibass-ai\claude-code-local"
    "H:\claude-code-local"
  ) do (
    if exist "%%~D\scripts\music-brain\install.ps1" (
      set "INST=%%~D\scripts\music-brain\install.ps1"
      goto :run
    )
  )
  echo ERROR: install.ps1 not found
  pause
  exit /b 1
)

:run
echo.
echo   Installing SHIBASS permanently...
echo   - Desktop shortcuts
echo   - Persistent scan memory
echo   - Optional Windows startup
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%INST%" -Startup %*
exit /b %ERRORLEVEL%
