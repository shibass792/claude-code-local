# AGENTS.md

## Cursor Cloud specific instructions

This repo (`claude-code-local`) runs Claude Code / agents **100% on-device on Apple
Silicon** via Apple MLX. The Cursor Cloud VM is **Linux x86 with no Apple Silicon /
Metal GPU**, so the MLX inference pipeline cannot run here. Keep this in mind:

### What CANNOT run on the Cloud VM (Apple-Silicon only)
- `proxy/server.py` (the MLX Native Anthropic server, port 4000): `import mlx` fails on
  Linux and the target models are 18–75 GB. Do not try to `pip install mlx-lm` / download
  models here.
- `setup.sh`: hard-exits unless `uname -m == arm64` (also uses `brew`, `sysctl`, `lsof`,
  `~/Desktop`). It is a macOS one-command installer, not a Linux dev-setup script.
- `scripts/test_mlx_server.py`: needs `requests` **and** a live MLX server on `:4000`, so it
  only passes on Apple Silicon.
- Everything under `launchers/*.command` and `NarrativeGemma` — macOS desktop launchers.

### What DOES run on the Cloud VM (Python 3.12, stdlib only)
- **Smart router** (`smart-router/router.py`, "ONE AI", port 4010) is pure stdlib.
  - Routing brain self-test: `python3 smart-router/router.py --selftest`
  - Run server: `python3 smart-router/router.py` (then `curl http://127.0.0.1:4010/health`
    → `{"status":"ok","router":"one-ai"}`). `curl /health` may hang until keep-alive close
    (HTTP/1.1, no Content-Length); the body still returns — use `curl --max-time`.
  - Caveat: a real `POST /v1/messages` will block/fail because `ensure_backend()` tries to
    start MLX backends (warm-pool paths under `~/Desktop/...`) that don't exist on Linux.
    That's expected; the routing decision itself is what's proven by `--selftest`.
- **Proxy pure logic** (tool-call parsing, Anthropic↔local message/tool conversion,
  code/browser-mode prompt slimming) can be exercised without Apple Silicon by stubbing the
  `mlx`, `mlx.core`, `mlx.nn`, and `mlx_lm.*` modules in `sys.modules` before importing
  `proxy/server.py`. Never call `load_model()` / inference — only the pure functions
  (`parse_tool_calls`, `convert_messages`, `convert_tools_for_llm`, `optimize_for_code`,
  `clean_response`).

### Dependencies
There are no manifests (no `requirements.txt` / `package.json`). The router needs **zero**
third-party packages. The only third-party imports in the repo are `mlx-lm` (Apple only)
and `requests` (used by `scripts/test_mlx_server.py`). `proxy/server.py` is the source of
truth and is symlinked to `~/.local/mlx-native-server/server.py` by `setup.sh` on macOS.

### Ports
proxy `4000` (warm-pool gemma `4001`, GLM `4003`), router `4010`, DeepSeek `8000`.
