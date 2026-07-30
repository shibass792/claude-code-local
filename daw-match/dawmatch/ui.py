"""The panel's single-page UI (Hebrew RTL with English subtitles)."""

PAGE = r"""<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DAW Match · פאנל התאמות</title>
<style>
  :root {
    --bg: #0b0f14;
    --panel: #131a23;
    --panel-2: #182230;
    --line: #24313f;
    --text: #e7eef7;
    --muted: #8fa3b8;
    --accent: #f5c542;
    --accent-2: #4cc9f0;
    --good: #4c9a2a;
    --bad: #e5484d;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: radial-gradient(1200px 600px at 80% -10%, #1b2735 0%, var(--bg) 60%);
    color: var(--text); font: 15px/1.55 -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    min-height: 100vh;
  }
  a { color: var(--accent-2); }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 28px 20px 64px; }
  header { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-bottom: 6px; }
  h1 { font-size: 27px; margin: 0; letter-spacing: -0.3px; }
  .sub { color: var(--muted); font-size: 13px; }
  .card {
    background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
    padding: 16px 18px; margin-top: 16px;
  }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  input[type=text] {
    flex: 1 1 320px; min-width: 240px; background: var(--panel-2); color: var(--text);
    border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; font-size: 15px;
  }
  input[type=text]:focus { outline: 2px solid var(--accent-2); outline-offset: -1px; }
  select {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
    border-radius: 10px; padding: 11px 12px; font-size: 14px;
  }
  button {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
    border-radius: 10px; padding: 11px 15px; font-size: 14px; cursor: pointer;
    transition: transform .05s ease, border-color .15s ease, background .15s ease;
  }
  button:hover:not(:disabled) { border-color: var(--accent-2); background: #1e2a3a; }
  button:active:not(:disabled) { transform: translateY(1px); }
  button:disabled { opacity: .5; cursor: default; }
  button.primary { background: linear-gradient(180deg, #f7d264, #e0ac1d); color: #201a05; border-color: #c9971a; font-weight: 700; }
  button.cubase { background: linear-gradient(180deg, #3ba0d8, #1f74a8); color: #041017; border-color: #1a5f8c; font-weight: 700; }
  button.ableton { background: linear-gradient(180deg, #f0f2f4, #c8ced6); color: #14181d; border-color: #9aa4ae; font-weight: 700; }
  label.check { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); font-size: 13px; cursor: pointer; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px;
    border: 1px solid var(--line); background: var(--panel-2); color: var(--muted);
  }
  .badge.arp { color: #ffd479; border-color: #6b551f; }
  .badge.loop { color: #7ee0a8; border-color: #2c5d41; }
  .badge.project { color: #7fc9f5; border-color: #235572; }
  .badge.script { color: #d7a6ff; border-color: #543a6b; }
  .kv { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 10px; }
  .kv div { min-width: 92px; }
  .kv .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  .kv .v { font-size: 20px; font-weight: 700; }
  .match {
    display: grid; grid-template-columns: 54px 1fr auto; gap: 14px; align-items: center;
    padding: 13px 14px; border: 1px solid var(--line); border-radius: 12px;
    background: var(--panel-2); margin-top: 10px;
  }
  .match.top { border-color: var(--accent); box-shadow: 0 0 0 1px rgba(245,197,66,.25); }
  .score { text-align: center; }
  .score b { display: block; font-size: 18px; }
  .score span { font-size: 11px; color: var(--muted); }
  .bar { height: 5px; border-radius: 4px; background: #22303f; overflow: hidden; margin-top: 5px; }
  .bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--accent-2), var(--accent)); }
  .mname { font-weight: 650; word-break: break-word; }
  .meta { color: var(--muted); font-size: 13px; margin-top: 3px; }
  .why { color: var(--muted); font-size: 12.5px; margin-top: 4px; }
  .acts { display: flex; gap: 7px; flex-wrap: wrap; justify-content: flex-end; }
  .acts button { padding: 8px 11px; font-size: 13px; }
  .msg { padding: 11px 14px; border-radius: 10px; margin-top: 12px; font-size: 14px; }
  .msg.err { background: #3a1416; border: 1px solid #6d2226; color: #ffb3b5; }
  .msg.warn { background: #362b12; border: 1px solid #6b5520; color: #ffdb96; }
  .msg.ok { background: #10301c; border: 1px solid #24603a; color: #a8e9bf; }
  .spin { display: inline-block; width: 13px; height: 13px; border: 2px solid #46596d;
          border-top-color: var(--accent); border-radius: 50%; animation: sp .7s linear infinite; }
  @keyframes sp { to { transform: rotate(360deg); } }
  h2 { font-size: 16px; margin: 0 0 4px; }
  .link { padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px;
          background: var(--panel-2); margin-top: 8px; font-size: 13.5px; }
  .link .t { font-weight: 650; }
  .link .p { color: var(--muted); font-size: 12.5px; word-break: break-all; margin-top: 2px; }
  code { background: #0f151d; border: 1px solid var(--line); border-radius: 5px; padding: 1px 5px; font-size: 12.5px; }
  .empty { color: var(--muted); font-size: 14px; padding: 8px 2px; }
  .foot { color: var(--muted); font-size: 12.5px; margin-top: 22px; }
  audio { width: 100%; margin-top: 10px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>🎹 DAW Match</h1>
    <div class="sub">מצא ארפג'/פרויקט מתאים לכל טראק · Auto-match arps &amp; projects to any track</div>
  </header>

  <div class="card">
    <div class="row">
      <input id="q" type="text" placeholder="הדבק קישור יוטיוב או נתיב לקובץ אודיו — paste a YouTube link or an audio file path" autocomplete="off">
      <select id="prefer" title="סנן לפי סוג">
        <option value="">הכל · all types</option>
        <option value="arp">ארפג'ים · arps (.mid)</option>
        <option value="loop">לופים · audio loops</option>
        <option value="project">פרויקטים · projects</option>
      </select>
      <button id="go" class="primary">🔎 חפש התאמה</button>
    </div>
    <div class="row" style="margin-top:11px">
      <label class="check"><input id="auto" type="checkbox" checked> אוטומטי — נגן את ההתאמה הטובה מיד</label>
      <label class="check"><input id="attempo" type="checkbox" checked> נגן בטמפו של הטראק</label>
      <span style="flex:1"></span>
      <button id="reindex" title="סרוק מחדש את הספרייה">↻ סרוק ספרייה</button>
    </div>
    <div id="msg"></div>
  </div>

  <div id="track" class="card" hidden>
    <h2>🎧 <span id="tname"></span></h2>
    <div class="sub" id="tsrc"></div>
    <div class="kv">
      <div><div class="k">טמפו · BPM</div><div class="v" id="tbpm">—</div><div class="bar"><i id="tbpmc" style="width:0"></i></div></div>
      <div><div class="k">סולם · Key</div><div class="v" id="tkey">—</div><div class="bar"><i id="tkeyc" style="width:0"></i></div></div>
      <div><div class="k">אורך · Length</div><div class="v" id="tdur">—</div></div>
      <div><div class="k">בהירות · Bright</div><div class="v" id="tbright">—</div></div>
    </div>
  </div>

  <div id="player" class="card" hidden>
    <h2>▶ <span id="pname">האזנה</span></h2>
    <div class="sub" id="pnote"></div>
    <audio id="audio" controls preload="none"></audio>
  </div>

  <div id="results" class="card" hidden>
    <h2>🎯 התאמות · Matches</h2>
    <div id="list"></div>
  </div>

  <div class="card">
    <h2>🔗 שיוכים אחרונים · Paired sessions</h2>
    <div class="sub">כל פתיחה ב-DAW נשמרת כאן ומקשרת בין הטראק לארפג'/פרויקט.</div>
    <div id="links"><div class="empty">אין שיוכים עדיין.</div></div>
  </div>

  <div class="foot" id="foot"></div>
</div>

<script>
const BOOT = __BOOT__;
const $ = (id) => document.getElementById(id);
let MATCHES = [];
let TRACK = null;

function msg(text, kind) {
  $("msg").innerHTML = text ? `<div class="msg ${kind || "ok"}">${text}</div>` : "";
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function pct(x) { return Math.round((x || 0) * 100); }

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({ error: "bad response from panel" }));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function analyze() {
  const input = $("q").value.trim();
  if (!input) { msg("הדבק קישור או נתיב לקובץ קודם.", "warn"); return; }
  $("go").disabled = true;
  $("go").innerHTML = '<span class="spin"></span> מנתח…';
  msg("");
  try {
    const data = await api("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, prefer: $("prefer").value }),
    });
    TRACK = data.track;
    MATCHES = data.matches || [];
    renderTrack(data.track);
    renderMatches(MATCHES);
    if (data.warnings && data.warnings.length) msg(data.warnings.map(esc).join("<br>"), "warn");
    else msg(`נמצאו ${MATCHES.length} התאמות מתוך ${data.library_size} קבצים בספרייה.`, "ok");
    if ($("auto").checked && MATCHES.length) preview(MATCHES[0]);
  } catch (err) {
    msg(esc(err.message), "err");
  } finally {
    $("go").disabled = false;
    $("go").innerHTML = "🔎 חפש התאמה";
  }
}

function renderTrack(t) {
  $("track").hidden = false;
  $("tname").textContent = t.title || "טראק";
  $("tsrc").textContent = t.source || "";
  $("tbpm").textContent = t.bpm ? (+t.bpm).toFixed(1) : "—";
  $("tkey").textContent = t.key || "—";
  $("tdur").textContent = t.duration ? `${Math.round(t.duration)}s` : "—";
  $("tbright").textContent = t.brightness != null ? pct(t.brightness) + "%" : "—";
  $("tbpmc").style.width = pct(t.bpm_confidence) + "%";
  $("tkeyc").style.width = pct(t.key_confidence) + "%";
}

function renderMatches(list) {
  $("results").hidden = false;
  const box = $("list");
  if (!list.length) {
    box.innerHTML = '<div class="empty">לא נמצאו התאמות. הוסף קבצים לספרייה או שנה את הסינון.</div>';
    return;
  }
  box.innerHTML = "";
  list.forEach((m, i) => {
    const el = document.createElement("div");
    el.className = "match" + (i === 0 ? " top" : "");
    const bits = [
      m.bpm ? `${(+m.bpm).toFixed(1)} BPM` : "BPM ?",
      m.key || "key ?",
      m.notes != null ? `${m.notes} notes` : null,
      m.duration ? `${Math.round(m.duration)}s` : null,
    ].filter(Boolean).join(" · ");
    el.innerHTML = `
      <div class="score">
        <b>${pct(m.score)}%</b><span>התאמה</span>
        <div class="bar"><i style="width:${pct(m.score)}%"></i></div>
      </div>
      <div>
        <div class="mname">${esc(m.name)}
          <span class="badge ${esc(m.kind)}">${esc(m.kind)}</span>
          ${m.source === "script" ? '<span class="badge script">מהסקריפט שלך</span>' : ""}
        </div>
        <div class="meta">${esc(bits)}</div>
        <div class="why">${esc((m.reasons || []).join(" · "))}${m.script_note ? " · " + esc(m.script_note) : ""}</div>
      </div>
      <div class="acts">
        <button data-act="play">▶ האזן</button>
        <button class="cubase" data-act="cubase">פתח בקיובייס</button>
        <button class="ableton" data-act="ableton">פתח באבלטון</button>
      </div>`;
    el.querySelector('[data-act="play"]').onclick = () => preview(m);
    el.querySelector('[data-act="cubase"]').onclick = (e) => openIn(m, "cubase", e.target);
    el.querySelector('[data-act="ableton"]').onclick = (e) => openIn(m, "ableton", e.target);
    box.appendChild(el);
  });
}

function preview(m) {
  const params = new URLSearchParams({ id: m.id });
  if ($("attempo").checked && TRACK && TRACK.bpm) params.set("bpm", TRACK.bpm);
  $("player").hidden = false;
  $("pname").textContent = m.name;
  $("pnote").textContent = "טוען תצוגה מוקדמת…";
  const audio = $("audio");
  audio.src = "/api/preview?" + params.toString();
  audio.play().catch(() => {});
  fetch("/api/preview-info?" + params.toString())
    .then(r => r.json())
    .then(d => { $("pnote").textContent = d.note || ""; if (d.error) $("pnote").textContent = d.error; })
    .catch(() => { $("pnote").textContent = ""; });
}

async function openIn(m, daw, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "פותח…";
  try {
    const data = await api("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: m.id, daw }),
    });
    const where = data.record.session_dir;
    if (data.opened) {
      msg(`✅ נפתח ב-${esc(daw)}: <code>${esc(data.opened_path)}</code><br>השיוך נשמר בתיקייה <code>${esc(where)}</code>`, "ok");
    } else {
      msg(`⚠️ השיוך נשמר בתיקייה <code>${esc(where)}</code>, אבל ה-DAW לא נפתח: ${esc(data.message)}`, "warn");
    }
    loadLinks();
  } catch (err) {
    msg(esc(err.message), "err");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function loadLinks() {
  try {
    const data = await api("/api/links");
    const box = $("links");
    if (!data.links.length) {
      box.innerHTML = '<div class="empty">אין שיוכים עדיין.</div>';
      return;
    }
    box.innerHTML = data.links.map(l => `
      <div class="link">
        <div class="t">${esc(l.track.title || "טראק")} ⇄ ${esc(l.match.name)}
          <span class="badge ${esc(l.match.kind)}">${esc(l.daw)}</span>
          ${l.opened ? "" : '<span class="badge">לא נפתח</span>'}
        </div>
        <div class="p">${esc(l.track.bpm || "?")} BPM · ${esc(l.track.key || "?")} → ${esc(l.match.bpm || "?")} BPM · ${esc(l.match.key || "?")}</div>
        <div class="p">${esc(l.session_dir)}</div>
      </div>`).join("");
  } catch (err) { /* history is best-effort */ }
}

async function reindex() {
  $("reindex").disabled = true;
  $("reindex").innerHTML = '<span class="spin"></span> סורק…';
  try {
    const data = await api("/api/reindex", { method: "POST" });
    msg(`הספרייה נסרקה: ${data.stats.scanned} חדשים, ${data.stats.cached} מהמאגר, ${data.library_size} בסך הכל.`, "ok");
    showFoot(data);
  } catch (err) {
    msg(esc(err.message), "err");
  } finally {
    $("reindex").disabled = false;
    $("reindex").innerHTML = "↻ סרוק ספרייה";
  }
}

function showFoot(state) {
  const roots = (state.library_roots || []).map(r => `<code>${esc(r)}</code>`).join(" ");
  const script = state.external_script
    ? `סקריפט חיצוני: <code>${esc(state.external_script)}</code>`
    : "סקריפט חיצוני: לא מוגדר (<code>DAW_MATCH_SCRIPT</code>)";
  $("foot").innerHTML = `ספרייה (${state.library_size} קבצים): ${roots}<br>${script}`;
}

$("go").onclick = analyze;
$("reindex").onclick = reindex;
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter") analyze(); });
showFoot(BOOT);
loadLinks();
if (BOOT.library_size === 0) {
  msg("הספרייה ריקה — הוסף קבצי <code>.mid</code>, לופים או פרויקטים לתיקיות הספרייה ולחץ ↻ סרוק ספרייה.", "warn");
}
</script>
</body>
</html>
"""


def render_page(boot_json):
    return PAGE.replace("__BOOT__", boot_json)
