#!/usr/bin/env bash
# Cloud Agent install for claude-code-local.
#
# NOTE: The MLX inference server (proxy/server.py) is Apple-Silicon-only and
# cannot run on a Linux Cloud Agent (it imports mlx/mlx_lm). This install sets up
# the parts that DO run on Linux for development:
#   - smart-router/router.py     (pure stdlib — the request router/proxy)
#   - scripts/test_mlx_server.py (Anthropic tool-use test harness — needs `requests`)
#
# Idempotent: safe to re-run against cached state.
set -euo pipefail
cd "$(dirname "$0")/.."

# Ubuntu ships venv support in a separate package (ensurepip lives there).
if ! python3 -c 'import ensurepip' >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq python3-venv \
      || sudo apt-get install -y -qq python3.12-venv
  fi
fi

# Project virtualenv (only created once; reused afterwards).
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi

./.venv/bin/python -m pip install --quiet --upgrade pip
./.venv/bin/python -m pip install --quiet requests

# Syntax-check the Python entry points. proxy/server.py imports mlx at runtime
# (not installable on Linux), so we byte-compile rather than import it.
./.venv/bin/python -m py_compile \
  proxy/server.py \
  smart-router/router.py \
  scripts/test_mlx_server.py

echo "install.sh complete: .venv ready (requests installed); entry points compiled."
