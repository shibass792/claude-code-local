#Requires -Version 5.1
# ASCII-only. Windows PowerShell 5.1 reads this as ANSI; a UTF-8 em-dash
# becomes a stray quote and breaks the parser ("string is missing the terminator").
param(
  [string]$Branch = "cursor/real-studio-apis-0b72",
  [string]$RepoSlug = "shibass792/claude-code-local",
  [string]$TargetTools = "H:\shibass-ai\tools\claude-mcp-setup",
  [switch]$SkipMcpAdd
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step([string]$Message) { Write-Host "[>] $Message" }
function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "[!] $Message" -ForegroundColor Yellow }

function Ensure-Directory([string]$Path) {
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
}

function Get-RawUrl([string]$RelativePath) {
  return "https://raw.githubusercontent.com/$RepoSlug/$Branch/$RelativePath"
}

function Install-File {
  param([string]$RelativePath, [string]$Destination)
  Ensure-Directory (Split-Path -Parent $Destination)
  $url = Get-RawUrl $RelativePath
  Write-Step "Download $RelativePath"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $Destination
  if (-not (Test-Path -LiteralPath $Destination) -or ((Get-Item -LiteralPath $Destination).Length -lt 20)) {
    throw "Download failed or empty: $url"
  }
}

Write-Host "===================================================================="
Write-Host "  ShiBass - install Claude MCP on this PC"
Write-Host "===================================================================="
Write-Host "User: $env:USERNAME"
Write-Host "Claude home will be: $env:USERPROFILE\.claude"
Write-Host "Tools copy: $TargetTools"
Write-Host ""

$claudeHome = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".claude" }
Write-Step "Creating $claudeHome (this is the folder that was missing)"
Ensure-Directory $claudeHome
Write-Ok $claudeHome

Ensure-Directory $TargetTools
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundledSetup = Join-Path $localRoot "tools\claude-mcp-setup\Setup-ShiBass-Claude-MCP.ps1"
$setupDest = Join-Path $TargetTools "Setup-ShiBass-Claude-MCP.ps1"
$jsDest = Join-Path $TargetTools "ensure-claude-settings.js"

if (Test-Path -LiteralPath $bundledSetup) {
  Write-Step "Using setup files next to this installer"
  Copy-Item -LiteralPath $bundledSetup -Destination $setupDest -Force
  $bundledJs = Join-Path $localRoot "tools\claude-mcp-setup\ensure-claude-settings.js"
  if (Test-Path -LiteralPath $bundledJs) {
    Copy-Item -LiteralPath $bundledJs -Destination $jsDest -Force
  }
} else {
  Install-File -RelativePath "tools/claude-mcp-setup/Setup-ShiBass-Claude-MCP.ps1" -Destination $setupDest
  try {
    Install-File -RelativePath "tools/claude-mcp-setup/ensure-claude-settings.js" -Destination $jsDest
  } catch {
    Write-Warn "Node helper download skipped: $($_.Exception.Message)"
  }
}

Write-Step "Writing ~/.claude/settings.json"
$wroteJson = $false
try {
  & $setupDest -ClaudeHome $claudeHome -SkipMcpAdd:$SkipMcpAdd
  $wroteJson = Test-Path -LiteralPath (Join-Path $claudeHome "settings.json")
} catch {
  Write-Warn "PowerShell setup reported: $($_.Exception.Message)"
}

if (-not $wroteJson -and (Test-Path -LiteralPath $jsDest) -and (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Step "Fallback: Node writer"
  $env:CLAUDE_CONFIG_DIR = $claudeHome
  & node $jsDest
  $wroteJson = Test-Path -LiteralPath (Join-Path $claudeHome "settings.json")
}

if (-not $wroteJson) {
  $settingsPath = Join-Path $claudeHome "settings.json"
  Ensure-Directory $claudeHome
  $payload = @{
    permissions = @{
      allow = @("Bash(claude mcp *)", "Bash(claude mcp add *)")
    }
  } | ConvertTo-Json -Depth 8
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($settingsPath, $payload, $utf8)
  $wroteJson = [System.IO.File]::Exists($settingsPath)
  Write-Ok "Wrote $settingsPath with a built-in fallback"
}

$settingsPath = Join-Path $claudeHome "settings.json"
if (-not (Test-Path -LiteralPath $settingsPath)) {
  throw "settings.json still missing after install"
}

Write-Host ""
Write-Ok "Installed on this PC"
Write-Host "  $settingsPath"
Write-Host "  $setupDest"
Write-Host ""
Write-Host "Re-open Claude Code so it reloads settings.json."
Write-Host "Then run:  claude mcp add"
