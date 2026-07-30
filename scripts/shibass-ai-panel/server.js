"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT || 8787);
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL || "myllama";
const INDEX_FILE = process.env.INDEX_FILE || "H:\\ai-knowledge\\drive-index.jsonl";
const KNOWLEDGE_SCRIPT =
  process.env.KNOWLEDGE_SCRIPT || "H:\\models\\knowledge-from-drives.ps1";
const WAIT_SCRIPT = process.env.WAIT_SCRIPT || "H:\\models\\wait-then-ask.ps1";
const BRAIN_CONTEXT =
  process.env.BRAIN_CONTEXT ||
  "H:\\shibass-ai\\SHIBASS_BRAIN\\system\\context_for_model.txt";
const BRAIN_SCRIPT =
  process.env.BRAIN_SCRIPT || "H:\\models\\shibass-brain\\brain.ps1";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function runPowerShell(args, { timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args],
      { windowsHide: true }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: stderr + "\n[timeout]",
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr: String(err) });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function ollamaFetch(pathname, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs || 120000);
  try {
    const res = await fetch(`${OLLAMA_URL}${pathname}`, {
      ...options,
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, text, json };
  } finally {
    clearTimeout(timer);
  }
}

function getIndexStats() {
  try {
    if (!fs.existsSync(INDEX_FILE)) {
      return { exists: false, path: INDEX_FILE };
    }
    const st = fs.statSync(INDEX_FILE);
    return {
      exists: true,
      path: INDEX_FILE,
      bytes: st.size,
      mtime: st.mtime.toISOString(),
    };
  } catch (err) {
    return { exists: false, path: INDEX_FILE, error: String(err.message || err) };
  }
}

app.get("/api/status", async (_req, res) => {
  let ollama = { ok: false };
  try {
    const tags = await ollamaFetch("/api/tags", { timeoutMs: 5000 });
    const models = tags.json?.models?.map((m) => m.name) || [];
    ollama = {
      ok: tags.ok,
      status: tags.status,
      models,
      hasMyllama: models.some((n) => String(n).startsWith(MODEL)),
    };
  } catch (err) {
    ollama = { ok: false, error: String(err.message || err) };
  }

  res.json({
    ollamaUrl: OLLAMA_URL,
    model: MODEL,
    ollama,
    index: getIndexStats(),
    knowledgeScript: fs.existsSync(KNOWLEDGE_SCRIPT),
    waitScript: fs.existsSync(WAIT_SCRIPT),
    knowledgeScriptPath: KNOWLEDGE_SCRIPT,
    waitScriptPath: WAIT_SCRIPT,
    brainContext: fs.existsSync(BRAIN_CONTEXT),
    brainScript: fs.existsSync(BRAIN_SCRIPT),
    brainRoot: "H:\\shibass-ai\\SHIBASS_BRAIN",
  });
});

app.post("/api/chat", async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  let brain = "";
  try {
    if (fs.existsSync(BRAIN_SCRIPT)) {
      await runPowerShell(["-File", BRAIN_SCRIPT, "-ExportContext"], {
        timeoutMs: 60000,
      });
    }
    if (fs.existsSync(BRAIN_CONTEXT)) {
      brain = fs.readFileSync(BRAIN_CONTEXT, "utf8").slice(0, 12000);
    }
  } catch {
    brain = "";
  }

  const fullPrompt = brain
    ? `You are ShiBass local assistant. Follow SHIBASS BRAIN rules.\n\nSHIBASS BRAIN:\n${brain}\n\nUSER:\n${prompt}`
    : prompt;

  try {
    const result = await ollamaFetch("/api/generate", {
      method: "POST",
      timeoutMs: 5 * 60 * 1000,
      body: JSON.stringify({
        model: MODEL,
        prompt: fullPrompt,
        stream: false,
      }),
    });

    if (!result.ok) {
      res.status(502).json({
        error: "Ollama generate failed",
        detail: result.text || result.json,
      });
      return;
    }

    res.json({
      response: result.json?.response || "",
      model: result.json?.model || MODEL,
      brainInjected: Boolean(brain),
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.post("/api/ask-knowledge", async (req, res) => {
  const question = String(req.body?.question || "").trim();
  const wait = Boolean(req.body?.wait);
  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const script = wait ? WAIT_SCRIPT : KNOWLEDGE_SCRIPT;
  if (!fs.existsSync(script)) {
    res.status(500).json({
      error: `Missing script: ${script}`,
      hint: "Copy knowledge-from-drives.ps1 (and wait-then-ask.ps1) to H:\\models\\",
    });
    return;
  }

  const args = wait
    ? ["-File", script, "-Question", question]
    : ["-File", script, "-Ask", question];

  const result = await runPowerShell(args, { timeoutMs: 20 * 60 * 1000 });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

  res.json({
    ok: result.ok,
    code: result.code,
    output,
    waited: wait,
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`shibass-ai-panel  http://127.0.0.1:${PORT}`);
  console.log(`Ollama            ${OLLAMA_URL}  model=${MODEL}`);
  console.log(`Index             ${INDEX_FILE}`);
});
