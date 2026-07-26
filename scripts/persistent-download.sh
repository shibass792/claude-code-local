#!/bin/bash
# Persistent model download — auto-restarts on every failure.
# Useful for big models (Qwen 122B is ~75 GB) on flaky connections.
#
# Usage:
#   bash scripts/persistent-download.sh                              # default Gemma 4 31B
#   bash scripts/persistent-download.sh qwen                         # Qwen 3.5 122B
#   bash scripts/persistent-download.sh llama                        # Llama 3.3 70B
#   MLX_MODEL=<hf-id> bash scripts/persistent-download.sh
#   MAX_ATTEMPTS=0 bash scripts/persistent-download.sh               # retry forever

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# A dropped connection is worth retrying; a bad model id or a missing MLX
# virtualenv is not, and retrying those forever just spins at 10s intervals
# until someone notices. Cap the attempts by default.
MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"

echo "=== Persistent MLX model download ==="
if [ "$MAX_ATTEMPTS" -eq 0 ]; then
  echo "Will keep retrying until the model is fully cached."
else
  echo "Will retry up to $MAX_ATTEMPTS times (MAX_ATTEMPTS=0 to retry forever)."
fi
echo ""

attempt=0
while true; do
  attempt=$((attempt + 1))
  echo "[$(date)] Starting download attempt $attempt..."
  if bash "$SCRIPT_DIR/download-and-import.sh" "$@"; then
    echo ""
    echo "=== DONE! Model is ready ==="
    exit 0
  fi
  if [ "$MAX_ATTEMPTS" -ne 0 ] && [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo ""
    echo "=== GAVE UP after $attempt attempts ==="
    echo "The failure looks permanent (bad model id, no MLX virtualenv, no disk space?)."
    echo "Fix the cause, or re-run with MAX_ATTEMPTS=0 to retry forever."
    exit 1
  fi
  echo "[$(date)] Download dropped. Restarting in 10s..."
  sleep 10
done
