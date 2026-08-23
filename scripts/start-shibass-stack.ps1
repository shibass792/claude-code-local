#Requires -Version 5.1
<#
.SYNOPSIS
  Start core ShiBass services (Main IDE 4000, Panel 8787, Memory APIs).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\start-shibass-stack.ps1
  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\start-shibass-stack.ps1 -IncludeIndexMemory
#>
param(
  [string]$Root = "H:\shibass-ai",
  [string]$PanelDir = "H:\shibass-ai-panel",
  [switch]$IncludeIndexMemory,
  [switch]$IncludeDemucsWatcher,
  [switch]$IncludeStudioApi,
  [switch]$SkipMainIde,
  [switch]$SkipPanel,
  [switch]$SkipMemory
)

$ErrorActionPreference = "Stop"

function Test-Listening([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Start-Detached([string]$Title, [string]$FilePath, [string[]]$Args, [string]$WorkDir) {
  if (-not (Test-Path $FilePath)) {
    Write-Host "  SKIP $Title — missing $FilePath" -ForegroundColor Yellow
    return
  }
  Start-Process -FilePath $FilePath -ArgumentList $Args -WorkingDirectory $WorkDir -WindowStyle Minimized | Out-Null
  Write-Host "  START $Title" -ForegroundColor Green
}

Write-Host ""
Write-Host "ShiBass Stack Launcher" -ForegroundColor Cyan
Write-Host "Root: $Root"
Write-Host "NOTE: 4050 Promo Publisher and 8765 Master Server are usually already running — not started here."
Write-Host "      Studio live API (4051): pass -IncludeStudioApi or use START-ALL-SHIBASS.cmd"
Write-Host ""

if (-not (Test-Listening 11434)) {
  Write-Host "Ollama (11434) not listening — start Ollama app or: ollama serve" -ForegroundColor Yellow
} else {
  Write-Host "Ollama (11434) OK" -ForegroundColor Green
}

if (-not $SkipMainIde) {
  if (Test-Listening 4000) {
    Write-Host "Main IDE (4000) already running" -ForegroundColor DarkGray
  } else {
    Start-Detached "Main IDE :4000" "node" @("server.js") $Root
  }
}

if (-not $SkipPanel) {
  if (Test-Listening 8787) {
    Write-Host "AI Panel (8787) already running" -ForegroundColor DarkGray
  } else {
    Start-Detached "AI Panel :8787" "node" @("server.js") $PanelDir
  }
}

if (-not $SkipMemory) {
  $memoryScript = Join-Path $Root "SHIBASS_SHARED_MEMORY\tools\shibass_memory_api.py"
  if (Test-Listening 8792) {
    Write-Host "Memory API (8792) already running" -ForegroundColor DarkGray
  } else {
    Start-Detached "Memory API :8792" "python" @($memoryScript) (Split-Path $memoryScript -Parent)
  }
}

if ($IncludeIndexMemory) {
  $indexScript = Join-Path $Root "SHIBASS_INDEX_MEMORY_ENGINE\api\memory_server.py"
  if (Test-Listening 4495) {
    Write-Host "Index Memory (4495) already running" -ForegroundColor DarkGray
  } else {
    Start-Detached "Index Memory :4495" "python" @("api\memory_server.py") (Join-Path $Root "SHIBASS_INDEX_MEMORY_ENGINE")
  }
}

if ($IncludeDemucsWatcher) {
  $demucsScript = Join-Path $Root "scripts\start-demucs-pipeline.ps1"
  if (Test-Path $demucsScript) {
    Start-Process -FilePath "powershell" -ArgumentList @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $demucsScript, "-Root", $Root, "-SkipWire"
    ) -WorkingDirectory $Root -WindowStyle Minimized | Out-Null
    Write-Host "Demucs watcher started (MIDI_EXPORT)" -ForegroundColor Green
  } else {
    Write-Host "SKIP Demucs — missing $demucsScript" -ForegroundColor Yellow
  }
}

if ($IncludeStudioApi) {
  $apiServer = Join-Path $Root "promo-publisher\api-server.js"
  if (Test-Listening 4051) {
    Write-Host "Studio API (4051) already running" -ForegroundColor DarkGray
  } elseif (Test-Path $apiServer) {
    Start-Detached "Studio API :4051" "node" @("api-server.js") (Join-Path $Root "promo-publisher")
  } else {
    Write-Host "SKIP Studio API — missing $apiServer (run INSTALL-ALL-SHIBASS.cmd)" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Doctor: scripts\shibass-doctor.ps1" -ForegroundColor DarkCyan
Write-Host "Studio: START-ALL-SHIBASS.cmd  or  http://127.0.0.1:4051/" -ForegroundColor DarkCyan
Write-Host "Demucs: docs\DEMUCS_QUICKSTART_HE.md" -ForegroundColor DarkCyan
Write-Host "Install: docs\WINDOWS_INSTALL_ALL_HE.md" -ForegroundColor DarkCyan
Write-Host ""
