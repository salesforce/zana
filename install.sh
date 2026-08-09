#!/usr/bin/env bash
#
# install.sh — one-shot installer for Zana Command Center + Zana.
#
# Two ways to run it:
#
#   A. Remote bootstrap (no clone needed) — clones the repo, then installs.
#      The trailing `bash -s -- --install-app` builds the packaged .app and
#      moves it into /Applications (the `-s --` is how you pass flags through
#      a pipe to bash):
#        curl -fsSL https://raw.githubusercontent.com/salesforce/zana/main/install.sh \
#          | bash -s -- --install-app
#
#   B. From a checkout:
#        git clone https://github.com/salesforce/zana.git
#        cd zana && ./install.sh
#
# Installs, in order:
#   1. Zana Command Center  — this Electron app (deps + native rebuild).
#   2. Zana                  — the @zana-ai/mcp MCP server (npm, public) + the
#                              Claude Code plugin marketplace (grebmann1/zana),
#                              then seeds the global ~/.zana workspace (starter
#                              squads + profiles) via `zana init wizard` so the
#                              in-app "Zana" tab isn't dead-on-arrival.
#
# The script is idempotent: re-running it is safe and only redoes what's missing
# or out of date. Nothing is installed without being announced first.
#
# By default this builds a packaged macOS .app and installs it into
# /Applications (clearing the Gatekeeper quarantine) so you get a real,
# launch-from-Spotlight app. Pass --no-install-app to skip that and stay
# source-only (run via `npm run dev`).
#
# Flags:
#   --app-only        just the app (deps + rebuild + /Applications install)
#   --no-zana         skip the Zana MCP + plugin steps
#   --no-install-app  don't build/copy the .app into /Applications (source-only)
#   --dist            force a fresh packaged-app rebuild (npm run dist:mac)
#   --install-app     install the .app into /Applications (the default; kept for
#                     explicitness / to override a prior --no-install-app)
#   -h | --help       show this help
#
# Env:
#   ZCC_INSTALL_DIR   where to clone during remote bootstrap (default: ~/zana-command-center)

set -euo pipefail

REPO_URL="https://github.com/salesforce/zana.git"

# ── Pretty output ─────────────────────────────────────────────────────────────
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  \033[36m→\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  cat <<'EOF'
install.sh — installer for Zana Command Center + Zana.

By default it builds a packaged macOS .app and installs it into /Applications
(clearing the Gatekeeper quarantine) so you get a real, launch-from-Spotlight
app. Pass --no-install-app to stay source-only.

Remote bootstrap (no clone needed). The trailing `bash -s -- --install-app`
builds the .app and moves it into /Applications (`-s --` is how flags get
passed through a pipe to bash):
   curl -fsSL https://raw.githubusercontent.com/salesforce/zana/main/install.sh \
    | bash -s -- --install-app

From a checkout:
  ./install.sh

Flags:
  --app-only        just the app (deps + native rebuild + /Applications install)
  --no-zana         skip the Zana MCP server + plugin install
  --no-install-app  don't build/copy the .app into /Applications (source-only)
  --dist            force a fresh packaged-app rebuild (npm run dist:mac)
  --install-app     install the .app into /Applications (the default)
  -h, --help        show this help

Env:
  ZCC_INSTALL_DIR  clone target for remote bootstrap (default: ~/zana-command-center)
EOF
}

# ── Flags (parsed before bootstrap so --help needs no clone) ─────────────────
DO_APP=1
DO_ZANA=1
DO_DIST=0
# Install into /Applications by default — the common case is wanting a real,
# double-clickable app. --no-install-app opts back out to a source-only setup.
DO_INSTALL_APP=1

for arg in "$@"; do
  case "$arg" in
    --app-only)       DO_ZANA=0 ;;
    --no-zana)        DO_ZANA=0 ;;
    --no-install-app) DO_INSTALL_APP=0 ;;
    --dist)           DO_DIST=1 ;;
    --install-app)    DO_INSTALL_APP=1 ;;  # the default; explicit form / overrides a prior --no-install-app
    -h|--help)        usage; exit 0 ;;
    *) echo "unknown flag: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# ── Bootstrap: locate the repo, or clone it when run standalone (curl|bash) ──
# When piped from stdin there is no checkout around us: BASH_SOURCE points at
# nothing usable. Detect whether we're sitting inside the repo (our dir has the
# app's package.json); if not, clone it and hand off to the committed copy.
SCRIPT_PATH="${BASH_SOURCE[0]:-}"
REPO_ROOT=""
if [ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ]; then
  cand="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
  if grep -sq '"name": "zana-command-center"' "$cand/package.json"; then
    REPO_ROOT="$cand"
  fi
fi

if [ -z "$REPO_ROOT" ]; then
  bold "Bootstrapping — fetching Zana Command Center"
  have git || { echo "git is required to clone the repo — install git and re-run." >&2; exit 1; }
  CLONE_DIR="${ZCC_INSTALL_DIR:-$HOME/zana-command-center}"
  if [ -d "$CLONE_DIR/.git" ]; then
    info "Repo already at $CLONE_DIR — updating (git pull --ff-only)…"
    git -C "$CLONE_DIR" pull --ff-only || warn "pull skipped (local changes?) — using existing checkout"
  else
    info "Cloning $REPO_URL → ${CLONE_DIR}…"
    git clone --depth 1 "$REPO_URL" "$CLONE_DIR"
  fi
  ok "Repo ready at $CLONE_DIR"
  echo
  # Hand off to the checked-out script (which will find REPO_ROOT and skip this).
  # ${ARR[@]+...} guard keeps an empty arg list safe under bash 3.2 + set -u.
  exec bash "$CLONE_DIR/install.sh" ${@+"$@"}
fi

cd "$REPO_ROOT"

# ── 0. Prerequisites ───────────────────────────────────────────────────────────
bold "Checking prerequisites"

missing=0
for bin in node npm git; do
  if have "$bin"; then ok "$bin $($bin --version 2>/dev/null | head -1)"
  else warn "$bin not found"; missing=1; fi
done
[ "$missing" -eq 1 ] && { echo "Install Node 20+ (with npm) and git, then re-run." >&2; exit 1; }

# Node major version gate — the app targets Node 20+/Electron 33.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  warn "Node $NODE_MAJOR detected; this app expects Node 20 or newer."
fi

if have claude; then ok "claude CLI present"
else warn "claude CLI not found — Zana MCP/plugin wiring (step 3) will be skipped"; fi
echo

# ── 1. Zana Command Center (the app) ────────────────────────────────────────────
if [ "$DO_APP" -eq 1 ]; then
  bold "1/2  Zana Command Center"
  info "Installing dependencies (npm install)…"
  npm install
  info "Rebuilding native modules for Electron's ABI (node-pty, better-sqlite3)…"
  npm run rebuild
  ok "App dependencies ready"
  # Locate the most recently built unpacked .app. electron-builder writes it to
  # an arch-specific subdir (dist/mac-arm64, dist/mac, …); pick the newest rather
  # than hardcoding the arch, so this works on Apple Silicon and Intel alike.
  find_built_app() {
    find dist -maxdepth 2 -name '*.app' -type d -prune 2>/dev/null \
      | xargs -I{} stat -f '%m %N' {} 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-
  }

  # Build a packaged .app when explicitly asked (--dist), OR when --install-app
  # was requested but there's no existing build to copy. If a build already
  # exists and --dist wasn't passed, reuse it — no need to spend minutes
  # rebuilding just to move the app into /Applications.
  built_app="$(find_built_app)"
  if [ "$DO_DIST" -eq 1 ] || { [ "$DO_INSTALL_APP" -eq 1 ] && { [ -z "$built_app" ] || [ ! -d "$built_app" ]; }; }; then
    if [ "$DO_INSTALL_APP" -eq 1 ] && [ "$DO_DIST" -eq 0 ]; then
      info "No packaged .app found under dist/ — building one (npm run dist:mac)…"
    else
      info "Building a packaged macOS app (npm run dist:mac)…"
    fi
    npm run dist:mac
    built_app="$(find_built_app)"
    ok "Packaged app written to dist/"
  elif [ "$DO_INSTALL_APP" -eq 1 ]; then
    info "Reusing existing build: $built_app (pass --dist to force a rebuild)"
  fi

  if [ "$DO_INSTALL_APP" -eq 1 ]; then
    if [ -z "$built_app" ] || [ ! -d "$built_app" ]; then
      warn "Couldn't find a built .app under dist/ — skipping /Applications install."
    else
      dest="/Applications/$(basename "$built_app")"
      info "Installing $(basename "$built_app") → /Applications…"
      # ditto preserves the bundle (symlinks, code signature) better than cp -R.
      # If /Applications isn't writable (managed Macs), fall back to sudo so the
      # move still succeeds instead of silently bailing.
      if rm -rf "$dest" 2>/dev/null && ditto "$built_app" "$dest" 2>/dev/null; then
        :
      else
        warn "/Applications needs elevated permissions — retrying with sudo…"
        sudo rm -rf "$dest"
        sudo ditto "$built_app" "$dest"
      fi
      # Strip the quarantine xattr so Gatekeeper doesn't block first launch. The
      # app is signed but not notarized; clearing quarantine is the local
      # equivalent of Privacy & Security → Open Anyway.
      xattr -dr com.apple.quarantine "$dest" 2>/dev/null \
        || sudo xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true
      ok "Installed to $dest — launch it from /Applications or Spotlight"
    fi
  fi
  echo
fi

# ── 2. Zana (MCP server + Claude Code plugins) ──────────────────────────────────
if [ "$DO_ZANA" -eq 1 ]; then
  bold "2/2  Zana"
  if ! have npm; then
    warn "npm missing — cannot install @zana-ai/mcp"
  else
    info "Installing the Zana MCP server globally (@zana-ai/mcp)…"
    npm install -g @zana-ai/mcp@latest 2>&1 | tail -3
    ok "@zana-ai/mcp $(npm ls -g @zana-ai/mcp --depth=0 2>/dev/null | awk -F@ '/@zana-ai\/mcp/ {print $NF; exit}')"
  fi

  if have claude; then
    # Register the MCP server (idempotent: skip if already present).
    if claude mcp get zana >/dev/null 2>&1; then
      ok "MCP server 'zana' already registered"
    else
      info "Registering the Zana MCP server with Claude Code…"
      claude mcp add zana -- npx -y @zana-ai/mcp && ok "MCP server 'zana' registered"
    fi

    # Add the Zana plugin marketplace (idempotent) and install its plugins.
    if claude plugin marketplace list 2>/dev/null | grep -q zana-marketplace; then
      ok "Marketplace 'zana-marketplace' already added"
    else
      info "Adding the Zana plugin marketplace (grebmann1/zana)…"
      claude plugin marketplace add grebmann1/zana && ok "Marketplace added"
    fi
    info "Installing Zana plugins (zana, zana-loop)…"
    claude plugin install zana@zana-marketplace      2>/dev/null || warn "  zana plugin install skipped (may already be installed)"
    claude plugin install zana-loop@zana-marketplace 2>/dev/null || warn "  zana-loop plugin install skipped (may already be installed)"
    ok "Zana plugins ready"
  else
    warn "claude CLI not found — skipped MCP registration and plugin install."
    warn "  After installing Claude Code, run:"
    warn "    claude mcp add zana -- npx -y @zana-ai/mcp"
    warn "    claude plugin marketplace add grebmann1/zana"
    warn "    claude plugin install zana@zana-marketplace"
  fi

  # Seed the global ~/.zana workspace (starter squads + profiles). WITHOUT this,
  # `npm install -g @zana-ai/mcp` leaves you with the CLI but no ~/.zana, so the
  # in-app "Zana" tab shows an empty state and its "New team" save fails (the
  # extension writes ~/.zana/teams/*.json but can't create the dir). `zana init
  # wizard "$HOME"` targets $HOME so it lands exactly on ~/.zana (not a stray
  # .zana/ in the checkout). Non-interactive (mirrors Zana's own installer) and
  # idempotent — skip if ~/.zana already exists, and only if `zana` is on PATH
  # (a global npm install doesn't guarantee that).
  if [ -d "$HOME/.zana" ]; then
    ok "Global Zana workspace already present (~/.zana)"
  elif have zana; then
    info "Seeding the global Zana workspace (~/.zana) via 'zana init wizard'…"
    if zana init wizard "$HOME" >/dev/null 2>&1; then
      ok "Global Zana workspace seeded (~/.zana)"
    else
      warn "  'zana init wizard' returned non-zero — the Zana tab may show an"
      warn "  empty state. Re-run manually:  zana init wizard \"\$HOME\""
    fi
  else
    warn "'zana' CLI not on PATH — cannot seed ~/.zana (the Zana tab needs it)."
    warn "  Ensure the npm global bin dir is on PATH, then run:"
    warn "    zana init wizard \"\$HOME\""
  fi
  echo
fi

# ── Done ────────────────────────────────────────────────────────────────────────
bold "Done."
echo "Next:"
if [ "$DO_INSTALL_APP" -eq 1 ]; then
  echo "  • Launch from /Applications (or Spotlight): Zana Command Center"
else
  echo "  • Launch the app:        npm run dev"
fi
echo "  • Reopen Claude Code sessions so the Zana MCP server + plugins load."
