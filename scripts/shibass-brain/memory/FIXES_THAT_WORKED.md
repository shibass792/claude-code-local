# Fixes that worked (error -> solution)

## PowerShell parse: Unexpected token / `<` operator in daw-handoff.ps1
Cause: UTF-8 em-dash / special chars mangled by Invoke-WebRequest on PS 5.1; here-strings broke.
Fix: ASCII punctuation + UTF-8 BOM writer via install-windows-scripts.ps1 (Net.WebClient + UTF8Encoding $true).

## ParameterAlreadyBound: Roots
Cause: nested `powershell -File ... -Roots a -Roots b`.
Fix: `& $KnowledgeScript -Index -Roots $uniqueRoots` in-process.

## ParameterAlreadyBound: Remember
Cause: user pasted the same command twice on one line.
Fix: run once.

## EADDRINUSE 8787 / 4000
Cause: panel already listening.
Fix: open http://127.0.0.1:8787 OR Stop-Process on OwningProcess, then npm start with PORT=8787.

## ollama pull / connectex access permissions
Cause: Ollama blocked outbound registry.
Fix: download GGUF with curl.exe, `ollama create myllama`.

## Index Ask race
Cause: Ask while drive-index.jsonl still locked/writing.
Fix: wait for Done, or wait-then-ask.ps1.

## organized 0 files
Cause: drop folders empty — paths pasted as commands instead of exporting in DAW.
Fix: export in Cubase/Ableton into 00-drop-*, then -Organize.

## Hebrew prose CommandNotFoundException
Cause: pasted assistant explanations into PowerShell.
Fix: only paste fenced command blocks.
