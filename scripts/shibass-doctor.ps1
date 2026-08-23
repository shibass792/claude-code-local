#Requires -Version 5.1
<#
.SYNOPSIS
  ShiBass system health check — ports, paths, Python, Node, GPU.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\shibass-doctor.ps1
#>
param(
  [string]$Root = "H:\shibass-ai",
  [string]$PanelDir = "H:\shibass-ai-panel",
  [string]$PortsFile = ""
)

$ErrorActionPreference = "Continue"

function Test-Port([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $conn) { return $null }
  $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  return [PSCustomObject]@{
    Port = $Port
    PID = $conn.OwningProcess
    Process = if ($proc) { $proc.ProcessName } else { "?" }
    Path = if ($proc) { $proc.Path } else { $null }
  }
}

function Test-Http([string]$Url) {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
    return "HTTP $($r.StatusCode)"
  } catch {
    return "FAIL"
  }
}

Write-Host ""
Write-Host "ShiBass Doctor" -ForegroundColor Cyan
Write-Host "Root: $Root"
Write-Host ""

# --- Paths ---
Write-Host "== Paths ==" -ForegroundColor Magenta
$paths = @(
  $Root,
  "$Root\10_OUTPUTS\MIDI_EXPORT",
  "$Root\SHIBASS_BRAIN",
  "$Root\SHIBASS_SHARED_MEMORY",
  "$Root\SHIBASS_SHARED_MEMORY\tools\shibass_memory_api.py",
  "$Root\tools\synths_midi_server.py",
  "$Root\stem-groove\app\server.js",
  "$PanelDir\server.js",
  "$Root\promo-publisher\main.js"
)
foreach ($p in $paths) {
  if (Test-Path $p) {
    Write-Host "  OK   $p" -ForegroundColor Green
  } else {
    Write-Host "  MISS $p" -ForegroundColor Yellow
  }
}

# --- Staging clutter ---
Write-Host ""
Write-Host "== Install staging ==" -ForegroundColor Magenta
$staging = Join-Path $Root ".install-staging"
if (Test-Path $staging) {
  $count = (Get-ChildItem $staging -Directory -ErrorAction SilentlyContinue).Count
  Write-Host "  $count folders under .install-staging" -ForegroundColor $(if ($count -gt 3) { "Yellow" } else { "Green" })
  if ($count -gt 3) {
    Write-Host "  TIP: keep ONE copy in H:\shibass-ai\stem-groove, archive the rest" -ForegroundColor DarkYellow
  }
}

# --- Ports ---
Write-Host ""
Write-Host "== Ports ==" -ForegroundColor Magenta
$defaultPorts = @(
  @{ Port = 11434; Name = "Ollama"; Url = "http://127.0.0.1:11434/api/tags" },
  @{ Port = 8787; Name = "AI Panel"; Url = "http://127.0.0.1:8787/api/status" },
  @{ Port = 8792; Name = "Memory API"; Url = "http://127.0.0.1:8792/" },
  @{ Port = 4050; Name = "Stem Groove"; Url = "http://127.0.0.1:4050/" },
  @{ Port = 8765; Name = "MIDI Server"; Url = "http://127.0.0.1:8765/health" }
)
foreach ($svc in $defaultPorts) {
  $listen = Test-Port $svc.Port
  $http = Test-Http $svc.Url
  if ($listen) {
    Write-Host ("  :{0,-5} {1,-12} PID={2} {3}  HTTP={4}" -f $svc.Port, $svc.Name, $listen.PID, $listen.Process, $http) -ForegroundColor Green
  } else {
    Write-Host ("  :{0,-5} {1,-12} not listening  HTTP={2}" -f $svc.Port, $svc.Name, $http) -ForegroundColor DarkGray
  }
}

# --- Python / Node ---
Write-Host ""
Write-Host "== Runtimes ==" -ForegroundColor Magenta
foreach ($cmd in @("python", "node", "ollama", "nvidia-smi")) {
  $c = Get-Command $cmd -ErrorAction SilentlyContinue
  if ($c) {
    Write-Host "  OK   $($c.Source)" -ForegroundColor Green
  } else {
    Write-Host "  MISS $cmd" -ForegroundColor Yellow
  }
}

# --- Broken batch hint ---
Write-Host ""
Write-Host "== Tips ==" -ForegroundColor Magenta
Write-Host "  - WinError 10053 on Memory API = client disconnected (usually OK)"
Write-Host "  - 'cho'/'/d' errors in .cmd = fix CRLF + UTF-8 on batch files"
Write-Host "  - See docs/SHIBASS_SYSTEM_MAP.md in repo"
Write-Host ""
