#!/usr/bin/env bash
# Cross-platform wrapper — forwards to python -m music_brain
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PYTHONPATH="${ROOT}/music-brain${PYTHONPATH:+:$PYTHONPATH}"
exec python3 -m music_brain "$@"
