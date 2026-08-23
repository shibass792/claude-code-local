# Backup music_brain.db
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root
. (Join-Path $Root ".venv\Scripts\Activate.ps1")
music-brain backup
