#Requires -Version 5.1
<#
.SYNOPSIS
  Wire Claude Code MCP filesystem access to H:\ (or another drive root).

.DESCRIPTION
  Registers an MCP server named "h-drive" that scopes Claude Code's filesystem
  tools to H:\. Also installs a convenience wrapper at %USERPROFILE%\.claude\h-drive.cmd

.PARAMETER Root
  Drive/folder to expose. Default: H:\

.PARAMETER SkipMcp
  Only install the CLI wrapper; do not call `claude mcp add`.
#>
param(
  [string]$Root = "H:\",
  [switch]$SkipMcp
)

$ErrorActionPreference = "Stop"

function Assert-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

if (-not (Test-Path -LiteralPath $Root)) {
  Write-Host "Creating missing root: $Root"
  New-Item -ItemType Directory -Path $Root -Force | Out-Null
}
$RootStr = (Resolve-Path -LiteralPath $Root).Path

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Ctl = Join-Path $ScriptDir "h_drive_ctl.py"
if (-not (Test-Path -LiteralPath $Ctl)) {
  throw "Missing h_drive_ctl.py next to this script: $Ctl"
}

$ClaudeDir = Join-Path $env:USERPROFILE ".claude"
New-Item -ItemType Directory -Path $ClaudeDir -Force | Out-Null

$Wrapper = Join-Path $ClaudeDir "h-drive.cmd"
@"
@echo off
setlocal
set H_DRIVE_ROOT=$RootStr
python "$Ctl" %*
"@ | Set-Content -LiteralPath $Wrapper -Encoding ASCII

Write-Host "Installed CLI wrapper: $Wrapper"
Write-Host "  Example: h-drive list"
Write-Host "  Example: h-drive read Notes\todo.txt"

$PathEntry = $ClaudeDir
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -and ($userPath -split ";" | Where-Object { $_ -eq $PathEntry })) {
  Write-Host "PATH already includes $PathEntry"
} else {
  Write-Host "Add to your user PATH to call h-drive from anywhere:"
  Write-Host "  $PathEntry"
}

if ($SkipMcp) {
  Write-Host "Skipped MCP registration (-SkipMcp)."
  exit 0
}

Assert-Command "claude"
Assert-Command "npx"

try { claude mcp remove h-drive 2>$null | Out-Null } catch { }

Write-Host "Registering Claude MCP filesystem server scoped to $RootStr ..."
claude mcp add h-drive -- npx -y `@modelcontextprotocol/server-filesystem $RootStr

Write-Host ""
Write-Host "Done. In Claude Code, ask things like:"
Write-Host "  list everything on H:\"
Write-Host "  summarize H:\Projects\README.md"
Write-Host "  create H:\inbox\note.txt with today's tasks"
Write-Host ""
Write-Host "Optional localhost API:"
Write-Host "  set H_DRIVE_ROOT=$RootStr"
Write-Host "  python `"$Ctl`" serve --port 18765"
