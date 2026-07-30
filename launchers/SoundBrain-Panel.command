#!/usr/bin/env bash
# SoundBrain Match Panel — http://127.0.0.1:8770/panel
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export SOUNDBRAIN_HOME="${SOUNDBRAIN_HOME:-$HOME/.soundbrain}"
mkdir -p "$SOUNDBRAIN_HOME"
cd "$ROOT"
exec python3 -m soundbrain serve --host 127.0.0.1 --port 8770
