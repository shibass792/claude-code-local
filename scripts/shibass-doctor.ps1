#Requires -Version 5.1
param(
  [string]$Root = "H:\shibass-ai",
  [string]$PanelDir = "H:\shibass-ai-panel",
  [string]$PortsFile = ""
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $PortsFile) {
  $PortsFile = Join-Path $scriptDir "config\shibass-ports.json"
}

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

function Get-PortChecksFromJson([string]$JsonPath) {
  if (-not (Test-Path $JsonPath)) { return @() }
  try {
    $cfg = Get-Content $JsonPath -Raw | ConvertFrom-Json
  } catch {
    return @()
  }
  $checks = @()
  foreach ($section in @("tier1_always_on", "tier2_panel_managed", "dev_only")) {
    $block = $cfg.$section
    if (-not $block) { continue }
    $block.PSObject.Properties | ForEach-Object {
      $svc = $_.Value
      if ($svc.port) {
        $health = if ($svc.health) { $svc.health } else { "/" }
        $base = if ($svc.url) { $svc.url.TrimEnd('/') } else { "http://127.0.0.1:$($svc.port)" }
        $checks += [PSCustomObject]@{
          Port = [int]$svc.port
          Name = if ($svc.name) { $svc.name } else { $_.Name }
          Url = "$base$health"
        }
      }
    }
  }
  return $checks | Sort-Object Port -Unique
}

Write-Host ""
Write-Host "ShiBass Doctor" -ForegroundColor Cyan
Write-Host "Root: $Root"
if (Test-Path $PortsFile) {
  Write-Host "Ports: $PortsFile" -ForegroundColor DarkGray
}
Write-Host ""

Write-Host "== Paths ==" -ForegroundColor Magenta
$paths = @(
  $Root,
  "$Root\shibass.db",
  "$Root\10_OUTPUTS\MIDI_EXPORT",
  "$Root\10_OUTPUTS\stems",
  "$Root\.venv-demucs\Scripts\python.exe",
  "$Root\config\demucs.env",
  "$Root\tools\demucs_wav_hook.py",
  "$Root\10_OUTPUTS\social",
  "$Root\SHIBASS_BRAIN",
  "$Root\SHIBASS_SHARED_MEMORY",
  "$Root\SHIBASS_INDEX_MEMORY_ENGINE",
  "$Root\SHIBASS_SHARED_MEMORY\tools\shibass_memory_api.py",
  "$Root\tools\synths_midi_server.py",
  "$Root\07_LOGS\port_status.json",
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

Write-Host ""
Write-Host "== Install staging ==" -ForegroundColor Magenta
$staging = Join-Path $Root ".install-staging"
if (Test-Path $staging) {
  $count = (Get-ChildItem $staging -Directory -ErrorAction SilentlyContinue).Count
  Write-Host "  $count folders under .install-staging" -ForegroundColor $(if ($count -gt 3) { "Yellow" } else { "Green" })
}

Write-Host ""
Write-Host "== Ports ==" -ForegroundColor Magenta
$portChecks = Get-PortChecksFromJson $PortsFile
if ($portChecks.Count -eq 0) {
  $portChecks = @(
    [PSCustomObject]@{ Port = 11434; Name = "Ollama"; Url = "http://127.0.0.1:11434/api/tags" },
    [PSCustomObject]@{ Port = 4000; Name = "AI IDE"; Url = "http://127.0.0.1:4000/api/ops/health" },
    [PSCustomObject]@{ Port = 4050; Name = "Promo Publisher"; Url = "http://127.0.0.1:4050/" },
    [PSCustomObject]@{ Port = 8015; Name = "Audio Worker"; Url = "http://127.0.0.1:8015/" },
    [PSCustomObject]@{ Port = 8765; Name = "Master Server"; Url = "http://127.0.0.1:8765/" },
    [PSCustomObject]@{ Port = 8787; Name = "AI Panel"; Url = "http://127.0.0.1:8787/api/status" },
    [PSCustomObject]@{ Port = 8792; Name = "Memory API"; Url = "http://127.0.0.1:8792/" },
    [PSCustomObject]@{ Port = 4495; Name = "Index Memory"; Url = "http://127.0.0.1:4495/docs" }
  )
}
foreach ($svc in $portChecks) {
  $listen = Test-Port $svc.Port
  $http = Test-Http $svc.Url
  if ($listen) {
    Write-Host ("  :{0,-5} {1,-22} PID={2} {3}  HTTP={4}" -f $svc.Port, $svc.Name, $listen.PID, $listen.Process, $http) -ForegroundColor Green
  } else {
    Write-Host ("  :{0,-5} {1,-22} not listening  HTTP={2}" -f $svc.Port, $svc.Name, $http) -ForegroundColor DarkGray
  }
}

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

Write-Host ""
Write-Host "== Tips ==" -ForegroundColor Magenta
Write-Host "  - 4050 = Promo Publisher (NOT stem-groove)"
Write-Host "  - 8765 = Master Server — do NOT bind MIDI stub there (use 8877)"
Write-Host "  - Check 07_LOGS\port_status.json before ports 8788-8859"
Write-Host "  - Demucs: scripts\wire-demucs-for-midi-forge.ps1 then START-MIDI-FORGE-DEMUCS.cmd"
Write-Host "  - See docs/WIRE_DEMUCS_MIDI_FORGE.md"
Write-Host ""
