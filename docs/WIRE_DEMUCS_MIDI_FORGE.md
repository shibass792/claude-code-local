# Wire Demucs to MIDI Forge (8791)

When you see:

```text
[i] test30.wav: WAV detected — audio stage not wired yet (Demucs venv), skipping.
```

MIDI Forge sees the file but **does not have a Demucs Python venv configured**.

You already have a **separate Audio Worker (8015)** that can run Demucs on the same folder.
This doc wires **MIDI Forge itself** so it stops skipping.

## One-time setup

```powershell
cd H:\shibass-ai
powershell -ExecutionPolicy Bypass -File .\scripts\wire-demucs-for-midi-forge.ps1
```

Default device is **auto**: uses CUDA only when the venv’s PyTorch was built with CUDA.
The stock `pip install torch` on Windows is CPU-only, so you will usually get `cpu` without the old CUDA error.

Force CPU (skip CUDA probe):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\wire-demucs-for-midi-forge.ps1 -Device cpu
```

This creates:

| Path | Purpose |
|------|---------|
| `H:\shibass-ai\.venv-demucs\` | Python venv with demucs + torch |
| `H:\shibass-ai\config\demucs.env` | env vars for hooks |
| `H:\shibass-ai\tools\demucs_wav_hook.py` | run demucs on one WAV |

## Before starting MIDI Forge

Load env (same session):

```powershell
Get-Content H:\shibass-ai\config\demucs.env | ForEach-Object {
  if ($_ -match '^([^=]+)=(.*)$') { Set-Item -Path "Env:$($matches[1])" -Value $matches[2] }
}
```

Or double-click: `START-MIDI-FORGE-DEMUCS.cmd` then start Forge from that window.

Required variables:

```powershell
$env:SHIBASS_DEMUCS_ENABLED="1"
$env:SHIBASS_DEMUCS_VENV="H:\shibass-ai\.venv-demucs"
$env:SHIBASS_DEMUCS_HOOK="H:\shibass-ai\tools\demucs_wav_hook.py"
$env:SHIBASS_STEMS_OUTPUT="H:\shibass-ai\10_OUTPUTS\stems"
```

## Manual test (no Forge)

```powershell
H:\shibass-ai\.venv-demucs\Scripts\python.exe H:\shibass-ai\tools\demucs_wav_hook.py H:\shibass-ai\10_OUTPUTS\MIDI_EXPORT\test30.wav
```

Stems go to: `H:\shibass-ai\10_OUTPUTS\stems\test30\`

## If Forge still skips

MIDI Forge may still log `skipping` until its **music-brain** build reads `SHIBASS_DEMUCS_*`.
Use the **parallel watcher** (same folder, independent of Forge):

```powershell
powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\watch-midi-export-demucs.ps1
```

Or double-click `START-MIDI-FORGE-DEMUCS.cmd` (loads env + starts watcher).

1. **Watcher** — processes every new WAV in `MIDI_EXPORT` via `demucs_wav_hook.py`.
2. **Audio Worker 8015** — can run Demucs on the same folder if already up.
3. **Forge env** — restart Forge after loading `config\demucs.env` so it may pick up the venv.

## Pipeline to Social Studio

After stems / render:

```powershell
powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\watch-social-inbox.ps1
```

Renders in `10_OUTPUTS\social\` enter the promo-publisher approval queue.
