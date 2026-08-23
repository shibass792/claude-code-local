#Requires -Version 5.1
<#
.SYNOPSIS
  Rewrite hardcoded path prefixes in ShiBass scripts and config files.

.DESCRIPTION
  Walks text files under Root and replaces OldPrefix with NewPrefix.
  Skips binary extensions and common vendor folders.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\tools\script_fix_paths.ps1 `
    -Root H:\shibass-ai -OldPrefix "D:\shibass-ai" -NewPrefix "H:\shibass-ai"

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\tools\script_fix_paths.ps1 -WhatIf
#>
param(
  [string]$Root = "H:\shibass-ai",
  [Parameter(Mandatory = $true)]
  [string]$OldPrefix,
  [string]$NewPrefix = "H:\shibass-ai",
  [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Root)) {
  Write-Error "Root not found: $Root"
  exit 1
}

$NewPrefix = $NewPrefix.TrimEnd('\')
$OldPrefix = $OldPrefix.TrimEnd('\')

if ($OldPrefix -eq $NewPrefix) {
  Write-Host "OldPrefix and NewPrefix are the same; nothing to do." -ForegroundColor Yellow
  exit 0
}

$textExtensions = @(
  ".ps1", ".cmd", ".bat", ".py", ".json", ".env", ".md", ".js", ".html",
  ".css", ".txt", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".xml", ".csv"
)

$skipDirPattern = '(\\|/)(node_modules|\.git|\.venv|\.venv-demucs|__pycache__|dist|build|\.electron-user-data|07_LOGS)(\\|/)'

$oldVariants = @(
  $OldPrefix,
  ($OldPrefix -replace '\\', '/'),
  ($OldPrefix.ToLowerInvariant()),
  (($OldPrefix -replace '\\', '/').ToLowerInvariant())
) | Select-Object -Unique

$newVariants = @(
  $NewPrefix,
  ($NewPrefix -replace '\\', '/'),
  ($NewPrefix.ToLowerInvariant()),
  (($NewPrefix -replace '\\', '/').ToLowerInvariant())
)

$changed = 0
$scanned = 0

Get-ChildItem -LiteralPath $Root -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.FullName -match $skipDirPattern) {
    return
  }

  $ext = $_.Extension.ToLowerInvariant()
  if ($textExtensions -notcontains $ext) {
    return
  }

  $scanned++
  try {
    $content = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction Stop
  } catch {
    return
  }

  if (-not $content) {
    return
  }

  $updated = $content
  for ($i = 0; $i -lt $oldVariants.Count; $i++) {
    $updated = $updated.Replace($oldVariants[$i], $newVariants[$i])
  }

  if ($updated -eq $content) {
    return
  }

  $relative = $_.FullName.Substring($Root.Length).TrimStart('\')
  if ($WhatIf) {
    Write-Host ("WOULD UPDATE " + $relative) -ForegroundColor Yellow
  } else {
    Set-Content -LiteralPath $_.FullName -Value $updated -Encoding UTF8
    Write-Host ("UPDATED " + $relative) -ForegroundColor Green
  }
  $changed++
}

Write-Host ""
Write-Host ("Scanned: " + $scanned + " text files") -ForegroundColor Cyan
Write-Host ("Changed: " + $changed) -ForegroundColor Cyan
Write-Host ("Replace: " + $OldPrefix + " -> " + $NewPrefix) -ForegroundColor DarkGray
