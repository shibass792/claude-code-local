@echo off
setlocal EnableExtensions
title SHIBASS Find + Index H/F
color 0B

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
set "PS1=%REPO_ROOT%\scripts\music-brain\find-and-index.ps1"

if not exist "%PS1%" (
  for %%D in (
    "H:\shibass-ai\claude-code-local"
    "H:\claude-code-local"
    "%USERPROFILE%\claude-code-local"
  ) do (
    if exist "%%~D\scripts\music-brain\find-and-index.ps1" (
      set "PS1=%%~D\scripts\music-brain\find-and-index.ps1"
      goto :run
    )
  )
  echo ERROR: find-and-index.ps1 not found
  pause
  exit /b 1
)

:run
echo.
echo   Searching H:\ F:\ D:\ + profile
echo   Installing results into scan memory...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
exit /b %ERRORLEVEL%
