#Requires -Version 5.1
param(
  [string]$Root = "H:\shibass-ai"
)

$envFile = Join-Path $Root "config\demucs.env"
if (-not (Test-Path $envFile)) {
  Write-Host "Missing $envFile — run scripts\wire-demucs-for-midi-forge.ps1" -ForegroundColor Red
  exit 1
}

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^([^=]+)=(.*)$') {
    Set-Item -Path ("Env:" + $matches[1]) -Value $matches[2]
  }
}

Write-Host "Loaded Demucs env from $envFile" -ForegroundColor Green
