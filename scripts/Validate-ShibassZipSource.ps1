#Requires -Version 5.1
<#
.SYNOPSIS
  Shared validation for ShiBass branch ZIP contents before copy/install.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot
)

$ErrorActionPreference = "Stop"

$script:RequiredInZip = @(
  "scripts\wire-demucs-for-midi-forge.ps1",
  "scripts\start-demucs-pipeline.ps1",
  "scripts\watch-midi-export-demucs.ps1",
  "tools\demucs_wav_hook.py",
  "tools\script_fix_paths.ps1",
  "promo-publisher\main.js"
)

function Get-ShibassZipMissingFiles {
  param([string]$Root)
  $missing = @()
  foreach ($rel in $script:RequiredInZip) {
    if (-not (Test-Path (Join-Path $Root $rel))) {
      $missing += $rel
    }
  }
  return $missing
}

function Test-ScriptFixPathsBroken {
  param([string]$Root)
  $path = Join-Path $Root "tools\script_fix_paths.ps1"
  if (-not (Test-Path $path)) {
    return $false
  }
  $content = Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue
  if (-not $content) {
    return $false
  }
  return ($content -match '\$\.PSIsContainer')
}

function Test-ShibassZipSourceValid {
  param([string]$Root)
  $result = [ordered]@{
    MissingFiles = @()
    ScriptFixPathsBroken = $false
    Ok = $false
  }

  $result.MissingFiles = @(Get-ShibassZipMissingFiles -Root $Root)
  $result.ScriptFixPathsBroken = Test-ScriptFixPathsBroken -Root $Root
  $result.Ok = ($result.MissingFiles.Count -eq 0 -and -not $result.ScriptFixPathsBroken)
  return [pscustomobject]$result
}

if ($MyInvocation.InvocationName -ne '.') {
  Test-ShibassZipSourceValid -Root $SourceRoot
}
