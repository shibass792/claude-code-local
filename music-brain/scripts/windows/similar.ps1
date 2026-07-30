# Find similar sounds
# Usage: .\similar.ps1 -Style astrix
#        .\similar.ps1 -Path "H:\Samples\bass\rolling.wav"

param(
    [string]$Style,
    [string]$Path,
    [int]$Limit = 20
)

$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root
. (Join-Path $Root ".venv\Scripts\Activate.ps1")

if ($Style) {
    music-brain similar dummy --style $Style --limit $Limit
} elseif ($Path) {
    music-brain similar $Path --limit $Limit
} else {
    Write-Error "Use -Style astrix OR -Path 'path\to\file.wav'"
}
