# Zana Command Center

**Run and orchestrate many Claude Code sessions across all your projects from one window.**

Zana Command Center is a desktop app (Electron) that turns Claude Code from a single terminal into a multi-project cockpit: spawn agents per project, watch which ones need you vs. which are still working, reply to them, and drive multi-agent workflows — all from one place.

![Zana Command Center — orchestrating Claude Code sessions across projects](docs/assets/zana-command-center-demo.gif)

<p align="center">
  <a href="https://github.com/grebmann1/zcc-releases/releases/latest">
    <img alt="Download the latest release" src="https://img.shields.io/badge/⬇_Download-Latest_Release-2ea44f?style=for-the-badge">
  </a>
</p>

<p align="center"><sub>macOS build</sub></p>

## Install

> 💡 **Easiest path:** grab the installer from the
> **[latest GitHub Release](https://github.com/grebmann1/zcc-releases/releases/latest)**
> (button above) and open the `.dmg`. No build step.

**Recommended:** download and install the app from the **latest GitHub Release**
instead of building from source. Release artifacts include the update feed files
(`latest-mac.yml`, `.zip`, `.zip.blockmap`) that `electron-updater` uses for
in-app updates.

> ⚠️ **First launch — clear the quarantine flag.** These fork builds are
> ad-hoc signed and **not Apple-notarized**, so on first open macOS Gatekeeper
> will refuse to launch (often with a misleading _"…is damaged and can't be
> opened"_ on Apple Silicon). The app is fine — drag it to `/Applications`, then
> run once:
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/Zana Command Center.app"
> ```
>
> After that it opens normally. (Building from source via `install.sh` below
> clears this for you and isn't affected.)

One-liner — fetches the installer and runs it (clones the repo, then sets up
both pieces: the app and **Zana**):

```bash
curl -fsSL https://raw.githubusercontent.com/salesforce/zana/main/install.sh | bash
```

Or clone first and review it before running (same script):

```bash
git clone https://github.com/salesforce/zana.git
cd zana
./install.sh
```

### Installer flags

| Flag | Effect |
| --- | --- |
| _(none)_ | App + Zana (full setup) |
| `--app-only` | Just the app |
| `--no-zana` | Skip the Zana MCP server + plugin |
| `--no-install-app` | Don't install to `/Applications` — stay source-only (`npm run dev`) |
| `--dist` | Force a fresh packaged-app rebuild before installing |

<details>
<summary>Manual install (without the script)</summary>

```bash
# 1. App
npm install && npm run rebuild
npm run dist:mac
app="$(ls -dt dist/mac*/*.app | head -1)"
ditto "$app" "/Applications/$(basename "$app")"
xattr -dr com.apple.quarantine "/Applications/$(basename "$app")" 2>/dev/null || true

# 2. Zana MCP server + plugin
npm install -g @zana-ai/mcp@latest
claude mcp add zana -- npx -y @zana-ai/mcp
claude plugin marketplace add grebmann1/zana
claude plugin install zana@zana-marketplace
# Seed the global ~/.zana workspace (starter squads + profiles) — without this
# the in-app "Zana" tab is empty and its "New team" save fails:
zana init wizard "$HOME"
```

</details>

**Prerequisites:** Node 20+, `git`, and the [`claude`](https://claude.com/claude-code) CLI.

## Overview

Three-column layout: **sidebar** → **list pane** → **workspace** of tabbed terminals. Every tab is a real PTY running `claude` — genuine Claude Code sessions, not a wrapper.

Key surfaces:

- **Agents board** — all running sessions at a glance, grouped by status (needs you / working / idle / done).
- **Inbox** — agents push results, questions, and reports here. An AI Summary card digests recent activity.
- **Tickets** — per-project kanban + sprints + docs (reads from `.zana` store).
- **Goals / Follow-ups** — autonomous objectives and durable parked questions that survive agent restarts.
- **Chat** — talk to the app itself via a super-agent that spawns teams and runs agents.
- **Scheduler / Personas / Teams** — recurring tasks, agent profiles, and multi-agent compositions.

## Extensions

ZCC is extensible via `@zana-ai/zcc-extension-sdk` — add sidebar entries, project tabs, command-palette commands, main-process capabilities, and personas/teams without editing core. Extensions load from `~/.zcc/extensions/`, run in isolated `utilityProcess`es, and are permission-gated.

- **Docs:** [`docs/extensions.md`](docs/extensions.md) | [`docs/extensions-authoring.md`](docs/extensions-authoring.md)
- **Scaffold:** [`tools/create-zcc-extension`](tools/create-zcc-extension)

## CLI

`zcc` — a lightweight command-line companion that reads `~/.zcc/` stores and provides live control when the app is running. See [`docs/cli.md`](docs/cli.md).

## Stack

Electron 33 · electron-vite · React 18 + Zustand · xterm.js · node-pty · better-sqlite3. Optional **tmux** persistence for sessions that survive app restarts.

## Data

Persisted under `~/.zcc/`:
- `projects.json` — project registry
- `config.json` — app config (shell path, claude binary, font size)
