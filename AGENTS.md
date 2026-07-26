# AGENTS.md

## Cursor Cloud specific instructions

This repo (`claude-code-local`) is a macOS/Apple-Silicon toolkit: a single-file
MLX inference server (`proxy/server.py`) that exposes the Anthropic Messages API
so Claude Code can talk to local models. See `README.md` for the full product
and the Mac install flow (`setup.sh`). The notes below only cover what is
non-obvious when developing on the **Linux Cloud VM**.

### Platform reality (important)
- MLX is normally Apple-Silicon-only, but it now ships a **Linux CPU backend**.
  It runs here, so you can actually start `proxy/server.py` and exercise the
  full Anthropic API (text, streaming, and tool-call translation).
- `setup.sh` and `scripts/doctor.sh` hard-exit on non-`arm64`. Do **not** run
  them on the Linux VM — the venv is set up manually (see update script).

### Non-obvious gotchas
- `pip install mlx-lm` alone does **not** pull a working `mlx` core on Linux;
  you also need the CPU backend via `mlx[cpu]` (installs `mlx-cpu` /
  `libmlx.so`). Without it you get `ImportError: libmlx.so`. The update script
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

### Tests / lint / router
- Automated tests: `scripts/test_mlx_server.py` hits a running server on `:4000`
  with multi-step tool tasks. It's slow on the CPU VM and pass rates depend on
  the (small) model, so treat tool-call FAILs as model quality, not env breakage
  (README's 98/98 assumes the large Mac models).
- No linter is configured; the closest checks are `python -m py_compile` on the
  `.py` files and `bash -n` on the shell scripts.
- The smart router (`smart-router/router.py`) is pure stdlib and runs anywhere.
  `python smart-router/router.py --selftest` exercises the routing heuristics
  with no backend needed.
- Claude Code CLI works against the server on a Mac but is impractically slow on
  the CPU-only VM; use direct `curl` to `/v1/messages` for hello-world testing.

### Environment
- Python venv lives at `~/.local/mlx-server` (matches `setup.sh`). It is not in
  the repo; the update script (re)creates and refreshes it. Requires the
  `python3.12-venv` system package to be present.
