#Requires -Version 5.1
<#
.SYNOPSIS
  Watch 10_OUTPUTS\MIDI_EXPORT and run Demucs on new WAV/MP3 files.

  Use when MIDI Forge (8791) logs:
    "audio stage not wired yet (Demucs venv), skipping."

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\watch-midi-export-demucs.ps1
#>
param(
  [string]$Root = "H:\shibass-ai",
  [int]$PollSeconds = 5,
  [switch]$RunOnce
)

$ErrorActionPreference = "Continue"

$watchDir = Join-Path $Root "10_OUTPUTS\MIDI_EXPORT"
$stateFile = Join-Path $Root "config\demucs-processed.json"
$envFile = Join-Path $Root "config\demucs.env"
$hook = Join-Path $Root "tools\demucs_wav_hook.py"

function Load-DemucsEnv {
  if (-not (Test-Path $envFile)) { return }
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') {
      Set-Item -Path ("Env:" + $matches[1]) -Value $matches[2]
    }
  }
}

function Get-ProcessedMap {
  if (-not (Test-Path $stateFile)) { return @{} }
  try {
    $raw = Get-Content $stateFile -Raw | ConvertFrom-Json
    $map = @{}
    $raw.PSObject.Properties | ForEach-Object { $map[$_.Name] = $_.Value }
    return $map
  } catch {
    return @{}
  }
}

function Save-ProcessedMap([hashtable]$Map) {
  $dir = Split-Path $stateFile -Parent
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $obj = New-Object PSObject
  foreach ($key in ($Map.Keys | Sort-Object)) {
    $obj | Add-Member -NotePropertyName $key -NotePropertyValue $Map[$key]
  }
  $obj | ConvertTo-Json | Set-Content -Path $stateFile -Encoding UTF8
}

function Get-FileSignature([string]$Path) {
  $item = Get-Item $Path
  return ($item.FullName + "|" + $item.Length + "|" + $item.LastWriteTimeUtc.Ticks)
}

Load-DemucsEnv

if (-not (Test-Path $watchDir)) {
  New-Item -ItemType Directory -Path $watchDir -Force | Out-Null
}

$venvPy = $env:SHIBASS_DEMUCS_VENV
if ($venvPy) {
  $venvPy = Join-Path $venvPy "Scripts\python.exe"
}
if (-not $venvPy -or -not (Test-Path $venvPy)) {
  $venvPy = Join-Path $Root ".venv-demucs\Scripts\python.exe"
}

if (-not (Test-Path $venvPy)) {
  Write-Host "Demucs venv missing. Run:" -ForegroundColor Red
  Write-Host "  scripts\wire-demucs-for-midi-forge.ps1"
  exit 1
}

if (-not (Test-Path $hook)) {
  Write-Host "Hook missing: $hook" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Demucs MIDI_EXPORT watcher" -ForegroundColor Cyan
Write-Host ("Watch: " + $watchDir)
Write-Host ("Python: " + $venvPy)
Write-Host ("Poll:  " + $PollSeconds + "s")
Write-Host ""

$processed = Get-ProcessedMap

while ($true) {
  $files = Get-ChildItem -Path $watchDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -match '^\.(wav|mp3|flac|m4a)$' }

  foreach ($f in $files) {
    $sig = Get-FileSignature $f.FullName
    if ($processed.ContainsKey($f.FullName) -and $processed[$f.FullName] -eq $sig) {
      continue
    }

    Write-Host ("[*] " + $f.Name + ": running Demucs...") -ForegroundColor Yellow
    & $venvPy $hook $f.FullName
    if ($LASTEXITCODE -eq 0) {
      Write-Host ("[+] " + $f.Name + ": stems ready") -ForegroundColor Green
      $processed[$f.FullName] = $sig
      Save-ProcessedMap $processed
    } else {
      Write-Host ("[!] " + $f.Name + ": demucs failed (exit " + $LASTEXITCODE + ")") -ForegroundColor Red
    }
  }

  if ($RunOnce -or $env:SHIBASS_DEMUCS_RUN_ONCE -eq "1") {
    Write-Host "RunOnce complete." -ForegroundColor Cyan
    break
  }

  Start-Sleep -Seconds $PollSeconds
}
