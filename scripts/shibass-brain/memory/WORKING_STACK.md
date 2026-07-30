# ShiBass working stack (confirmed)

Captured: 2026-07-30
Source: Cursor cloud agents + live Windows setup
Confidence: confirmed for items marked [OK]

## Local AI

- [OK] Ollama on `http://127.0.0.1:11434`
- [OK] Models used: `myllama` (GGUF local create) and/or `qwen2.5-local:latest`
- [OK] Do NOT use `ollama run llama3.2` if registry pull is blocked
- [OK] GGUF path example: `H:\models\llama3.2-3b.gguf`

## Path index (no file copy)

- [OK] Script: `H:\models\knowledge-from-drives.ps1`
- [OK] Index: `H:\ai-knowledge\drive-index.jsonl` (~22MB seen)
- [OK] Waiter: `H:\models\wait-then-ask.ps1`
- [OK] Index scans paths only; Ask pulls matching file content live
- [FIX] PowerShell `-File` + repeated `-Roots` fails (`ParameterAlreadyBound`)
- [FIX] Call knowledge script in-process with `string[]` Roots (daw-handoff -Remember)
- [FIX] Do not Ask while Index is still writing (file lock / No matches)

## Panel

- [OK] `H:\shibass-ai-panel` Express UI
- [OK] URL: `http://127.0.0.1:8787`
- [OK] `npm start` with `$env:PORT = "8787"`
- [FIX] `EADDRINUSE` means already running — open browser or kill PID, do not start twice
- [OK] Chat injects ShiBass Brain context when present

## Cubase <-> Ableton handoff

- [OK] No perfect `.cpr` <-> `.als` convert
- [OK] Method: MIDI + stems WAV 24-bit + reference + NOTES.md
- [OK] Script: `H:\models\daw-handoff.ps1`
- [OK] Guide: `H:\models\cubase-ableton-handoff.md`
- [OK] Package: `H:\daw-handoff\<Song>\`
- [OK] Init creates `00-drop-*` + `01-midi` / `02-stems` / `03-reference` / `04-notes`
- [FIX] UTF-8 em-dash broke PS 5.1 parse — use BOM installer + ASCII punctuation
- [OK] Installer: `install-windows-scripts.ps1` (WebClient + UTF8 BOM)

## ShiBass Brain Phase 1

- [OK] Root: `H:\shibass-ai\SHIBASS_BRAIN\`
- [OK] Identity: `identity\*.json`
- [OK] Facts: `system\facts.jsonl` (confidence-tagged)
- [OK] Tools: `H:\models\shibass-brain\init-brain.ps1`, `brain.ps1`
- [OK] Export: `brain.ps1 -ExportContext` -> `system\context_for_model.txt`
- [OK] Knowledge Ask + panel chat inject Brain context

## Repo branches (code that worked)

- `cursor/shibass-ai-panel-f785` — panel + brain + fixed scripts (primary download branch)
- `cursor/daw-handoff-scripts-f785` — earlier handoff scripts push
- Other agent branches exist for match-panel / H-drive / launcher (see AGENT_SESSIONS.md)

## Hard rules for future agents

1. Paste ONLY PowerShell command blocks into the terminal — never Hebrew prose / markdown fences
2. Paths like `H:\daw-handoff\...` are folders, not commands — use `explorer <path>`
3. Prefer UTF-8 BOM when writing `.ps1` for Windows PowerShell 5.1
4. Never store API keys/secrets in facts/embeddings — redact
5. Temporary ideas != confirmed facts — use confidence levels
