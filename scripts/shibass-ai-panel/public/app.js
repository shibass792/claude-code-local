async function getJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.detail || res.statusText;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

function fmtBytes(n) {
  if (n == null) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function refreshStatus() {
  const box = document.getElementById("statusBox");
  try {
    const s = await getJson("/api/status");
    document.getElementById("modelName").textContent = s.model;

    const lines = [];
    if (s.ollama?.ok) {
      lines.push(
        `<p class="ok">Ollama: חי · מודלים: ${(s.ollama.models || []).join(", ") || "-"}</p>`
      );
      if (!s.ollama.hasMyllama) {
        lines.push(
          `<p class="warn">המודל ${s.model} לא ברשימה - ודא שהוא רץ ב-Ollama</p>`
        );
      }
    } else {
      lines.push(
        `<p class="bad">Ollama לא זמין על ${s.ollamaUrl}</p>`
      );
    }

    if (s.brainContext || s.brainFactsCount > 0) {
      lines.push(
        `<p class="ok">Brain: ${s.brainFactsCount || 0} עובדות פעילות · context מוכן</p>`
      );
    } else {
      lines.push(
        `<p class="warn">Brain ריק - הרץ import-session-memory.ps1</p>`
      );
    }

    if (s.index?.exists) {
      lines.push(
        `<p class="ok">אינדקס: ${fmtBytes(s.index.bytes)} · עודכן ${s.index.mtime}</p>`
      );
    } else {
      lines.push(`<p class="warn">אין אינדקס כוננים</p>`);
    }

    lines.push(
      s.knowledgeScript
        ? `<p class="ok">knowledge script: נמצא</p>`
        : `<p class="bad">חסר ${s.knowledgeScriptPath}</p>`
    );

    box.innerHTML = lines.join("");
  } catch (err) {
    box.innerHTML = `<p class="bad">סטטוס נכשל: ${err.message}</p>`;
  }
}

function setBusy(on) {
  document.getElementById("busy").hidden = !on;
  document.getElementById("askBtn").disabled = on;
  document.getElementById("refreshBtn").disabled = on;
}

async function sendAsk() {
  const question = document.getElementById("question").value.trim();
  const out = document.getElementById("answerOut");
  if (!question) {
    out.textContent = "כתוב שאלה קודם.";
    return;
  }

  const mode = document.querySelector('input[name="mode"]:checked')?.value;
  const wait = document.getElementById("waitIndex").checked;

  setBusy(true);
  out.textContent =
    mode === "knowledge"
      ? "Brain + חיפוש בכוננים..."
      : "שואל לפי עובדות ה-Brain...";

  try {
    if (mode === "knowledge") {
      const data = await getJson("/api/ask-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, wait }),
      });
      out.textContent = data.output || "(אין פלט)";
    } else {
      const data = await getJson("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: question }),
      });
      const prefix = data.brainInjected
        ? `[Brain facts: ${data.brainFactsCount || "?"}]\n\n`
        : "[בלי Brain]\n\n";
      out.textContent = prefix + (data.response || "(ריק)");
    }
  } catch (err) {
    out.textContent = `שגיאה: ${err.message}`;
  } finally {
    setBusy(false);
    refreshStatus();
  }
}

document.getElementById("askBtn").addEventListener("click", sendAsk);
document.getElementById("refreshBtn").addEventListener("click", refreshStatus);
document.getElementById("question").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendAsk();
  }
});

refreshStatus();
setInterval(refreshStatus, 15000);
