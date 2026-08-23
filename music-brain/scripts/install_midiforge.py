"""Idempotent installer: wires MIDI Forge into the live music_brain player."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

PKG = Path(r"H:\shibass-ai\claude-code-local\music-brain\music_brain")
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent

PLAYER = PKG / "player" / "__init__.py"
INDEX = PKG / "player" / "static" / "index.html"
CSS = PKG / "player" / "static" / "css" / "shibass.css"

log: list[str] = []


def say(m: str) -> None:
    log.append(m)
    print(m)


# --- 1. copy package ---------------------------------------------------------
dest = PKG / "midiforge"
dest.mkdir(parents=True, exist_ok=True)
for f in ("__init__.py", "smf.py", "analysis.py", "generate.py", "arrange.py", "export.py", "api.py"):
    shutil.copy2(SRC / "midiforge" / f, dest / f)
    say(f"copied midiforge/{f}")

shutil.copy2(SRC / "midiforge.js", PKG / "player" / "static" / "js" / "midiforge.js")
say("copied static/js/midiforge.js")


# --- 2. append CSS -----------------------------------------------------------
css = CSS.read_text(encoding="utf-8")
if "MIDI FORGE" not in css:
    css += "\n" + (SRC / "midiforge.css").read_text(encoding="utf-8")
    CSS.write_text(css, encoding="utf-8")
    say("appended MIDI FORGE styles to shibass.css")
else:
    say("css already patched (skip)")


# --- 3. patch player/__init__.py --------------------------------------------
src = PLAYER.read_text(encoding="utf-8")
changed = False

IMPORT = "from music_brain.midiforge import api as midiforge_api\n"
if "midiforge_api" not in src:
    anchor = "from music_brain.search import search as nl_search\n"
    if anchor in src:
        src = src.replace(anchor, anchor + IMPORT, 1)
        changed = True
        say("added midiforge import")
    else:
        raise SystemExit("FAIL: import anchor not found in player/__init__.py")

# NOTE: anchors MUST include trailing context. The bare
# `return self._json(404, {"error": "not found"})` line is a substring of a
# more-indented line inside /api/file-info, so a naive replace lands there.
GET_ANCHOR = (
    '            return self._json(404, {"error": "not found", "player": "/"})\n'
    "\n"
    "        def do_POST(self) -> None:  # noqa: N802\n"
)
GET_HOOK = (
    "            _mf = midiforge_api.handle_get(db, path, qs)\n"
    "            if _mf is not None:\n"
    "                return self._json(_mf[0], _mf[1])\n"
    "\n"
    '            return self._json(404, {"error": "not found", "player": "/"})\n'
    "\n"
    "        def do_POST(self) -> None:  # noqa: N802\n"
)
if "midiforge_api.handle_get" not in src:
    if src.count(GET_ANCHOR) != 1:
        raise SystemExit(f"FAIL: GET anchor matched {src.count(GET_ANCHOR)}x (need exactly 1)")
    src = src.replace(GET_ANCHOR, GET_HOOK, 1)
    changed = True
    say("added GET route hook")

POST_ANCHOR = (
    '            return self._json(404, {"error": "not found"})\n'
    "\n"
    "        def _project_open(self, proj: str) -> None:\n"
)
POST_HOOK = (
    "            _mf = midiforge_api.handle_post(db, path, body)\n"
    "            if _mf is not None:\n"
    "                return self._json(_mf[0], _mf[1])\n"
    "\n"
    '            return self._json(404, {"error": "not found"})\n'
    "\n"
    "        def _project_open(self, proj: str) -> None:\n"
)
if "midiforge_api.handle_post" not in src:
    if src.count(POST_ANCHOR) != 1:
        raise SystemExit(f"FAIL: POST anchor matched {src.count(POST_ANCHOR)}x (need exactly 1)")
    src = src.replace(POST_ANCHOR, POST_HOOK, 1)
    changed = True
    say("added POST route hook")

if changed:
    # Never write syntactically broken code into the live server.
    import ast

    try:
        ast.parse(src)
    except SyntaxError as e:
        raise SystemExit(f"FAIL: patched player would not parse (line {e.lineno}): {e.msg}")
    PLAYER.write_text(src, encoding="utf-8")
    say("wrote player/__init__.py (syntax verified)")
else:
    say("player already patched (skip)")


# --- 4. patch index.html -----------------------------------------------------
html = INDEX.read_text(encoding="utf-8")
if "forgeModal" not in html:
    nav_old = '<button class="nav-btn" data-panel="fx">FX</button>'
    nav_new = nav_old + '\n        <button class="nav-btn forge-nav" data-panel="forge">MIDI FORGE</button>'
    if nav_old in html:
        html = html.replace(nav_old, nav_new, 1)
        say("added MIDI FORGE nav button")

    modal = """
  <!-- ===== MIDI FORGE ===== -->
  <div class="forge-modal" id="forgeModal">
    <div class="forge-sheet">
      <div class="forge-head">
        <div>
          <div class="forge-title">MIDI FORGE</div>
          <div class="forge-sub">TRANSFORMATION &amp; SONG EXPANSION</div>
        </div>
        <div id="forgeFile">—</div>
        <button id="forgeClose" type="button">CLOSE</button>
      </div>

      <div class="forge-grid">
        <div class="forge-card">
          <h4>SOURCE DNA</h4>
          <div id="forgeAnalysis"><em style="color:#7eb8c8">Pick a .mid in the BROWSER, then hit ANALYZE.</em></div>
        </div>

        <div class="forge-card">
          <h4>TRANSFORMATIONS</h4>
          <div class="forge-checks" id="forgeTransforms">
            <label><input type="checkbox" value="lead" checked> Enhance Lead</label>
            <label><input type="checkbox" value="pad" checked> Atmospheric Pad</label>
            <label><input type="checkbox" value="arp" checked> Mutate Arp</label>
            <label><input type="checkbox" value="counter" checked> Counter-Melody</label>
            <label><input type="checkbox" value="bass" checked> Bass Root-Sync</label>
          </div>

          <div style="height:12px"></div>

          <div class="forge-row">
            <label>Complexity</label>
            <input type="range" id="forgeComplexity" min="0" max="100" value="50">
            <output id="forgeComplexityVal">50%</output>
          </div>
          <div class="forge-row">
            <label>Mutation</label>
            <input type="range" id="forgeMutation" min="0" max="100" value="35">
            <output id="forgeMutationVal">35%</output>
          </div>
          <div class="forge-row">
            <label>Bass style</label>
            <select id="forgeBassStyle">
              <option value="rolling">Rolling 16ths</option>
              <option value="offbeat">Offbeat 8ths</option>
            </select>
            <label style="min-width:auto">Bars</label>
            <input type="number" id="forgeBars" min="1" max="256" value="8" style="width:74px">
          </div>
          <div class="forge-row">
            <label>Arrangement</label>
            <select id="forgeTemplate">
              <option value="club">Club (192 bars)</option>
              <option value="short">Short (120 bars)</option>
            </select>
            <label style="min-width:auto">Seed</label>
            <input type="number" id="forgeSeed" value="0" style="width:74px">
          </div>

          <div class="forge-checks">
            <label><input type="checkbox" id="forgeScaleLock" checked> Scale lock</label>
            <label><input type="checkbox" id="forgeOctave"> Octave double</label>
            <label><input type="checkbox" id="forgeInvert"> Invert melody</label>
            <label><input type="checkbox" id="forgePadRhythmic"> Rhythmic pad</label>
          </div>

          <div class="forge-row" style="margin-top:12px">
            <label>Preview layer</label>
            <select id="forgePreviewLayer">
              <option value="pad">Atmospheric Pad</option>
              <option value="arp">Arp Variation B</option>
              <option value="counter">Counter-Melody</option>
              <option value="bass">Bass Root-Sync</option>
              <option value="lead">Lead Enhanced</option>
            </select>
          </div>

          <div class="forge-actions">
            <button id="forgeAnalyze" type="button">ANALYZE</button>
            <button id="forgePreviewOrig" type="button">A · ORIGINAL</button>
            <button id="forgePreviewGen" type="button">B · GENERATED</button>
            <button id="forgeStop" type="button">STOP</button>
            <button id="forgeExport" type="button" class="primary">EXPORT TO CUBASE</button>
          </div>

          <div id="forgeLayers"></div>
          <div class="forge-status" id="forgeStatus">Ready.</div>
          <div id="forgeResult"></div>
        </div>
      </div>
    </div>
  </div>
"""
    html = html.replace("</body>", modal + "\n</body>", 1)

    old_script = '<script src="/static/js/app.js"></script>'
    if old_script in html:
        html = html.replace(
            old_script, old_script + '\n  <script src="/static/js/midiforge.js"></script>', 1
        )
        say("added midiforge.js script tag")

    INDEX.write_text(html, encoding="utf-8")
    say("wrote index.html")
else:
    say("index.html already patched (skip)")


# --- 5. hook browser selection into MidiForge (app.js) -----------------------
APP = PKG / "player" / "static" / "js" / "app.js"
app = APP.read_text(encoding="utf-8")
if "MidiForge" not in app:
    anchor = """      li.addEventListener("click", () => {
        addToPlaylist(item, true);
      });"""
    repl = """      li.addEventListener("click", () => {
        addToPlaylist(item, true);
        if (window.MidiForge && item.is_midi) window.MidiForge.setFile(item);
      });"""
    if anchor in app:
        app = app.replace(anchor, repl, 1)
        APP.write_text(app, encoding="utf-8")
        say("hooked browser selection -> MidiForge")
    else:
        say("WARN: app.js anchor not found — select file via panel manually")
else:
    say("app.js already hooked (skip)")

print("\nINSTALL OK")
