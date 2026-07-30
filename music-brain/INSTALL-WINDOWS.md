# Install Music Brain on Windows

## Quick download

Download ZIP (latest branch):
https://github.com/shibass792/claude-code-local/archive/refs/heads/cursor/music-brain-system-f88d.zip

After extract, open folder: `claude-code-local-cursor-music-brain-system-f88d\music-brain\`

## Install

```powershell
cd music-brain
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[watch]"
```

Edit `config.yaml` — set your drive paths (H:\, D:\, F:\, C:\Users\shibass\).

## First run

```powershell
music-brain pipeline
music-brain index-embeddings
music-brain serve
```

## Cubase Companion (optional)

```powershell
music-brain cubase-companion --events
```

Recommendations saved to: `data/cubase_recommendations.json`
