#!/usr/bin/env bash
# Wire Claude Code MCP filesystem access to an H: root.
# On Linux/macOS this usually means an SMB/CIFS mount of the Windows H: share,
# e.g. /mnt/h or /Volumes/H.
set -euo pipefail

ROOT="${1:-${H_DRIVE_ROOT:-/mnt/h}}"
SKIP_MCP="${SKIP_MCP:-0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CTL="$SCRIPT_DIR/h_drive_ctl.py"

if [[ ! -f "$CTL" ]]; then
  echo "Missing h_drive_ctl.py at $CTL" >&2
  exit 1
fi

if [[ ! -d "$ROOT" ]]; then
  echo "Root does not exist yet: $ROOT"
  echo "Create/mount it first, e.g.:"
  echo "  sudo mkdir -p /mnt/h"
  echo "  sudo mount -t cifs //SERVER/H$ /mnt/h -o username=USER,uid=$(id -u)"
  echo "Or pass an existing path: $0 /path/to/h-root"
  exit 1
fi

ROOT="$(cd "$ROOT" && pwd)"
CLAUDE_DIR="${HOME}/.claude"
mkdir -p "$CLAUDE_DIR"

WRAPPER="$CLAUDE_DIR/h-drive"
cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
export H_DRIVE_ROOT="$ROOT"
exec python3 "$CTL" "\$@"
EOF
chmod +x "$WRAPPER"
echo "Installed CLI wrapper: $WRAPPER"
echo "  Example: ~/.claude/h-drive list"

if [[ "$SKIP_MCP" == "1" ]]; then
  echo "Skipped MCP registration (SKIP_MCP=1)."
  exit 0
fi

command -v claude >/dev/null || { echo "claude CLI not found" >&2; exit 1; }
command -v npx >/dev/null || { echo "npx not found (install Node.js)" >&2; exit 1; }

claude mcp remove h-drive >/dev/null 2>&1 || true
echo "Registering Claude MCP filesystem server scoped to $ROOT ..."
claude mcp add h-drive -- npx -y @modelcontextprotocol/server-filesystem "$ROOT"

echo ""
echo "Done. Ask Claude Code to list/read/write under $ROOT"
echo "Optional localhost API:"
echo "  H_DRIVE_ROOT=$ROOT python3 \"$CTL\" serve --port 18765"
