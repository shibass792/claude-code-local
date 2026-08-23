#Requires -Version 5.1
<#
.SYNOPSIS
  Find the repo root folder inside an extracted GitHub branch ZIP.

.DESCRIPTION
  GitHub ZIPs contain one top-level directory. If staging has multiple folders,
  prefer the one that contains expected ShiBass/Demucs files.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$StagingDir,

  [string[]]$MarkerPaths = @(
    "scripts\wire-demucs-for-midi-forge.ps1",
    "scripts\start-demucs-pipeline.ps1",
    "tools\demucs_wav_hook.py"
  )
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $StagingDir)) {
  throw "StagingDir not found: $StagingDir"
}

$dirs = Get-ChildItem $StagingDir -Directory -ErrorAction SilentlyContinue
if (-not $dirs) {
  return $null
}

foreach ($dir in $dirs) {
  $hits = 0
  foreach ($rel in $MarkerPaths) {
    if (Test-Path (Join-Path $dir.FullName $rel)) {
      $hits++
    }
  }
  if ($hits -eq $MarkerPaths.Count) {
    return $dir.FullName
  }
}

foreach ($dir in $dirs) {
  $hits = 0
  foreach ($rel in $MarkerPaths) {
    if (Test-Path (Join-Path $dir.FullName $rel)) {
      $hits++
    }
  }
  if ($hits -gt 0) {
    return $dir.FullName
  }
}

return ($dirs | Select-Object -First 1).FullName
