#!/bin/bash
# DAW Match — auto-match panel for Cubase and Ableton
# Double-click to launch
#
# Paste a YouTube link or an audio file into the panel; it reads the tempo and
# key, ranks the arps / loops / projects in your library against them, plays the
# winner in the browser, and hands it to Cubase or Ableton with one click.
#
# REQUIRED:
#   ffmpeg   — brew install ffmpeg      (decoding any audio at all)
#   numpy    — pip3 install numpy       (tempo and key detection)
#
# OPTIONAL:
#   yt-dlp   — brew install yt-dlp      (needed only for YouTube links;
#                                        local files work without it)
#
# CONFIGURATION (all optional, all env vars):
#   DAW_MATCH_LIBRARY      colon-separated library roots to scan
#   DAW_MATCH_SCRIPT       your own matcher script; its results are merged in
#   DAW_MATCH_CUBASE_APP   app name for the Cubase button   (default "Cubase 14")
#   DAW_MATCH_ABLETON_APP  app name for the Ableton button  (default "Ableton Live 12 Suite")
#   DAW_MATCH_PORT         panel port                       (default 4020)
#
# Set them once in ~/.daw-match/config.json if you prefer not to edit this file.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PANEL="$(cd "$SCRIPT_DIR/.." && pwd)/daw-match/panel.py"
PYTHON="${DAW_MATCH_PYTHON:-python3}"

clear
echo ""
echo "  🎹 DAW MATCH — auto-match panel"
echo "  → arps, loops and projects matched by tempo and key"
echo "  → previews render locally; only yt-dlp touches the network"
echo ""

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "  ✗ $PYTHON not found. Install Python 3, or set DAW_MATCH_PYTHON."
  echo ""
  read -r -p "  Press Return to close…" _
  exit 1
fi

if ! "$PYTHON" -c "import numpy" >/dev/null 2>&1; then
  echo "  ✗ numpy is required for tempo and key detection."
  echo "    Install it with:  $PYTHON -m pip install numpy"
  echo ""
  read -r -p "  Press Return to close…" _
  exit 1
fi

command -v ffmpeg >/dev/null 2>&1 || \
  echo "  ⚠ ffmpeg not found — no audio can be decoded. Install: brew install ffmpeg"
command -v yt-dlp >/dev/null 2>&1 || \
  echo "  ⚠ yt-dlp not found — YouTube links unavailable, local files still work."

# First run has nothing to match against, so lay down a few example arps.
if [ ! -f "$HOME/.daw-match/index.json" ]; then
  echo "  → first run: writing a starter pack of example arps…"
  "$PYTHON" "$PANEL" --starter-pack
  echo ""
fi

exec "$PYTHON" "$PANEL"
