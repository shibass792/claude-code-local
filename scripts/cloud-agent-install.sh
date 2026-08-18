#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for claude-code-local on Linux x86.
# Installs python3.12-venv (required but missing from the default image) and
# creates ~/.local/mlx-server with mlx-lm + mlx[cpu] for CPU-side development.
set -euo pipefail

if ! dpkg -s python3.12-venv >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3.12-venv
fi

VENV="${HOME}/.local/mlx-server"
if [[ ! -x "${VENV}/bin/python" ]]; then
  python3.12 -m venv "${VENV}"
fi

"${VENV}/bin/pip" install --upgrade --quiet pip
"${VENV}/bin/pip" install --quiet mlx-lm "mlx[cpu]" requests

"${VENV}/bin/python" -c "import mlx; import mlx_lm; print('mlx ok')"
