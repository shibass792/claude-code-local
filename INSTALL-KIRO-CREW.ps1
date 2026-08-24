#Requires -Version 5.1
# ASCII-only. Clones and builds Kiro Crew next to ShiBass.
# Dashboard stays on 5476. Never binds 4000, 4052, or 8788.
param(
  [string]$TargetRoot = "H:\shibass-ai",
  [string]$RepoUrl = "https://github.com/kirodotdev/KiroCrew.git"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step([string]$Message) { Write-Host "[>] $Message" }
function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is not on PATH. Install Git for Windows, then rerun."
}

$clone = Join-Path $TargetRoot "KiroCrew"
if (-not (Test-Path -LiteralPath $TargetRoot)) {
  New-Item -ItemType Directory -Path $TargetRoot -Force | Out-Null
}

if (Test-Path -LiteralPath (Join-Path $clone ".git")) {
  Write-Step ("git pull in " + $clone)
  & git -C $clone pull --ff-only
  if ($LASTEXITCODE -ne 0) {
    throw "git pull failed in $clone"
  }
} else {
  Write-Step ("git clone -> " + $clone)
  & git clone --depth 1 $RepoUrl $clone
  if ($LASTEXITCODE -ne 0) {
    throw "git clone failed"
  }
}

$make = Join-Path $clone "make.ps1"
if (-not (Test-Path -LiteralPath $make)) {
  throw "make.ps1 missing after clone"
}

Write-Step "Building Kiro Crew (python venv + optional dashboard). This takes a while."
& powershell -NoProfile -ExecutionPolicy Bypass -File $make build
if ($LASTEXITCODE -ne 0) {
  throw "make.ps1 build failed. Need Python 3.12 (py -3.12) and optionally Node LTS."
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
foreach ($name in @("START-KIRO-CREW.ps1", "START-KIRO-CREW.cmd")) {
  $src = Join-Path $here $name
  if (Test-Path -LiteralPath $src) {
    Copy-Item -LiteralPath $src -Destination (Join-Path $TargetRoot $name) -Force
  }
}

Write-Ok "Kiro Crew is on disk at $clone"
Write-Host "Next:"
Write-Host "  cd $clone"
Write-Host "  .\.venv\Scripts\kirocrew.exe setup"
Write-Host "Then start the dashboard on 5476:"
Write-Host "  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\START-KIRO-CREW.ps1"
Write-Host "ShiBass stays on 4000 / 4052. Synth Studio stays on 8788."
