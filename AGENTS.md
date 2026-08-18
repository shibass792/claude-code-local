# AGENTS.md

## Cursor Cloud specific instructions

This repo (`claude-code-local`) is a macOS/Apple-Silicon toolkit: a single-file MLX
inference server (`proxy/server.py`) that exposes the Anthropic Messages API so
Claude Code can talk to local models. See `README.md` for the full product and
the Mac install flow (`setup.sh`). The notes below only cover what is
non-obvious when developing on the **Linux Cloud VM**.

### Platform reality (important)

- MLX is normally Apple-Silicon-only, but it now ships a **Linux CPU backend**.
  It runs here, so you can start `proxy/server.py` and exercise the full
  Anthropic API (text, streaming, and tool-call translation).
- `setup.sh` and `scripts/doctor.sh` hard-exit on non-`arm64`. Do **not** run
  them on the Linux VM — use `bash scripts/cloud-agent-install.sh` instead
  (also invoked automatically from `.cursor/environment.json`).

### Non-obvious gotchas

- `pip install mlx-lm` alone does **not** pull a working `mlx` core on Linux;
  you also need the CPU backend via `mlx[cpu]` (installs `mlx-cpu` /
  `libmlx.so`). Without it you get `ImportError: libmlx.so`. The install script
  installs both.
- The Linux CPU build is **unoptimized** (~6–7 GFLOP/s). **4-bit quantized**
  models decode pathologically slowly on it (>30s/token). Use **non-quantized
  `bf16`** small models for any CPU testing, e.g.
  `mlx-community/Qwen2.5-1.5B-Instruct-bf16` (~0.5–1.5 s/token) or the 0.5B
  variant for speed.
- The default `MLX_MODEL` (gemma-4-31b) will not fit/run here. Always override
  `MLX_MODEL` with a small `bf16` model.
- Requests still cost real CPU time: a short reply is a few seconds, but large
  `max_tokens` or long prompts (e.g. a full Claude Code system prompt) can take
  minutes. Keep test prompts and `max_tokens` small.

### Running the core server

```
MLX_MODEL=mlx-community/Qwen2.5-1.5B-Instruct-bf16 MLX_PORT=4000 \
  ~/.local/mlx-server/bin/python proxy/server.py
```

- Health: `curl localhost:4000/health`
- API: `POST /v1/messages` (also `/messages`); supports `stream: true` and
  Anthropic `tool_use` / `tool_result` translation. Model id in the request is
  ignored — the loaded `MLX_MODEL` answers.

### Smart router (stdlib only)

- `smart-router/router.py` ("ONE AI", port 4010) needs **zero** third-party
  packages and runs anywhere.
- Routing self-test: `python3 smart-router/router.py --selftest`
- Run server: `python3 smart-router/router.py` then
  `curl --max-time 2 http://127.0.0.1:4010/health` →
  `{"status":"ok","router":"one-ai"}`. Use `--max-time` because the handler may
  not set `Content-Length` on keep-alive responses.
- A real `POST /v1/messages` through the router will try to start MLX backends
  under macOS-specific paths (`~/Desktop/...`, warm pool on :4000/:4001). That
  is expected to fail on Linux; `--selftest` is the supported validation path
  here.

### Proxy logic without inference

Tool-call parsing, Anthropic↔local message/tool conversion, and code/browser-mode
prompt slimming can be exercised without Apple Silicon by stubbing `mlx`,
`mlx.core`, `mlx.nn`, and `mlx_lm.*` in `sys.modules` before importing
`proxy/server.py`. Never call `load_model()` / inference — only the pure
functions (`parse_tool_calls`, `convert_messages`, `convert_tools_for_llm`,
`optimize_for_code`, `clean_response`).

### Tests / lint

- Automated tests: `scripts/test_mlx_server.py` hits a running server on `:4000`
  with multi-step tool tasks. It is slow on the CPU VM and pass rates depend on
  the (small) model, so treat tool-call FAILs as model quality, not env
  breakage (README's 98/98 assumes the large Mac models).
- No linter is configured; the closest checks are `python -m py_compile` on the
  `.py` files and `bash -n` on the shell scripts.
- Claude Code CLI works against the server on a Mac but is impractically slow on
  the CPU-only VM; use direct `curl` to `/v1/messages` for hello-world testing.

### Environment

- Python venv lives at `~/.local/mlx-server` (matches `setup.sh` on macOS). It
  is not in the repo; `scripts/cloud-agent-install.sh` (re)creates and refreshes
  it. Requires the `python3.12-venv` system package.

### Ports (macOS production layout)

proxy `4000` (warm-pool gemma `4001`, GLM `4003`), router `4010`, DeepSeek `8000`.
