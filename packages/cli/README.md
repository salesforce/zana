# @zcc/cli

Command-line interface to Zana Command Center.

## Scope

`zcc` talks to the **running app** over the product HTTP API (`ZCC_SERVER_URL`,
default `http://127.0.0.1:8780`). `zcc guide` is the only fully offline command.

Prefer product nouns: `thread`, `machine`, `project`, `skill`, `settings`,
`terminal`, `environment`. `zcc run` and `zcc agent send` are deprecated aliases
of `thread spawn` and `thread tell`. `zcc term` aliases `terminal`.

Agent callers (`ZCC_SESSION_ID` set by the app) are read/inspect only. Mutations
return `FORBIDDEN_AGENT` (exit 5) except the host-stamped orchestrator spawn/close set.

## Installation

```bash
# From the monorepo root
pnpm install
pnpm --filter @zcc/cli build
```

## Usage

```bash
node packages/cli/dist/bin/zcc.js status --json
# or
export PATH="$PWD/packages/cli/dist/bin:$PATH"
zcc thread list --json
```

## Commands

```bash
zcc status --json
zcc thread spawn --project <id> --prompt "…" [--wait]
zcc thread list|show|tell|wait|stop
zcc machine list
zcc project list
zcc skill install-cli-skills
zcc guide [chapter]
zcc plugin new <name> [--app]
```

`--json` for anything parsed. If the app is down, live commands exit 1 with
`APP_NOT_RUNNING`.

## Configuration

| Variable / flag | Meaning |
| --- | --- |
| `ZCC_SERVER_URL` | Product HTTP base (default `http://127.0.0.1:8780`) |
| `ZCC_CENTER_DIR` / `--data-dir` | Data directory (default `~/.zcc`) — still used for inbox/followup/schedule file reads and the control-plane token |
| `ZCC_SESSION_ID` | Injected by the app inside agent terminals. Do not set by hand. |

## Testing

```bash
npm test
```

Keep the skill, guide chapters, and `--help` in lockstep
(`docs/cli-guide-and-skill.md`).
