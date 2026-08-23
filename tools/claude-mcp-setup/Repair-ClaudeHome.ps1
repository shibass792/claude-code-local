#Requires -Version 5.1
# ASCII-only. Windows PowerShell 5.1 reads this as ANSI.
# Fixes the exact crash:
#   Set-Content : Could not find a part of the path
#   C:\Users\shibass\.claude\settings.json
# Cause: Test-Path / New-Item -Force treat a FILE or a broken junction
# named .claude as "already there", then Set-Content cannot write into it.
param(
  [string]$ClaudeHome = ""
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) { Write-Host "[>] $Message" }
function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "[!] $Message" -ForegroundColor Yellow }

function Get-DefaultClaudeHome {
  if ($env:CLAUDE_CONFIG_DIR) { return $env:CLAUDE_CONFIG_DIR }
  $profileDir = [Environment]::GetFolderPath("UserProfile")
  if (-not $profileDir) { $profileDir = $env:USERPROFILE }
  if (-not $profileDir) { throw "USERPROFILE is empty" }
  return (Join-Path $profileDir.TrimEnd("\") ".claude")
}

function Repair-ClaudeHomeFolder {
  param([Parameter(Mandatory = $true)][string]$Path)

  $parent = Split-Path -Parent $Path
  if (-not [System.IO.Directory]::Exists($parent)) {
    throw "User profile folder is missing: $parent"
  }

  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($item) {
    $isReparse = [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
    $realDir = [System.IO.Directory]::Exists($item.FullName)

    Write-Host ("  exists=" + $item.FullName)
    Write-Host ("  container=" + $item.PSIsContainer + " reparse=" + $isReparse + " realDir=" + $realDir)

    if (-not $item.PSIsContainer) {
      $bak = "$Path.bak-file-" + (Get-Date -Format "yyyyMMddHHmmss")
      Write-Warn "$Path is a FILE. Renaming to $bak"
      Rename-Item -LiteralPath $Path -NewName (Split-Path -Leaf $bak)
    } elseif ($isReparse -and -not $realDir) {
      Write-Warn "$Path is a broken junction. Removing it with rmdir."
      & cmd.exe /c rmdir "$Path"
      if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Force
      }
    } elseif (-not $realDir) {
      Write-Warn "$Path is not a real folder. Removing it."
      Remove-Item -LiteralPath $Path -Force
    }
  }

  [void][System.IO.Directory]::CreateDirectory($Path)
  if (-not [System.IO.Directory]::Exists($Path)) {
    throw "Failed to create a real folder at $Path"
  }
  return $Path
}

function Write-ClaudeSettings {
  param([Parameter(Mandatory = $true)][string]$HomePath)

  $settingsPath = Join-Path $HomePath "settings.json"
  $payload = @{
    permissions = @{
      allow = @("Bash(claude mcp *)", "Bash(claude mcp add *)")
    }
  } | ConvertTo-Json -Depth 8
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($settingsPath, $payload, $utf8)
  if (-not [System.IO.File]::Exists($settingsPath)) {
    throw "WriteAllText reported success but file is missing: $settingsPath"
  }
  return $settingsPath
}

$claudeHome = if ($ClaudeHome) { $ClaudeHome } else { Get-DefaultClaudeHome }

Write-Host "===================================================================="
Write-Host "  ShiBass - repair ~/.claude and write settings.json"
Write-Host "===================================================================="
Write-Host ("USERPROFILE=" + $env:USERPROFILE)
Write-Host ("ClaudeHome=" + $claudeHome)
Write-Host ""

Write-Step "Repair folder"
$claudeHome = Repair-ClaudeHomeFolder -Path $claudeHome
Write-Ok $claudeHome

Write-Step "Write settings.json via .NET (not Set-Content)"
$written = Write-ClaudeSettings -HomePath $claudeHome
Write-Ok $written

Write-Host ""
Write-Host "----- settings.json -----"
Get-Content -LiteralPath $written
Write-Host "-------------------------"
Write-Host ""
Write-Ok "Re-open Claude Code so it reloads this file."
