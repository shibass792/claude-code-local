# -*- coding: utf-8 -*-
"""Sync SHIBASS-MASTER-MENU.html with the live topology (append-only, idempotent).

Adds a fixed bottom bar with the canonical live panels + a script that pings
every 127.0.0.1 link on the page and marks it ✔ (live) or ✖ (down) in place.
Never rewrites Antigravity's content — appends before </body> with a guard id.
"""
import shutil
from pathlib import Path

F = Path(r"H:\shibass-ai\SHIBASS-MASTER-MENU.html")
src = F.read_text(encoding="utf-8", errors="replace")
if "sb-live-panels-bar" in src:
    print("NO-CHANGE (already synced)")
    raise SystemExit(0)
shutil.copy2(F, str(F) + ".bak-menu-sync")

INJECT = """
<!-- === sb-live-panels-bar: auto-synced by Claude (append-only) === -->
<div id="sb-live-panels-bar" dir="rtl" style="position:fixed;bottom:0;left:0;right:0;z-index:9999;
     background:#0b0f14ee;border-top:2px solid #00e5ff;padding:10px 14px;display:flex;gap:10px;
     align-items:center;font-family:Segoe UI,Arial;flex-wrap:wrap">
  <b style="color:#00e5ff">פאנלים חיים:</b>
  <a class="sbp" data-port="8850" href="http://127.0.0.1:8850/" style="color:#e8fbff;text-decoration:none;border:1px solid #2a3a44;border-radius:6px;padding:5px 10px">🎹 Synth Rack (Sylenth1 Live)</a>
  <a class="sbp" data-port="8850" href="http://127.0.0.1:8850/shell" style="color:#e8fbff;text-decoration:none;border:1px solid #2a3a44;border-radius:6px;padding:5px 10px">🖥️ Control Shell</a>
  <a class="sbp" data-port="8791" href="http://127.0.0.1:8791/" style="color:#e8fbff;text-decoration:none;border:1px solid #2a3a44;border-radius:6px;padding:5px 10px">🎵 S1 Player + MIDI Forge</a>
  <a class="sbp" data-port="8788" href="http://127.0.0.1:8788/sb-synths-midi-player.html" style="color:#e8fbff;text-decoration:none;border:1px solid #2a3a44;border-radius:6px;padding:5px 10px">🎛️ Synths & MIDI Studio</a>
  <a class="sbp" data-port="8793" href="http://127.0.0.1:8793/" style="color:#e8fbff;text-decoration:none;border:1px solid #2a3a44;border-radius:6px;padding:5px 10px">🔬 Synths Inspector</a>
  <span style="color:#557;font-size:12px;margin-inline-start:auto">סטטוס חי · מתעדכן כל 10ש׳</span>
</div>
<script>
(function(){
  async function ping(url){
    try{ await fetch(url, {mode:'no-cors', signal: AbortSignal.timeout(1500)}); return true; }
    catch(_){ return false; }
  }
  async function markAll(){
    // the new bar
    for (const a of document.querySelectorAll('#sb-live-panels-bar .sbp')){
      const ok = await ping('http://127.0.0.1:' + a.dataset.port + '/');
      a.style.borderColor = ok ? '#22c55e' : '#7f1d1d';
      a.style.opacity = ok ? '1' : '.45';
    }
    // every pre-existing local link on the page gets a live chip
    for (const a of document.querySelectorAll('a[href^="http://127.0.0.1"]')){
      if (a.closest('#sb-live-panels-bar')) continue;
      const ok = await ping(a.href);
      let chip = a.querySelector('.sb-chip');
      if (!chip){ chip = document.createElement('span'); chip.className='sb-chip';
                  chip.style.marginInlineStart='6px'; a.appendChild(chip); }
      chip.textContent = ok ? '✔' : '✖';
      chip.style.color = ok ? '#22c55e' : '#ef4444';
      if (!ok){ a.title = 'השירות לא רץ — בדוק ב-port_status.json או הפעל מה-launchers'; }
    }
  }
  markAll(); setInterval(markAll, 10000);
  document.body.style.paddingBottom = '64px';
})();
</script>
"""

if "</body>" in src:
    src = src.replace("</body>", INJECT + "\n</body>", 1)
else:
    src += INJECT
F.write_text(src, encoding="utf-8", newline="\n")
print("MENU SYNCED (+ backup .bak-menu-sync)")
