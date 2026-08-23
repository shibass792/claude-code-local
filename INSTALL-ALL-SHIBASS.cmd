@echo off
chcp 65001 >nul
title ShiBass — התקנת כל המערכת + תיקונים
echo.
echo  ========================================
echo   ShiBass — Full stack + live API fixes
echo   Target: H:\shibass-ai
echo   Branch: cursor/real-apis-instapy-player-87eb
echo  ========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL-SHIBASS-UPDATES.ps1" -TargetRoot "H:\shibass-ai" -Branch "cursor/real-apis-instapy-player-87eb"
if errorlevel 1 (
  echo.
  echo FAILED. Check internet, or run PowerShell as Administrator.
  pause
  exit /b 1
)

echo.
echo Next:
echo   1^) H:\shibass-ai\START-ALL-SHIBASS.cmd
echo   2^) Or API only: H:\shibass-ai\promo-publisher\START-API.cmd
echo   3^) Guide: H:\shibass-ai\docs\WINDOWS_INSTALL_ALL_HE.md
echo.
pause
