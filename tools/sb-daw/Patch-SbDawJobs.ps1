#Requires -Version 5.1
# ASCII-only. Windows PowerShell 5.1 reads this as ANSI; a UTF-8 em-dash
# becomes a stray quote and breaks the parser ("string is missing the terminator").
param(
  [string]$TargetRoot = "H:\shibass-ai",
  [string]$Branch = "cursor/real-studio-apis-0b72",
  [string]$RepoSlug = "shibass792/claude-code-local",
  [switch]$RewriteHtml
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step([string]$Message) { Write-Host "[>] $Message" }
function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "[!] $Message" -ForegroundColor Yellow }

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
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

$files = @(
  "jobs.js",
  "http.js",
  "mount.js",
  "patch-server.js",
  "patch-fastapi.js",
  "patch-html.js",
  "health-scan.js",
  "apply.js",
  "fastapi_jobs.py",
  "Patch-SbDawJobs.ps1"
)

Write-Host "===================================================================="
Write-Host "  ShiBass - mount /api/sb-daw/jobs/ on server.js"
Write-Host "===================================================================="
Write-Host ("Target: " + $TargetRoot)
Write-Host ("Branch: " + $Branch)
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node.exe is not on PATH. Install Node.js, then rerun."
}

$dest = Join-Path $TargetRoot "tools\sb-daw"
Ensure-Directory $dest

$haveLocal = Test-Path -LiteralPath (Join-Path $dest "apply.js")
$repoCopy = Join-Path $PSScriptRoot "apply.js"
if (Test-Path -LiteralPath $repoCopy) {
  Write-Step "Copying tools from this folder"
  foreach ($name in $files) {
    $src = Join-Path $PSScriptRoot $name
    if (Test-Path -LiteralPath $src) {
      Copy-Item -LiteralPath $src -Destination (Join-Path $dest $name) -Force
    }
  }
} elseif (-not $haveLocal) {
  foreach ($name in $files) {
    Install-File ("tools/sb-daw/" + $name) (Join-Path $dest $name)
  }
}

$apply = Join-Path $dest "apply.js"
if (-not (Test-Path -LiteralPath $apply)) {
  throw "apply.js is missing under $dest"
}

Write-Step "Patching server.js (and FastAPI / sb-daw.html if found)"
$argsList = @($apply, $TargetRoot)
if ($RewriteHtml) {
  $argsList += "--rewrite-html"
}
& node @argsList
if ($LASTEXITCODE -ne 0) {
  throw "apply.js failed with exit $LASTEXITCODE"
}

$serverJs = Join-Path $TargetRoot "server.js"
if (Test-Path -LiteralPath $serverJs) {
  $text = Get-Content -LiteralPath $serverJs -Raw
  if ($text -notmatch "/api/sb-daw/jobs/") {
    throw "server.js still missing /api/sb-daw/jobs/ after patch"
  }
  Write-Ok "server.js now contains /api/sb-daw/jobs/"
} else {
  Write-Warn "server.js not found at $serverJs - apply.js should have said so"
}

Write-Host ""
Write-Ok "Done. Restart node server.js (port 4000)."
Write-Host "If Synth Studio FastAPI was patched, restart that process on 8788."
Write-Host "Then reload http://127.0.0.1:8788/sb-daw.html"
Write-Host "Do not start a second listener on 8788."
