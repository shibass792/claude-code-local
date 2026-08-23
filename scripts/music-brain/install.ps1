#Requires -Version 5.1
<#
.SYNOPSIS
  Install SHIBASS / Music Brain permanently on this Windows PC.

.DESCRIPTION
  - Registers persistent scan memory DB under %LOCALAPPDATA%\MusicBrain\
  - Sets user env MUSIC_BRAIN_DB + MUSIC_BRAIN_ROOTS
  - Creates Desktop + Start Menu shortcuts (Serve / Scan / Remote)
  - Optional: start with Windows
  - Optional: firewall rule for Rokid glasses (port 18766)
  - pip installs the music-brain package

.EXAMPLE
  .\install.ps1
  .\install.ps1 -Startup
  .\install.ps1 -Uninstall
#>
param(
  [switch]$Startup,
  [switch]$NoFirewall,
  [switch]$Uninstall,
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Find-RepoRoot {
  $candidates = @(
    (Resolve-Path (Join-Path $ScriptDir "..\..") -ErrorAction SilentlyContinue).Path
    (Join-Path $ScriptDir "..\..")
    "H:\shibass-ai\claude-code-local"
    "H:\claude-code-local"
    (Join-Path $env:USERPROFILE "claude-code-local")
    (Join-Path $env:USERPROFILE "Desktop\claude-code-local")
  ) | Where-Object { $_ }

  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath (Join-Path $c "music-brain\music_brain\cli.py")) {
      return (Resolve-Path -LiteralPath $c).Path
    }
  }
  return $null
}

function Find-Python {
  foreach ($name in @("python", "py")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $cmd) { continue }
    if ($name -eq "py") { return @{ Exe = $cmd.Source; Args = @("-3") } }
    try {
      $ver = & $cmd.Source --version 2>&1 | Out-String
      if ($ver -match "Python 3") { return @{ Exe = $cmd.Source; Args = @() } }
    } catch {}
  }
  return $null
}

function Set-UserEnv([string]$Name, [string]$Value) {
  [Environment]::SetEnvironmentVariable($Name, $Value, "User")
  Set-Item -Path "Env:$Name" -Value $Value
}

function Remove-UserEnv([string]$Name) {
  [Environment]::SetEnvironmentVariable($Name, $null, "User")
  if (Test-Path "Env:$Name") { Remove-Item "Env:$Name" -ErrorAction SilentlyContinue }
}

function New-Shortcut([string]$Path, [string]$Target, [string]$Args, [string]$WorkDir, [string]$Icon = $null) {
  $w = New-Object -ComObject WScript.Shell
  $s = $w.CreateShortcut($Path)
  $s.TargetPath = $Target
  if ($Args) { $s.Arguments = $Args }
  $s.WorkingDirectory = $WorkDir
  if ($Icon) { $s.IconLocation = $Icon }
  $s.Save()
}

$Repo = Find-RepoRoot
if (-not $Repo) {
  Write-Host "ERROR: claude-code-local repo not found." -ForegroundColor Red
  if (-not $NoPause) { pause }
  exit 1
}

$Mb = Join-Path $Repo "music-brain"
$Data = Join-Path $env:LOCALAPPDATA "MusicBrain"
$Db = Join-Path $Data "knowledge.db"
$Cfg = Join-Path $Data "config.json"
$ServeCmd = Join-Path $Repo "launchers\MusicBrain-Serve.cmd"
$ScanCmd = Join-Path $Repo "launchers\MusicBrain-Scan.cmd"
$StartCmd = Join-Path $Repo "launchers\MusicBrain-Start.cmd"
$Desktop = [Environment]::GetFolderPath("Desktop")
$StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\SHIBASS"
$StartupDir = [Environment]::GetFolderPath("Startup")

Write-Host ""
Write-Host "  SHIBASS / Music Brain Installer" -ForegroundColor Cyan
Write-Host "  Repo: $Repo"
Write-Host ""

if ($Uninstall) {
  Write-Host "Uninstalling shortcuts + startup + env (DB kept)..." -ForegroundColor Yellow
  Remove-UserEnv "MUSIC_BRAIN_DB"
  Remove-UserEnv "MUSIC_BRAIN_ROOTS"
  Remove-UserEnv "MUSIC_BRAIN_HOME"
  @(
    (Join-Path $Desktop "SHIBASS Player.lnk")
    (Join-Path $Desktop "SHIBASS Scan.lnk")
    (Join-Path $Desktop "SHIBASS Remote.lnk")
    (Join-Path $StartupDir "SHIBASS Player.lnk")
  ) | ForEach-Object { if (Test-Path $_) { Remove-Item $_ -Force } }
  if (Test-Path $StartMenu) { Remove-Item $StartMenu -Recurse -Force }
  try { Remove-NetFirewallRule -DisplayName "SHIBASS Music Brain" -ErrorAction SilentlyContinue } catch {}
  Write-Host "Done. Scan memory left at: $Db" -ForegroundColor Green
  if (-not $NoPause) { pause }
  exit 0
}

$Py = Find-Python
if (-not $Py) {
  Write-Host "ERROR: Python 3 not on PATH. Install from python.org (Add to PATH)." -ForegroundColor Red
  if (-not $NoPause) { pause }
  exit 1
}

New-Item -ItemType Directory -Force -Path $Data | Out-Null
New-Item -ItemType Directory -Force -Path $StartMenu | Out-Null

$roots = @("H:\", "D:\", "F:\", $env:USERPROFILE) | Where-Object { Test-Path $_ }
$rootsStr = ($roots -join ";")

$config = @{
  version = "0.1.0"
  repo = $Repo
  db = $Db
  roots = $roots
  port = 18766
  player = "http://127.0.0.1:18766/"
  remote = "http://127.0.0.1:18766/remote"
  installed_at = (Get-Date).ToString("o")
}
$config | ConvertTo-Json | Set-Content -Path $Cfg -Encoding UTF8

Set-UserEnv "MUSIC_BRAIN_HOME" $Data
Set-UserEnv "MUSIC_BRAIN_DB" $Db
Set-UserEnv "MUSIC_BRAIN_ROOTS" $rootsStr

Write-Host "Scan memory DB : $Db" -ForegroundColor Green
Write-Host "Scan roots     : $rootsStr" -ForegroundColor Green

Write-Host ""
Write-Host "Installing Python package..." -ForegroundColor Cyan
Push-Location $Mb
try {
  & $Py.Exe @($Py.Args) -m pip install -e . -q
} catch {
  Write-Host "WARN: pip install failed, PYTHONPATH fallback will still work." -ForegroundColor Yellow
}
Pop-Location

# Wrapper that always uses persistent DB
$ServeWrapper = Join-Path $Data "Serve.cmd"
$ScanWrapper = Join-Path $Data "Scan.cmd"
$RemoteWrapper = Join-Path $Data "Open-Remote.cmd"

@"
@echo off
setlocal
set "MUSIC_BRAIN_DB=$Db"
set "MUSIC_BRAIN_ROOTS=$rootsStr"
set "MUSIC_BRAIN_HOME=$Data"
set "PYTHONPATH=$Mb"
cd /d "$Mb"
start "" http://127.0.0.1:18766/
where python >nul 2>&1 && python -m music_brain serve --host 0.0.0.0 --port 18766 && goto :eof
py -3 -m music_brain serve --host 0.0.0.0 --port 18766
"@ | Set-Content -Path $ServeWrapper -Encoding ASCII

@"
@echo off
setlocal
set "MUSIC_BRAIN_DB=$Db"
set "MUSIC_BRAIN_ROOTS=$rootsStr"
set "MUSIC_BRAIN_HOME=$Data"
set "PYTHONPATH=$Mb"
cd /d "$Mb"
echo Scanning into %MUSIC_BRAIN_DB%
where python >nul 2>&1 && python -m music_brain pipeline --root H:\ --root D:\ --root F:\ --root "%USERPROFILE%" -v && goto :done
py -3 -m music_brain pipeline --root H:\ --root D:\ --root F:\ --root "%USERPROFILE%" -v
:done
echo.
echo Done. Reload http://127.0.0.1:18766/
pause
"@ | Set-Content -Path $ScanWrapper -Encoding ASCII

@"
@echo off
start "" http://127.0.0.1:18766/remote
"@ | Set-Content -Path $RemoteWrapper -Encoding ASCII

New-Shortcut (Join-Path $Desktop "SHIBASS Player.lnk") $ServeWrapper $null $Data
New-Shortcut (Join-Path $Desktop "SHIBASS Scan.lnk") $ScanWrapper $null $Data
New-Shortcut (Join-Path $Desktop "SHIBASS Remote.lnk") $RemoteWrapper $null $Data
New-Shortcut (Join-Path $StartMenu "SHIBASS Player.lnk") $ServeWrapper $null $Data
New-Shortcut (Join-Path $StartMenu "SHIBASS Scan.lnk") $ScanWrapper $null $Data
New-Shortcut (Join-Path $StartMenu "SHIBASS Remote.lnk") $RemoteWrapper $null $Data
New-Shortcut (Join-Path $StartMenu "SHIBASS Full Panel.lnk") $ServeWrapper $null $Data

if ($Startup) {
  New-Shortcut (Join-Path $StartupDir "SHIBASS Player.lnk") $ServeWrapper $null $Data
  Write-Host "Startup: SHIBASS will launch with Windows." -ForegroundColor Green
}

if (-not $NoFirewall) {
  try {
    $existing = Get-NetFirewallRule -DisplayName "SHIBASS Music Brain" -ErrorAction SilentlyContinue
    if (-not $existing) {
      New-NetFirewallRule -DisplayName "SHIBASS Music Brain" -Direction Inbound -Protocol TCP -LocalPort 18766 -Action Allow -Profile Private | Out-Null
      Write-Host "Firewall: allowed TCP 18766 (Rokid / LAN)." -ForegroundColor Green
    }
  } catch {
    Write-Host "Firewall rule skipped (need Admin for Rokid LAN). Player still works on this PC." -ForegroundColor Yellow
  }
}

# Seed empty DB file so path exists
if (-not (Test-Path $Db)) {
  Push-Location $Mb
  $env:MUSIC_BRAIN_DB = $Db
  $env:PYTHONPATH = $Mb
  try {
    & $Py.Exe @($Py.Args) -c "from music_brain.db import KnowledgeDB; KnowledgeDB(r'$Db').close(); print('DB ready')"
  } catch {}
  Pop-Location
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " INSTALLED" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Desktop shortcuts:"
Write-Host "   - SHIBASS Player   (full panel + memory)"
Write-Host "   - SHIBASS Scan     (fill library once)"
Write-Host "   - SHIBASS Remote   (Rokid page)"
Write-Host ""
Write-Host " Scan memory (persistent):"
Write-Host "   $Db"
Write-Host ""
Write-Host " Next steps:"
Write-Host "   1) Double-click  SHIBASS Player"
Write-Host "   2) Double-click  SHIBASS Scan   (other window, keep Player open)"
Write-Host "   3) Reload browser http://127.0.0.1:18766/"
Write-Host ""
Write-Host " Rokid glasses (same Wi-Fi): http://<PC-IP>:18766/remote"
Write-Host ""

if (-not $NoPause) { pause }
exit 0
