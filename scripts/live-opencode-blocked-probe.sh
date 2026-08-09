#!/usr/bin/env bash
# LIVE end-to-end verification of LAS-07 OpenCode "needs-you" (blocked) detection.
#
# Bundles scripts/live-opencode-blocked-probe.mts against the REAL src/main
# detector modules, spawns the real `opencode` TUI via node-pty, drives it into
# its `△ Permission required` prompt, and asserts the fused AgentStatusTracker
# state flips to `blocked` (then auto-clears to `working` on answer).
#
# Requires: a working `opencode` on PATH, already authenticated to a provider.
# Override the binary with ZCC_OPENCODE_BIN=/path/to/opencode.
#
# Not part of `npm test` — it drives a real interactive TUI and spends a model
# turn. Run it by hand when touching the blocked-detection path:
#   ./scripts/live-opencode-blocked-probe.sh
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="scripts/.live-probe.mjs"
trap 'rm -f "$OUT"' EXIT

node_modules/.bin/esbuild scripts/live-opencode-blocked-probe.mts \
  --bundle --platform=node --format=esm --target=node20 \
  --external:node-pty --outfile="$OUT" >/dev/null

exec node "$OUT"
