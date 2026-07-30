#Requires -Version 5.1
<#
.SYNOPSIS
  ShiBass Brain Phase 1 fact memory (confidence-tagged JSONL).

.EXAMPLE
  .\brain.ps1 -AddFact -Category preference -Text "BPM 140-143" -Confidence confirmed -Source user
  .\brain.ps1 -Confirm -Query "BPM"
  .\brain.ps1 -Forget -Query "D# key"
  .\brain.ps1 -ExportContext
  .\brain.ps1 -List
#>
param(
  [string]$BrainRoot = "H:\shibass-ai\SHIBASS_BRAIN",

  [switch]$Help,
  [switch]$List,
  [switch]$ExportContext,
  [switch]$AddFact,
  [switch]$Confirm,
  [switch]$Forget,

  [ValidateSet("preference","rule","project","plugin","decision","fix","career","media","other")]
  [string]$Category = "other",

  [ValidateSet("confirmed","likely","inferred","temporary","deprecated")]
  [string]$Confidence = "inferred",

  [string]$Text = "",
  [string]$Source = "user",
  [string]$Query = "",
  [string]$Ownership = "original_shibass"
)

$ErrorActionPreference = "Stop"
$factsPath = Join-Path $BrainRoot "system\facts.jsonl"
$rulesPath = Join-Path $BrainRoot "identity\permanent_rules.json"
$prefsPath = Join-Path $BrainRoot "identity\preferences.json"
$artPath = Join-Path $BrainRoot "identity\artistic_identity.json"
$contextOut = Join-Path $BrainRoot "system\context_for_model.txt"
$utf8 = New-Object System.Text.UTF8Encoding $true

function Show-Help {
  Write-Host @"

ShiBass Brain Phase 1

  -AddFact -Category preference -Text "..." -Confidence confirmed -Source user
  -Confirm -Query "BPM"
  -Forget -Query "wrong fact"
  -List
  -ExportContext

Facts file: $factsPath

"@
}

function Read-Facts {
  if (-not (Test-Path $factsPath)) { return @() }
  $rows = @()
  Get-Content -LiteralPath $factsPath -ErrorAction SilentlyContinue | ForEach-Object {
    $line = $_.Trim()
    if (-not $line) { return }
    try { $rows += ($line | ConvertFrom-Json) } catch { }
  }
  return $rows
}

function Write-Facts([object[]]$rows) {
  $dir = Split-Path $factsPath -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $lines = foreach ($r in $rows) { ($r | ConvertTo-Json -Compress -Depth 6) }
  [IO.File]::WriteAllLines($factsPath, $lines, $utf8)
}

function New-FactId {
  return ("fact_" + [guid]::NewGuid().ToString("N").Substring(0, 12))
}

function Redact-Secrets([string]$s) {
  $s = [regex]::Replace($s, '(?i)(api[_-]?key|token|secret|password)\s*[:=]\s*\S+', '$1=[REDACTED]')
  $s = [regex]::Replace($s, 'sk-[A-Za-z0-9]{10,}', '[REDACTED_API_KEY]')
  return $s
}

if ($Help -or (-not ($List -or $ExportContext -or $AddFact -or $Confirm -or $Forget))) {
  Show-Help
  exit 0
}

if (-not (Test-Path $BrainRoot)) {
  throw "Brain root missing: $BrainRoot - run init-brain.ps1 first"
}

if ($AddFact) {
  if (-not $Text) { throw "-Text is required with -AddFact" }
  $Text = Redact-Secrets $Text
  $rows = @(Read-Facts)
  $fact = [pscustomobject]@{
    id = New-FactId
    category = $Category
    text = $Text
    source = $Source
    confidence = $Confidence
    ownership = $Ownership
    said_by_user = ($Source -eq "user")
    inferred = ($Confidence -eq "inferred")
    approved = ($Confidence -eq "confirmed")
    active = $true
    created_at = (Get-Date -Format o)
    last_verified = if ($Confidence -eq "confirmed") { (Get-Date -Format o) } else { $null }
    superseded_by = $null
  }
  $rows += $fact
  Write-Facts $rows
  Write-Host "[ok] added $($fact.id): $($fact.text)" -ForegroundColor Green
  exit 0
}

if ($List) {
  $rows = @(Read-Facts | Where-Object { $_.active -ne $false })
  if ($Query) {
    $q = $Query.ToLowerInvariant()
    $rows = @($rows | Where-Object { ("$($_.text) $($_.category)").ToLowerInvariant().Contains($q) })
  }
  foreach ($r in $rows) {
    Write-Host ("[{0}] {1} | {2} | {3}" -f $r.confidence, $r.category, $r.id, $r.text)
  }
  Write-Host ("Total: {0}" -f $rows.Count) -ForegroundColor Cyan
  exit 0
}

if ($Confirm) {
  if (-not $Query) { throw "-Query required with -Confirm" }
  $rows = @(Read-Facts)
  $q = $Query.ToLowerInvariant()
  $n = 0
  foreach ($r in $rows) {
    if ($r.active -eq $false) { continue }
    if (-not ("$($r.text) $($r.id)").ToLowerInvariant().Contains($q)) { continue }
    $r.confidence = "confirmed"
    $r.approved = $true
    $r.last_verified = (Get-Date -Format o)
    $n++
    Write-Host "[confirmed] $($r.id)" -ForegroundColor Green
  }
  Write-Facts $rows
  Write-Host "Updated: $n" -ForegroundColor Cyan
  exit 0
}

if ($Forget) {
  if (-not $Query) { throw "-Query required with -Forget" }
  $rows = @(Read-Facts)
  $q = $Query.ToLowerInvariant()
  $n = 0
  foreach ($r in $rows) {
    if ($r.active -eq $false) { continue }
    if (-not ("$($r.text) $($r.id)").ToLowerInvariant().Contains($q)) { continue }
    $r.active = $false
    $r.confidence = "deprecated"
    $r.last_verified = (Get-Date -Format o)
    $n++
    Write-Host "[forgot] $($r.id): $($r.text)" -ForegroundColor Yellow
  }
  Write-Facts $rows
  Write-Host "Deprecated: $n" -ForegroundColor Cyan
  exit 0
}

if ($ExportContext) {
  $blocks = New-Object System.Collections.Generic.List[string]
  $blocks.Add("# ShiBass Brain context (Phase 1)")
  $blocks.Add("Generated: $(Get-Date -Format o)")
  $blocks.Add("")

  foreach ($p in @($rulesPath, $prefsPath, $artPath)) {
    if (Test-Path $p) {
      $blocks.Add("## FILE: $p")
      $blocks.Add([IO.File]::ReadAllText($p))
      $blocks.Add("")
    }
  }

  $blocks.Add("## Active facts (confirmed/likely first)")
  $active = @(Read-Facts | Where-Object { $_.active -ne $false })
  $order = @{ confirmed = 0; likely = 1; inferred = 2; temporary = 3; deprecated = 9 }
  $active = $active | Sort-Object { if ($order.ContainsKey($_.confidence)) { $order[$_.confidence] } else { 5 } }, created_at
  foreach ($r in $active) {
    $blocks.Add(("- [{0}] ({1}) {2} | source={3} | ownership={4}" -f $r.confidence, $r.category, $r.text, $r.source, $r.ownership))
  }

  $text = ($blocks -join "`r`n")
  [IO.File]::WriteAllText($contextOut, $text, $utf8)
  Write-Host "[ok] wrote $contextOut" -ForegroundColor Green
  Write-Host $text
  exit 0
}
