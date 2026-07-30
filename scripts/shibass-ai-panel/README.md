# shibass AI panel

Local browser UI for Ollama (`myllama`) + drive knowledge Ask.

## On Windows (`H:\shibass-ai-panel`)

```powershell
Set-Location H:\shibass-ai-panel
npm install
npm start
```

Open http://127.0.0.1:8787

Requires:
- Ollama running with model `myllama`
- `H:\models\knowledge-from-drives.ps1`
- Optional: `H:\models\wait-then-ask.ps1` (checkbox in UI)
- Index file: `H:\ai-knowledge\drive-index.jsonl`
