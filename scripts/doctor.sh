#!/bin/bash
# Claude Code Local — Doctor
# What can my Mac actually run? Tells you which model fits and what to expect.
#
# Usage: bash scripts/doctor.sh
#   --bench   also run a 30-second tok/s benchmark on the recommended model

# ── Colors ────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
  C_CYAN=$'\033[36m'; C_MAG=$'\033[35m'
else
  C_BOLD=""; C_DIM=""; C_RESET=""
  C_GREEN=""; C_YELLOW=""; C_RED=""; C_CYAN=""; C_MAG=""
fi

ok()    { echo "${C_GREEN}✓${C_RESET} $*"; }
warn()  { echo "${C_YELLOW}!${C_RESET} $*"; }
err()   { echo "${C_RED}✗${C_RESET} $*"; }
info()  { echo "${C_DIM}·${C_RESET} $*"; }

# ── Header ────────────────────────────────────────────────────
echo ""
echo "${C_CYAN}╔══════════════════════════════════════════════════╗${C_RESET}"
echo "${C_CYAN}║${C_RESET}   ${C_BOLD}Claude Code Local — Doctor${C_RESET}                   ${C_CYAN}║${C_RESET}"
echo "${C_CYAN}║${C_RESET}   ${C_DIM}What can your Mac actually run?${C_RESET}              ${C_CYAN}║${C_RESET}"
echo "${C_CYAN}╚══════════════════════════════════════════════════╝${C_RESET}"
echo ""

# ── Apple Silicon check ───────────────────────────────────────
if [[ $(uname -m) != "arm64" ]]; then
  err "This requires Apple Silicon (M1 or later)."
  err "Detected architecture: $(uname -m)"
  exit 1
fi

# ── System detection ──────────────────────────────────────────
MEM_GB=$(sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1073741824)}')
CHIP=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo 'Apple Silicon')
CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo '?')
MACOS=$(sw_vers -productVersion 2>/dev/null || echo '?')

echo "${C_BOLD}🖥  Your Mac${C_RESET}"
info "Chip:    $CHIP"
info "Memory:  ${MEM_GB} GB"
info "Cores:   $CORES"
info "macOS:   $MACOS"
echo ""

# ── Disk free ─────────────────────────────────────────────────
HF_CACHE="${HF_HOME:-$HOME/.cache/huggingface}"
if [ -d "$HF_CACHE" ]; then
  CACHE_GB=$(du -sk "$HF_CACHE" 2>/dev/null | awk '{print int($1/1024/1024)}')
else
  CACHE_GB=0
fi
DISK_FREE_GB=$(df -k "$HOME" 2>/dev/null | awk 'NR==2 {print int($4/1024/1024)}')

echo "${C_BOLD}💾 Storage${C_RESET}"
info "HuggingFace cache:  ${C_CYAN}${HF_CACHE}${C_RESET}"
info "Cache size:         ${CACHE_GB} GB used"
info "Disk free:          ${DISK_FREE_GB} GB"
echo ""

# ── MLX install state ─────────────────────────────────────────
MLX_VENV="$HOME/.local/mlx-server"
echo "${C_BOLD}🧰 MLX install${C_RESET}"
if [ -d "$MLX_VENV" ]; then
  ok "MLX virtualenv:    $MLX_VENV"
  if "$MLX_VENV/bin/python" -c "import mlx_lm" 2>/dev/null; then
    MLX_VER=$("$MLX_VENV/bin/pip" show mlx-lm 2>/dev/null | awk '/^Version:/ {print $2}')
    ok "mlx-lm installed:  v${MLX_VER:-unknown}"
  else
    warn "mlx-lm NOT installed in virtualenv (run setup.sh)"
  fi
else
  warn "MLX virtualenv not found — run ${C_CYAN}bash setup.sh${C_RESET} first"
fi
echo ""

# ── Downloaded models ─────────────────────────────────────────
echo "${C_BOLD}📦 Models in your cache${C_RESET}"
FOUND_MODELS=0
if [ -d "$HF_CACHE/hub" ]; then
  for d in "$HF_CACHE/hub"/models--*; do
    [ -d "$d" ] || continue
    NAME=$(basename "$d" | sed 's/^models--//; s|--|/|g')
    SIZE_GB=$(du -sk "$d" 2>/dev/null | awk '{print int($1/1024/1024)}')
    info "${C_MAG}${NAME}${C_RESET} (${SIZE_GB} GB)"
    FOUND_MODELS=$((FOUND_MODELS+1))
  done
fi
if [ $FOUND_MODELS -eq 0 ]; then
  warn "No models downloaded yet — see verdict below for what to grab."
fi
echo ""

# ── Verdict ───────────────────────────────────────────────────
echo "${C_BOLD}🎯 Verdict — what to actually run${C_RESET}"
echo ""

# Memory tiers. These mirror setup.sh exactly — the doctor must not recommend
# a model that setup.sh won't install for the same amount of RAM, or you get
# told to run a 31B on a 16 GB Mac and it swaps itself to death.
if [ $MEM_GB -ge 96 ]; then
  ok "${MEM_GB} GB → ${C_BOLD}${C_GREEN}Qwen 3.5 122B${C_RESET} (THE BEAST) — what setup.sh installs here"
  echo "    Expected: ~65 tok/s. MoE with 10B active, 256K context, ~75 GB RAM."
  echo "    Also solid: ${C_CYAN}Qwen3.6-35B-A3B (MLX 4-bit)${C_RESET} — ~100 tok/s gen, ~22 GB peak. Community-validated on M4 Max (issue #31)."
  echo "    You have headroom for any MLX model on HuggingFace."
  RECOMMENDED="mlx-community/Qwen3.5-122B-A10B-4bit"
  NEEDS_DISK_GB=65
  EXPECTED_TPS="~65"
elif [ $MEM_GB -ge 64 ]; then
  ok "${MEM_GB} GB → ${C_BOLD}${C_GREEN}Gemma 4 31B${C_RESET} (THE QUICK ONE) — what setup.sh installs here"
  echo "    Expected: ~15 tok/s, ~18 GB RAM. Matt's daily-use favorite."
  echo "    Qwen 3.5 122B needs 96 GB+ — it won't fit here."
  RECOMMENDED="divinetribe/gemma-4-31b-it-abliterated-4bit-mlx"
  NEEDS_DISK_GB=18
  EXPECTED_TPS=""
elif [ $MEM_GB -ge 32 ]; then
  ok "${MEM_GB} GB → ${C_BOLD}${C_GREEN}Gemma 4 12B${C_RESET} — what setup.sh installs here"
  echo "    ~7 GB on disk, fits 32 GB comfortably alongside Claude Code and your editor."
  echo "    With headroom (~15 GB) you can upgrade to ${C_CYAN}divinetribe/Qwen3.6-27B-abliterated-4bit-mlx${C_RESET}:"
  echo "      MLX_MODEL=divinetribe/Qwen3.6-27B-abliterated-4bit-mlx bash scripts/download-and-import.sh"
  echo "    Gemma 4 31B needs ~18 GB of weights — tight on this tier, don't start there."
  RECOMMENDED="divinetribe/gemma-4-12B-it-abliterated-4bit-mlx-text"
  NEEDS_DISK_GB=7
  EXPECTED_TPS=""
elif [ $MEM_GB -ge 16 ]; then
  warn "${MEM_GB} GB → ${C_BOLD}Qwen 3.5 4B${C_RESET} only — the lightweight tier"
  echo "    setup.sh installs the 4B here. It's browser-agent friendly, but it is not"
  echo "    the coding experience the benchmarks in the README show."
  echo "    Nothing bigger fits: Gemma 4 12B wants 32 GB, Gemma 4 31B wants 64 GB."
  RECOMMENDED="mlx-community/Qwen3.5-4B-4bit"
  NEEDS_DISK_GB=3
  EXPECTED_TPS=""
else
  err "${MEM_GB} GB is below what this stack needs."
  echo "    Even the smallest model setup.sh installs (Qwen 3.5 4B) leaves nothing"
  echo "    for macOS and Claude Code at this RAM. Upgrade, or run the cloud CLI."
  RECOMMENDED=""
  NEEDS_DISK_GB=0
  EXPECTED_TPS=""
fi
echo ""

# ── Disk warning ──────────────────────────────────────────────
# Compare against the model this tier actually downloads, plus a few GB of
# slack for the HuggingFace staging copy.
if [ -n "$RECOMMENDED" ] && [ "$DISK_FREE_GB" -lt $((NEEDS_DISK_GB + 5)) ]; then
  warn "Only ${DISK_FREE_GB} GB free on disk — ${RECOMMENDED##*/} needs ~${NEEDS_DISK_GB} GB."
  warn "Free some space before running ${C_CYAN}bash setup.sh${C_RESET}."
  echo ""
fi

# ── Quick install hint ────────────────────────────────────────
if [ $FOUND_MODELS -eq 0 ] && [ -n "$RECOMMENDED" ]; then
  echo "${C_BOLD}🚀 Next step${C_RESET}"
  echo "    ${C_CYAN}bash setup.sh${C_RESET}   # downloads $RECOMMENDED and creates a launcher"
  echo ""
fi

# ── Optional benchmark ────────────────────────────────────────
if [[ "$1" == "--bench" ]]; then
  echo "${C_BOLD}⏱  Benchmark${C_RESET}"
  if [ ! -d "$MLX_VENV" ]; then
    warn "Skipping — MLX not installed yet."
  elif [ -z "$RECOMMENDED" ]; then
    warn "Skipping — no recommended model for this RAM tier."
  elif [ ! -d "$HF_CACHE/hub/models--$(echo "$RECOMMENDED" | sed 's|/|--|g')" ] && \
       [ ! -d "$HF_CACHE/hub/${RECOMMENDED##*/}" ]; then
    warn "Recommended model not downloaded yet — run setup.sh first to bench it."
  else
    info "Running 100-token generation on $RECOMMENDED ..."
    START=$(date +%s)
    OUT=$("$MLX_VENV/bin/python" -m mlx_lm.generate \
      --model "$RECOMMENDED" \
      --prompt "Write one short sentence." \
      --max-tokens 100 2>&1 | tail -3)
    END=$(date +%s)
    ELAPSED=$((END - START))
    TPS=$(echo "$OUT" | grep -oE 'Generation: *[0-9.]+ tokens-per-sec' | grep -oE '[0-9.]+' | head -1)
    if [ -n "$TPS" ] && [ -n "$EXPECTED_TPS" ]; then
      ok "Measured: ${C_BOLD}${TPS} tok/s${C_RESET} (vs. ${EXPECTED_TPS} expected for your tier)"
    elif [ -n "$TPS" ]; then
      ok "Measured: ${C_BOLD}${TPS} tok/s${C_RESET}"
    else
      info "Run completed in ${ELAPSED}s. Couldn't parse tok/s from output."
    fi
  fi
  echo ""
fi

echo "${C_DIM}Run with --bench to measure actual tok/s on the recommended model.${C_RESET}"
echo ""
