@echo off
chcp 65001 >nul
title ShiBass — local MCP stdio
set "ROOT=H:\shibass-ai"
set "PP=%ROOT%\promo-publisher"

if not exist "%PP%\mcp-server.js" (
  echo Missing mcp-server.js. Run INSTALL-ALL-SHIBASS.cmd first.
  pause
  exit /b 1
)

echo Local MCP on stdio. Add this command in Cursor MCP settings if you want it:
echo   node %PP%\mcp-server.js
echo This script does not install or enable a global MCP server.
echo.
cd /d "%PP%"
node mcp-server.js
