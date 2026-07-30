# Quick AI search from command line
# Usage: .\search.ps1 "באס כמו Astrix"
#        .\search.ps1 "kick 145 full on"

param(
    [Parameter(Mandatory=$true)][string]$Query,
    [int]$Limit = 20
)

$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root
. (Join-Path $Root ".venv\Scripts\Activate.ps1")
music-brain search $Query --limit $Limit
