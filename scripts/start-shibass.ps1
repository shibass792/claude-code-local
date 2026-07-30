#Requires -Version 5.1
<#
.SYNOPSIS
  Start the full ShiBass local stack as one system:
  Ollama + Brain context + AI panel (8787).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File H:\models\start-shibass.ps1
  powershell -ExecutionPolicy Bypass -File H:\models\start-shibass.ps1 -NoBrowser
  powershell -ExecutionPolicy Bypass -File H:\models\start-shibass.ps1 -RefreshIndex
#>
param(
  [string]$PanelDir = "H:\shibass-ai-panel",
  [string]$BrainRoot = "H:\shibass-ai\SHIBASS_BRAIN",
  [string]$ModelsDir = "H:\models",
  [int]$Port = 8787,
  [string]$OllamaUrl = "http://127.0.0.1:11434",
  [switch]$NoBrowser,
  [switch]$RefreshIndex,
  [string[]]$IndexRoots = @("H:\shibass-ai", "H:\shibass-ai\SHIBASS_BRAIN", "H:\daw-handoff", "H:\ai-knowledge")
)

$ErrorActionPreference = "Continue"

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Magenta
}

function Test-Url([string]$url) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
    return $true
  } catch {
    return $false
  }
}

function Stop-Port([int]$p) {
  try {
    $ids = (Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique
    foreach ($id in $ids) {
      if ($id -and $id -gt 0) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
        Write-Host "  stopped PID $id on port $p" -ForegroundColor DarkYellow
      }
    }
  } catch { }
}

Write-Host ""
Write-Host "ShiBass OS launcher" -ForegroundColor Cyan
Write-Host "Panel=$PanelDir  Port=$Port  Brain=$BrainRoot"

# 1) Paths
Write-Step "Check folders"
foreach ($d in @($PanelDir, $ModelsDir, $BrainRoot)) {
  if (-not (Test-Path $d)) {
    Write-Host "  missing: $d" -ForegroundColor Yellow
  } else {
    Write-Host "  ok: $d" -ForegroundColor Green
  }
}

if (-not (Test-Path $PanelDir)) { throw "Panel folder missing: $PanelDir" }
if (-not (Test-Path (Join-Path $PanelDir "server.js"))) { throw "server.js missing in $PanelDir - run install-windows-scripts.ps1" }
if (-not (Test-Path (Join-Path $PanelDir "node_modules"))) {
  Write-Step "npm install"
  Push-Location $PanelDir
  npm install
  Pop-Location
}

# 2) Brain
Write-Step "Brain ready + ExportContext"
$init = Join-Path $ModelsDir "shibass-brain\init-brain.ps1"
$brain = Join-Path $ModelsDir "shibass-brain\brain.ps1"
$import = Join-Path $ModelsDir "shibass-brain\import-session-memory.ps1"
if (Test-Path $init) {
  & powershell -ExecutionPolicy Bypass -File $init | Out-Host
}
if ((Test-Path $import) -and -not (Test-Path (Join-Path $BrainRoot "system\session_memory\WORKING_STACK.md"))) {
  & powershell -ExecutionPolicy Bypass -File $import | Out-Host
}
if (Test-Path $brain) {
  & powershell -ExecutionPolicy Bypass -File $brain -ExportContext | Out-Null
  Write-Host "  context exported" -ForegroundColor Green
}

# 3) Ollama
Write-Step "Ollama"
if (-not (Test-Url "$OllamaUrl/api/tags")) {
  Write-Host "  trying to start Ollama..." -ForegroundColor Yellow
  $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
  if ($ollamaCmd) {
    Start-Process -FilePath $ollamaCmd.Source -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
  } else {
    $candidates = @(
      "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
      "C:\Program Files\Ollama\ollama.exe"
    )
    foreach ($c in $candidates) {
      if (Test-Path $c) {
        Start-Process -FilePath $c -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 3
        break
      }
    }
  }
}
if (Test-Url "$OllamaUrl/api/tags") {
  Write-Host "  Ollama OK $OllamaUrl" -ForegroundColor Green
} else {
  Write-Host "  Ollama not reachable - start the Ollama app manually" -ForegroundColor Red
}

# 4) Optional index refresh
if ($RefreshIndex) {
  Write-Step "Refresh path index (can take long)"
  $know = Join-Path $ModelsDir "knowledge-from-drives.ps1"
  if (Test-Path $know) {
    & $know -Index -Roots $IndexRoots
  } else {
    Write-Host "  missing $know" -ForegroundColor Yellow
  }
}

# 5) Panel
Write-Step "Start panel on $Port"
Stop-Port $Port
$env:PORT = "$Port"
$env:OLLAMA_URL = $OllamaUrl
$env:INDEX_FILE = "H:\ai-knowledge\drive-index.jsonl"
$env:KNOWLEDGE_SCRIPT = (Join-Path $ModelsDir "knowledge-from-drives.ps1")
$env:WAIT_SCRIPT = (Join-Path $ModelsDir "wait-then-ask.ps1")
$env:BRAIN_CONTEXT = (Join-Path $BrainRoot "system\context_for_model.txt")
$env:BRAIN_SCRIPT = $brain
$env:BRAIN_FACTS = (Join-Path $BrainRoot "system\facts.jsonl")

$startInfo = @"
Set-Location '$PanelDir'
`$env:PORT = '$Port'
`$env:OLLAMA_URL = '$OllamaUrl'
`$env:INDEX_FILE = 'H:\ai-knowledge\drive-index.jsonl'
`$env:KNOWLEDGE_SCRIPT = '$($env:KNOWLEDGE_SCRIPT)'
`$env:WAIT_SCRIPT = '$($env:WAIT_SCRIPT)'
`$env:BRAIN_CONTEXT = '$($env:BRAIN_CONTEXT)'
`$env:BRAIN_SCRIPT = '$($env:BRAIN_SCRIPT)'
`$env:BRAIN_FACTS = '$($env:BRAIN_FACTS)'
npm start
"@
$tmpStart = Join-Path $env:TEMP "start-shibass-panel.ps1"
Set-Content -Path $tmpStart -Value $startInfo -Encoding UTF8

Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy", "Bypass",
  "-File", $tmpStart
) | Out-Null

$url = "http://127.0.0.1:$Port"
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Url "$url/api/status") { $ready = $true; break }
}

Write-Step "Status"
if ($ready) {
  try {
    $st = Invoke-RestMethod -Uri "$url/api/status" -TimeoutSec 5
    Write-Host ("  panel: {0}" -f $url) -ForegroundColor Green
    Write-Host ("  model: {0}" -f $st.model) -ForegroundColor Green
    Write-Host ("  brain facts: {0}" -f $st.brainFactsCount) -ForegroundColor Green
    if ($st.index.exists) {
      Write-Host ("  index: {0} bytes" -f $st.index.bytes) -ForegroundColor Green
    } else {
      Write-Host "  index: missing" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "  panel up but status parse failed" -ForegroundColor Yellow
  }
  if (-not $NoBrowser) {
    Start-Process $url
  }
} else {
  Write-Host "  panel did not become ready in time - check the npm window" -ForegroundColor Red
}

Write-Host ""
Write-Host "Unified stack:" -ForegroundColor Cyan
Write-Host "  Brain mode in UI = confirmed facts"
Write-Host "  Brain + drives = facts + live file pull"
Write-Host "  DAW handoff = H:\models\daw-handoff.ps1"
Write-Host ""
