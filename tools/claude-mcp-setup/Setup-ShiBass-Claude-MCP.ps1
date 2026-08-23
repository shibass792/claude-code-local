#Requires -Version 5.1
<#
  ShiBass Claude MCP Setup
  Creates %USERPROFILE%\.claude if missing, then merges the
  "claude mcp add" permission into settings.json.

  The previous crash:
    Set-Content : Could not find a part of the path
    'C:\Users\shibass\.claude\settings.json'
  happened when .claude was missing, a FILE, or a broken junction.
  Test-Path can return True in those cases, so New-Item is skipped.
#>
[CmdletBinding()]
param(
  [string]$ClaudeHome = "",
  [string[]]$FilesystemRoots = @(),
  [switch]$SkipMcpAdd
)

$ErrorActionPreference = "Stop"

function Write-Banner {
  Write-Host "===================================================================="
  Write-Host "  ShiBass Claude MCP Setup"
  Write-Host "===================================================================="
}

function Write-Step([string]$Message) {
  Write-Host "[>] $Message"
}

function Write-Ok([string]$Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
  Write-Host "[!] $Message" -ForegroundColor Yellow
}

function Ensure-Directory {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not $Path) {
    throw "Ensure-Directory requires a path"
  }
  $parent = Split-Path -Parent $Path
  if ($parent -and -not [System.IO.Directory]::Exists($parent)) {
    [void][System.IO.Directory]::CreateDirectory($parent)
  }
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($item) {
    $isReparse = [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
    $realDir = [System.IO.Directory]::Exists($item.FullName)
    if (-not $item.PSIsContainer) {
      Rename-Item -LiteralPath $Path -NewName ((Split-Path -Leaf $Path) + ".bak-file")
    } elseif ($isReparse -and -not $realDir) {
      & cmd.exe /c rmdir "$Path"
    } elseif (-not $realDir) {
      Remove-Item -LiteralPath $Path -Force
    }
  }
  [void][System.IO.Directory]::CreateDirectory($Path)
  if (-not [System.IO.Directory]::Exists($Path)) {
    throw "Failed to create a real folder at $Path"
  }
  return (Resolve-Path -LiteralPath $Path).Path
}

function Get-DefaultClaudeHome {
  if ($env:CLAUDE_CONFIG_DIR) {
    return $env:CLAUDE_CONFIG_DIR
  }
  return (Join-Path $env:USERPROFILE ".claude")
}

function Find-ClaudeCommand {
  $fromPath = Get-Command claude -ErrorAction SilentlyContinue
  if ($fromPath -and $fromPath.Source) {
    return $fromPath.Source
  }

  $candidates = @(
    (Join-Path $env:USERPROFILE ".local\bin\claude.exe"),
    (Join-Path $env:USERPROFILE ".local\bin\claude.cmd"),
    (Join-Path $env:USERPROFILE ".local\bin\claude"),
    (Join-Path $env:LOCALAPPDATA "claude\claude.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  return $null
}

function Get-ClaudeVersion {
  param([string]$ClaudeCmd)
  try {
    $out = & $ClaudeCmd --version 2>&1 | Out-String
    return ($out.Trim() -split "\r?\n" | Where-Object { $_ } | Select-Object -First 1)
  } catch {
    return $null
  }
}

function Read-JsonObject {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return [pscustomobject]@{}
  }
  $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
  if (-not $raw -or -not $raw.Trim()) {
    return [pscustomobject]@{}
  }
  try {
    return $raw | ConvertFrom-Json
  } catch {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backup = "$Path.bak-$stamp"
    Copy-Item -LiteralPath $Path -Destination $backup -Force
    Write-Warn "Invalid JSON at $Path - backed up to $backup"
    return [pscustomobject]@{}
  }
}

function ConvertTo-StringList {
  param($Value)
  if ($null -eq $Value) {
    return @()
  }
  if ($Value -is [System.Array]) {
    return @($Value | ForEach-Object { [string]$_ })
  }
  return @([string]$Value)
}

function Merge-ClaudeMcpPermission {
  param(
    [Parameter(Mandatory = $true)][string]$SettingsPath,
    [string]$Permission = "Bash(claude mcp *)"
  )

  Ensure-Directory -Path (Split-Path -Parent $SettingsPath) | Out-Null
  $settings = Read-JsonObject -Path $SettingsPath

  if (-not $settings.permissions) {
    $settings | Add-Member -NotePropertyName permissions -NotePropertyValue ([pscustomobject]@{ allow = @() }) -Force
  }
  $allow = ConvertTo-StringList $settings.permissions.allow
  $needed = @("Bash(claude mcp *)", "Bash(claude mcp add *)")
  foreach ($entry in $needed) {
    if ($allow -notcontains $entry) {
      $allow += $entry
    }
  }
  $settings.permissions | Add-Member -NotePropertyName allow -NotePropertyValue $allow -Force

  $json = $settings | ConvertTo-Json -Depth 20
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($SettingsPath, $json, $utf8)
  return $SettingsPath
}

function Get-DefaultFilesystemRoots {
  $roots = @(
    "H:\shibass-ai",
    (Join-Path $env:USERPROFILE "Documents\ShiBass Synth Samples"),
    (Join-Path $PSScriptRoot "..\..")
  )
  $existing = @()
  foreach ($root in $roots) {
    if ($root -and (Test-Path -LiteralPath $root)) {
      $existing += (Resolve-Path -LiteralPath $root).Path
    }
  }
  return $existing | Select-Object -Unique
}

Write-Banner

$claudeHome = if ($ClaudeHome) { $ClaudeHome } else { Get-DefaultClaudeHome }
Write-Step "Checking Claude Code..."
$claudeCmd = Find-ClaudeCommand
if (-not $claudeCmd) {
  Write-Warn "claude.exe not found. Install Claude Code, then re-run."
  Write-Host "Expected: $env:USERPROFILE\.local\bin\claude.exe"
} else {
  Write-Ok "Claude command: $claudeCmd"
  $version = Get-ClaudeVersion -ClaudeCmd $claudeCmd
  if ($version) {
    Write-Host "Version: $version"
  }
}

Write-Step "Adding the Claude Code `"claude mcp add`" permission..."
$claudeHome = Ensure-Directory -Path $claudeHome
$settingsPath = Join-Path $claudeHome "settings.json"
$written = Merge-ClaudeMcpPermission -SettingsPath $settingsPath
Write-Ok "Wrote permission into $written"
Write-Host "Claude home: $claudeHome"

if ($SkipMcpAdd) {
  Write-Ok "SkipMcpAdd set - settings.json is ready. Run: claude mcp add"
  return
}

if (-not $claudeCmd) {
  Write-Warn "Skipping claude mcp add because Claude Code is not on PATH."
  return
}

$roots = if ($FilesystemRoots.Count) { $FilesystemRoots } else { Get-DefaultFilesystemRoots }
if ($roots.Count -gt 0) {
  Write-Step "Registering filesystem MCP for ShiBass folders..."
  $addArgs = @("mcp", "add", "--scope", "user", "shibass-files", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem") + $roots
  try {
    & $claudeCmd @addArgs
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "MCP server shibass-files registered"
    } else {
      Write-Warn "claude mcp add exited $LASTEXITCODE - permission is in settings.json; add the server from Claude Code."
    }
  } catch {
    Write-Warn "claude mcp add failed: $($_.Exception.Message)"
  }
} else {
  Write-Warn "No local ShiBass folders found to attach as filesystem MCP."
}

Write-Host ""
Write-Ok "Setup finished. Re-open Claude Code so it reloads ~/.claude/settings.json."
