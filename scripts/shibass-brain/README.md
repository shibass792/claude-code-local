# ShiBass Brain 2.0 — Phase 1

Personal AI memory layer on top of your existing local stack:
Ollama (`qwen2.5-local` / `myllama`) + drive path index + shibass-ai-panel.

## What Phase 1 delivers (now)

1. Folder layout under `H:\shibass-ai\SHIBASS_BRAIN\`
2. Identity files: profile, artistic identity, preferences, permanent rules
3. Confidence-tagged facts store (`system\facts.jsonl`)
4. Tools: init / add-fact / confirm / forget / export-context
5. Panel + knowledge Ask can inject permanent rules into prompts

## What comes later (Phases 2+)

Knowledge graph, version trees, MIDI/audio analysis, ownership classifiers,
career CRM, media brain, LoRA — after Phase 1 facts are being used daily.

## Install (Windows)

```powershell
$wc = New-Object Net.WebClient
$wc.Encoding = [Text.Encoding]::UTF8
$base = "https://raw.githubusercontent.com/shibass792/claude-code-local/cursor/shibass-ai-panel-f785/scripts/shibass-brain"
$dest = "H:\models\shibass-brain"
New-Item -ItemType Directory -Force $dest, "$dest\templates", "$dest\tools" | Out-Null
@(
  "init-brain.ps1",
  "brain.ps1",
  "README.md"
) | ForEach-Object {
  [IO.File]::WriteAllText((Join-Path $dest $_), $wc.DownloadString("$base/$_"), (New-Object Text.UTF8Encoding $true))
}
@(
  "personal_profile.json",
  "artistic_identity.json",
  "preferences.json",
  "permanent_rules.json"
) | ForEach-Object {
  [IO.File]::WriteAllText((Join-Path $dest "templates\$_"), $wc.DownloadString("$base/templates/$_"), (New-Object Text.UTF8Encoding $true))
}

powershell -ExecutionPolicy Bypass -File H:\models\shibass-brain\init-brain.ps1
```

## Daily usage

```powershell
# Add a confirmed preference
powershell -ExecutionPolicy Bypass -File H:\models\shibass-brain\brain.ps1 -AddFact -Category preference -Text "BPM 140-143" -Confidence confirmed -Source "user"

# Soft-delete wrong fact
powershell -ExecutionPolicy Bypass -File H:\models\shibass-brain\brain.ps1 -Forget -Query "D# key"

# Show context the model will see
powershell -ExecutionPolicy Bypass -File H:\models\shibass-brain\brain.ps1 -ExportContext
```

## Design rules (from Brain 2.0 vision)

- Every fact has source, date, confidence, confirmation, freshness
- Temporary ideas != permanent rules
- Secrets never enter embeddings (Phase 1 redacts obvious key patterns)
- Forget is soft-delete + supersede, not silent overwrite without history
