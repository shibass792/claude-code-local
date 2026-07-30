#Requires -Version 5.1
<#
.SYNOPSIS
  Register Claude Code MCP filesystem access for H:\ and F:\ (and optional extras).

.DESCRIPTION
  Unifies multi-drive remote control on Windows. Installs CLI wrappers and MCP
  servers for each existing drive letter.
#>
param(
  [string[]]$Drives = @("H:\", "F:\"),
  [switch]$SkipMcp
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SetupOne = Join-Path $ScriptDir "setup-mcp.ps1"

if (-not (Test-Path -LiteralPath $SetupOne)) {
  throw "Missing setup-mcp.ps1 at $SetupOne"
}

foreach ($drive in $Drives) {
  if (-not (Test-Path -LiteralPath $drive)) {
    Write-Host "SKIP missing drive: $drive"
    continue
  }

  $letter = ($drive.Substring(0, 1)).ToLower()
  $name = "$letter-drive"
  Write-Host ""
  Write-Host "=== Configuring $drive as MCP '$name' ==="

  # Reuse single-drive installer for wrapper content, then rename wrapper/MCP.
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $SetupOne, "-Root", $drive)
  if ($SkipMcp) { $args += "-SkipMcp" }
  & powershell @args

  $claudeDir = Join-Path $env:USERPROFILE ".claude"
  $generic = Join-Path $claudeDir "h-drive.cmd"
  $named = Join-Path $claudeDir "$name.cmd"
  if (Test-Path -LiteralPath $generic) {
    Copy-Item -LiteralPath $generic -Destination $named -Force
    Write-Host "CLI wrapper: $named"
  }

  if (-not $SkipMcp) {
    try { claude mcp remove $name 2>$null | Out-Null } catch { }
    # Keep h-drive alias for H:\; also register letter-specific name.
    if ($letter -ne "h") {
      claude mcp add $name -- npx -y `@modelcontextprotocol/server-filesystem $drive
    }
  }
}

Write-Host ""
Write-Host "Done. Restart Claude Code so MCP servers reload."
Write-Host "Wrappers live in $env:USERPROFILE\.claude\"
