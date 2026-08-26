---
name: zcc-cli
description: Drive and inspect Zana Command Center from the terminal with the `zcc` CLI — list projects/agents/schedules/inbox, read live status, spawn agents in a project, send messages, and manage sessions/schedules. Use when you want to see what the app knows or make it do something from a shell, instead of clicking the desktop UI.
---

# zcc-cli — drive Zana Command Center from the terminal

`zcc` is the command-line interface to **Zana Command Center** (the desktop app
this session is likely running inside). It does two jobs:

- **Reads the same on-disk stores the app uses** (`~/.zcc/*.json`) — these work
  whether the app is open or closed.
- **Issues live actions** to the running app over a local control socket —
  spawning agents, sending messages, closing sessions, firing schedules. These
  only work while the app is open.

You are **invoking a binary**, not calling an API or writing files. Use the
normal shell tools (Bash).

> Authoring **schedules** and **templates** (writing JSON into `.zcc`) is a
> *different* skill — `zcc-center`. This skill is for *driving* the app.
>
> Writing a **plugin** (panel, `zcc <verb>`, skills) is another skill —
> `zcc-plugin-authoring`. Use that when the user asks to add a capability ZCC
> does not have yet. After install, contributed commands appear in the generated
> `plugin-commands` skill and run as `zcc <name>` (or `zcc plugin run <id> …`).

---

## Finding & invoking the binary

Two equivalent ways, in order of preference:

```bash
# 1. If `zcc` is on PATH (installed / symlinked), just call it:
zcc status

# 2. Otherwise run the built bundle directly with node, from the repo root:
node packages/cli/dist/bin/zcc.js status
```

If `node packages/cli/dist/bin/zcc.js` errors with "Cannot find module", the CLI
hasn't been built — `cd packages/cli && npm run build`, then retry. Throughout
this doc `zcc <…>` means "either form."

`zcc --help` prints the full command surface; `zcc --version` prints the
version. No command (or `--help`/`-h`) prints help and exits 0.

---

## Two tiers: reads vs. live

| Tier | Backed by | Works when app is… | Commands |
| --- | --- | --- | --- |
| **Read** | On-disk JSON stores (`~/.zcc/`) | **open or closed** | `projects ls`, `personas ls`, `schedule ls`, `inbox ls`, `inbox show`, `followup ls` |
| **Live** | Control socket + token in the data dir | **open only** | `status`, `agent ls`, `agent send`, `term ls`, `term close`, `term close-summary`, `run`, `schedule run-now`, `schedule enable`/`disable` |

- **Read-tier** commands never need the app. They parse the same files the app
  writes, degrade gracefully on malformed input (warnings to stderr, exit 0),
  and never throw.
- **Live-tier** commands talk to the app's control plane at
  `~/.zcc/control.sock` (authed by `~/.zcc/control.token`). If the app isn't
  running there's no socket, so the command fails with **`APP_NOT_RUNNING`**
  and **exit 1**: `Error: Zana Command Center is not running …`. If you hit
  that, ask the user to open the app, or fall back to a read-tier command.

> `status` is live-tier even though it reads like a dashboard — it queries the
> running app for live agent/schedule state. With the app closed it exits 1.

---

## CRITICAL: the agent gate (read this if you are a Zana agent)

When the CLI runs **inside a Zana agent terminal**, the app has injected the
`ZCC_SESSION_ID` env var into that pty. The CLI forwards it to the control
plane, which classifies you as an **AGENT caller** and enforces a **read-only
allow-list**. Any *mutating* live op is refused with **`FORBIDDEN_AGENT`** and
**exit 5**.

**As an agent you ARE allowed** (your primary, supported use of `zcc`):

| Command | Why it's allowed |
| --- | --- |
| `zcc status` | inspect live dashboard |
| `zcc projects ls` | list projects (file read) |
| `zcc personas ls` | list personas (file read) |
| `zcc schedule ls` | list schedules (file read) |
| `zcc inbox ls` / `zcc inbox show <id>` | read the inbox (file read) |
| `zcc followup ls` | list parked follow-ups (file read) |
| `zcc agent ls` | list live agents |
| `zcc term ls` | list live sessions |

**As an agent you are REFUSED** (these return `FORBIDDEN_AGENT`, exit 5):

- `zcc run …` (spawn an agent)
- `zcc agent send …` (message an agent)
- `zcc term close …`, `zcc term close-summary …`
- `zcc schedule run-now …`, `zcc schedule enable/disable …`

This gate is **enforced in the app (main), not in the CLI** — it is the trust
boundary, by design. **Do not try to bypass it** by unsetting `ZCC_SESSION_ID`,
spoofing a token, or shelling around it. Treat the refusal as final: report to
the user that the action needs a human operator. An unbound shell can request a
mutation, but main still requires native human confirmation before dispatch. Frame your role as
**observing** the command center — listing and reading — not steering it.

A human-operator shell can request every command below; mutations prompt for
one-time approval in the app.

### The orchestrator exception (fleet drivers only)

One agent class is the exception: a session **the app launched as a team
orchestrator** (the lead tab of a `zana team` / team launch). Main host-stamps
that session — it is **not** something an agent can self-declare — and promotes
it to a bounded surface on top of the read commands:

| Command | Why an orchestrator may run it |
| --- | --- |
| `zcc run <project> …` | open an agent on a project (spawn a worker into the fleet) |
| `zcc term close <sessionId>` | close one worker session (clean up) |
| `zcc term close-summary <projectId> <sids…>` | summarize then close a batch |

An orchestrator is **still refused** `agent send`, `term reply`,
`schedule run-now`, and `schedule enable/disable` (exit 5) — it coordinates
peers through the **MCP mesh** (`agent_send` / `zana_*`), not the CLI, and never
touches schedules. Every `run` it issues is realpath-confined to a registered
project exactly like an operator's. If you are an ordinary (non-orchestrator)
agent, none of this applies — you stay read-only.

---

## Command reference

`tier` = read / live. `agent?` = allowed when called from inside a Zana agent
terminal (✅) or refused there (❌).

| Command | Tier | agent? | What it does |
| --- | --- | --- | --- |
| `status` | live | ✅ | Live dashboard: project count, live agents, enabled schedules. |
| `projects ls` | read | ✅ | List registered projects (id, name, tag, path). |
| `personas ls` | read | ✅ | List file-backed personas (builtins aren't listed). |
| `schedule ls` | read | ✅ | List scheduled tasks (id, name, enabled, every, project, last result). |
| `inbox ls [--project <id\|tag>]` | read | ✅ | List up to 20 recent inbox entries; optional project filter. |
| `inbox show <id>` | read | ✅ | Show one inbox entry in full (accepts a unique id prefix). |
| `followup ls [--project <id\|tag>] [--status <s>] [--all]` | read | ✅ | List follow-ups (parked questions/decisions). Open-only by default; `--status open\|resolved\|dismissed` pins a state, `--all` shows every state. |
| `agent ls` | live | ✅ | List live agents + their state/role/session. |
| `term ls [--project <id>]` | live | ✅ | List live terminal sessions. |
| `run <project> <prompt…>` | live | ❌ | Spawn a claude agent in a project. Flags below. |
| `agent send <handle> <msg…>` | live | ❌ | Send a message to a live agent by handle. |
| `term close <sessionId>` | live | ❌ | Close one live session. |
| `term close-summary <projectId> <sid…> [--no-summary]` | live | ❌ | Summarize the sessions' work to the inbox, then close them. |
| `schedule run-now <id>` | live | ❌ | Fire a schedule once, now. |
| `schedule enable <id>` / `schedule disable <id>` | live | ❌ | Toggle a schedule's `enabled` flag. |

### `run` flags

`zcc run <project> <prompt…> [--persona <id>] [--profile <p>] [--wait | --detach] [--timeout <dur>]`

- `<project>` resolves by exact id → tag → name → unique name-prefix
  (case-insensitive). An ambiguous prefix exits **3** and lists candidates.
- `--persona <id>` — launch with a saved persona; `--profile <p>` — base profile
  (default `claude`).
- `--detach` (default) — print the new session id and return immediately.
- `--wait` — poll until the agent goes idle/done, then print `<sid> <state>`.
  Mutually exclusive with `--detach` (both → exit 2).
- `--timeout <dur>` — bound for `--wait`, e.g. `30s`, `5m`, `2h` (default `5m`).
  On timeout the session is **left running** and the command exits **124**.

---

## Worked examples

```bash
# Read tier — always works:
zcc projects ls
zcc schedule ls
zcc inbox ls --project my-proj
zcc inbox show 3f2a            # unique id prefix is fine
zcc followup ls               # open parked questions/decisions
zcc followup ls --all --project my-proj   # every state, one project

# Live tier (app must be open):
zcc status
zcc agent ls
zcc term ls --project my-proj

# Operator-only (refused for agents with exit 5):
zcc run my-proj "review the diff in src/auth" --persona reviewer --wait
zcc agent send reviewer "PR #214 is ready"
zcc term close-summary my-proj sess-abc sess-def
zcc schedule run-now nightly-review
```

### Machine parsing with `--json`

Add `--json` to **any** command for machine-readable output (full objects, not
the truncated human table). Always prefer `--json` when you're going to parse
the result.

```bash
# Get the full project list as JSON, pull out ids:
zcc projects ls --json | jq -r '.[].id'

# Resolve the session id of a freshly spawned agent (operator shell):
SID=$(zcc run my-proj "run the tests" --json | jq -r '.sessionId')

# Branch on the live dashboard:
zcc status --json | jq '.agents | length'
```

`--json` may appear anywhere in the head of the command — **except** after a
`--` prompt sentinel (see below), where it's literal prompt text.

---

## The `--` sentinel for `run` prompts

If a `run` prompt contains flag-like tokens (anything starting with `--`), put a
bare `--` before the prompt. Everything after `--` is taken **verbatim** as the
prompt and is never parsed as a flag:

```bash
# WRONG — --wait is parsed as a run flag, not prompt text:
zcc run my-proj review the --wait handler

# RIGHT — everything after `--` is literal prompt:
zcc run my-proj -- review the --wait handler
zcc run my-proj -- explain why the build emits --json output
```

---

## Exit codes

Branch on these — they're stable and documented:

| Code | Meaning | Typical cause |
| --- | --- | --- |
| `0` | Success | — |
| `1` | Generic error | App not running (`APP_NOT_RUNNING`), unauthorized, transport error |
| `2` | Bad usage | Missing/invalid args, `--wait`+`--detach`, bad `--timeout`, value-less `--data-dir` |
| `3` | Not found / ambiguous | Project/entry not found, or an ambiguous project prefix |
| `4` | Resource limit | Live cap hit (e.g. the pty ceiling) |
| `5` | Refused by guard | **`FORBIDDEN_AGENT`** — an agent caller tried a mutating op |
| `124` | `--wait` timeout | The agent didn't finish before `--timeout`; session left running |

---

## Configuration

- **Data dir** defaults to `~/.zcc` (falls back to a legacy `~/.cc-center` if
  `~/.zcc` doesn't exist yet). Override with `--data-dir <path>` (highest
  precedence) or the `ZCC_CENTER_DIR` env var.
- A value-less `--data-dir` (trailing, or followed by another `--flag`) is a
  usage error (exit 2), not a silent fallback.

---

## Gotchas

- **Mutating ops fail for agents by design.** If you're inside a Zana agent
  terminal, `run` / `agent send` / `term close[-summary]` /
  `schedule run-now`/`enable`/`disable` all return `FORBIDDEN_AGENT` (exit 5).
  This is the trust boundary — don't fight it; surface it to the user. Your
  supported surface is the read/inspect commands.
- **Live commands need the app open.** `status`, `agent ls`, `term ls`, `run`,
  and the schedule-toggle ops fail with `APP_NOT_RUNNING` (exit 1) when the app
  is closed. Read-tier commands (`projects/personas/schedule ls`, `inbox …`)
  still work — prefer them when the app may be down.
- **`status` is live, not a file read.** It needs the running app despite
  looking like a static dashboard.
- **Put `--data-dir` (and `--json`) BEFORE the `--` prompt tail.** Global flags
  after a `run … --` sentinel are swallowed as literal prompt text *and* — for
  `--data-dir`/`--json` specifically — a token like `--json` placed *after* the
  `--` can still flip global behavior because the global-flag scan runs before
  the sentinel split. Keep global flags ahead of the project arg; keep the
  prompt (and only the prompt) after `--`.
- **Project refs are fuzzy.** `run`/`inbox --project` accept id, tag, name, or a
  unique name-prefix. An ambiguous prefix exits 3 and lists candidates — use a
  longer ref or the exact id.
- **`--wait` leaves the session alive on timeout** (exit 124). The agent keeps
  running; re-check with `zcc agent ls` / `zcc term ls`.
- **Use `--json` for anything you parse.** The default human tables truncate
  ids (8 chars) and previews; `--json` returns the full records.
