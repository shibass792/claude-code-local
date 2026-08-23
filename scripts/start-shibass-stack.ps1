#Requires -Version 5.1
<#
.SYNOPSIS
  Start core ShiBass services from one place (Ollama check, Panel, Memory API).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\start-shibass-stack.ps1
  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\start-shibass-stack.ps1 -IncludeStemGroove
#>
param(
  [string]$Root = "H:\shibass-ai",
  [string]$PanelDir = "H:\shibass-ai-panel",
  [switch]$IncludeStemGroove,
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
Write-Host ""

# Ollama — usually installed as a service; only warn if down
if (-not (Test-Listening 11434)) {
  Write-Host "Ollama (11434) not listening — start Ollama app or: ollama serve" -ForegroundColor Yellow
} else {
  Write-Host "Ollama (11434) OK" -ForegroundColor Green
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

if ($IncludeStemGroove) {
  $stemServer = Join-Path $Root "stem-groove\app\server.js"
  if (Test-Listening 4050) {
    Write-Host "Stem Groove (4050) already running" -ForegroundColor DarkGray
  } else {
    Start-Detached "Stem Groove :4050" "node" @("app\server.js") (Join-Path $Root "stem-groove")
  }
}

Write-Host ""
Write-Host "Run doctor: scripts\shibass-doctor.ps1" -ForegroundColor DarkCyan
Write-Host "Social Studio: cd promo-publisher && npm start" -ForegroundColor DarkCyan
Write-Host ""
