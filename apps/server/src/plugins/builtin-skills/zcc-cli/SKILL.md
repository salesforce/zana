---
name: zcc-cli
description: Drive Zana from the terminal with the `zcc` CLI — status, threads, machines, projects, skills, settings, terminals. Use when you want to inspect or act on the running app from a shell instead of the desktop UI.
---

# zcc-cli — drive Zana from the terminal

`zcc` talks to the **running app** over the product HTTP API (`ZCC_SERVER_URL`,
default `http://127.0.0.1:8780`). You are invoking a binary, not writing JSON
into `.zcc` and not calling MCP.

Start here:

```bash
zcc status --json
zcc thread list --json
```

Use `--json` whenever output will be parsed. `zcc --help` is the flag surface;
`zcc guide [chapter]` is the long-form companion (offline). This skill is the
operational playbook.

> Writing a **plugin** is `zcc-plugin-authoring`. After install, contributed
> verbs appear in the generated `plugin-commands` skill and run as `zcc <name>`
> (or `zcc plugin run <id> …`). Core names always win. Combined plugin stdout
> is capped at 1MiB.
>
> Operating **schedules** from the shell is `zcc schedule ls|run-now|enable|disable`.
> Do not author JSON into `~/.zcc/schedules` as the happy path (`zcc-center` is
> a file-format appendix only).
>
> Project tasks live in the **tasks** plugin skill (`zcc tasks list|add|done`).

---

## Finding the binary

```bash
zcc status
# or, from a repo checkout:
node packages/cli/dist/bin/zcc.js status
```

If `node …/zcc.js` errors with "Cannot find module", build first:
`cd packages/cli && npm run build`.

---

## The app must be running

Live commands need the desktop app (its local server). If it is down, `zcc`
exits **1** with **APP_NOT_RUNNING**: `Error: Zana Command Center is not running …`.
Ask the user to open the app. The only fully offline command is `zcc guide`.

Override the base URL with `ZCC_SERVER_URL` when the server is not on 8780.

---

## CRITICAL: the agent gate

When `zcc` runs **inside a Zana agent terminal**, the app has injected
`ZCC_SESSION_ID`. Mutating live ops then return **FORBIDDEN_AGENT** (exit **5**).

**Allowed:** `status`, list/show/log/wait, file reads (`inbox`, `followup`,
`schedule ls`, `personas ls`), `guide`, and plugin verbs that are themselves
read-only.

**Refused:** `thread spawn` / `run`, `thread tell` / `agent send`, `thread stop`,
`terminal create|send|close`, `machine rename|remove`, `settings` writes,
`schedule run-now|enable|disable`, unless you are the **host-stamped orchestrator**
(the app's own spawn/close set). Do not set `ZCC_SESSION_ID` by hand.

See `references/agent-gate.md`.

---

## Threads

The agent surface. Prefer these over the deprecated `zcc run` / `zcc agent send`
aliases (aliases print a one-line warning on stderr).

```bash
zcc thread list [--project <id>] [--json]
zcc thread spawn --project <id> --prompt "…" [--provider <id>] [--wait] [--timeout 5m]
zcc thread show <id>
zcc thread log <id>
zcc thread tell <id> "…"
zcc thread wait <id> [--timeout 20m]
zcc thread stop <id>
zcc thread fork|archive|unarchive <id>
zcc thread open <id> [--file PATH] [--source workspace|thread-storage] [--line N]
zcc thread interactions <id>
```

`zcc run <project> <prompt>` → `thread spawn`. `zcc agent send <id> <msg>` → `thread tell`.

Give spawned threads a clear objective, constraints, deliverable, and what to
report back. Use `--` before a prompt that contains flag-like tokens:

```bash
zcc thread spawn --project my-proj -- --wait is literal prompt text
```

---

## Machines, projects, skills, settings, terminals

```bash
zcc machine list
zcc machine show <id>
zcc machine join-code
zcc machine rename <id> <name>
zcc machine remove <id>
zcc machine provider-cli status|install <id> [provider]

zcc project list
zcc project show <id>
zcc project create --path <absolute-path> [--host <id>]
zcc project files <id> [--query <text>]
zcc project content <id> <path>
zcc project skills <id>
zcc projects ls                 # alias of project list

zcc skill list
zcc skill show <id>
zcc skill files <id>
zcc skill cli-skills-status [--machine <id>]
zcc skill install-cli-skills [--machine <id>]

zcc settings show
zcc settings general|experiment|appearance <key> <value>

zcc terminal list [--project <id>]
zcc terminal create --project <id> [--title …] [--command …]
zcc terminal send <id> --text "…"
zcc terminal close <id>
zcc term                        # deprecated alias of terminal
```

`install-cli-skills` copies this playbook onto each machine's `~/.claude/skills`
and `~/.agents/skills` so agents *outside* ZCC can drive the CLI.

---

## Environment, inbox, follow-ups, schedules

```bash
zcc environment status|diff|diff-files|pull-request <id>

zcc inbox ls [--project ID] [--json]
zcc inbox show <id>
zcc followup ls [--project ID] [--status open|resolved|dismissed] [--all]
zcc schedule ls
zcc schedule run-now <id>
zcc schedule enable|disable <id>
zcc personas ls
zcc agent ls
zcc team ls
```

Inbox mutations for agents are MCP (`inbox_push` / `inbox_search`) via the
`zcc-inbox` skill, not this CLI.

---

## Plugins and marketplace

```bash
zcc plugin new <name> [--app]
zcc plugin install <source>
zcc plugin list|dev|reload|logs|run …
zcc marketplace ls|add|refresh|remove|install
```

Core command names always win over a plugin verb. `zcc <name>` and
`zcc plugin run <id>` are equivalent for a contributed command.

---

## Guide chapters

`zcc guide` (and `zcc guide threads`, `projects`, `machines`, `terminals`,
`plugins`, `automations`, `agent-configuration`, `environments`) works with no
app. Keep this skill, the matching chapter, and the command implementation in
sync — see `docs/cli-guide-and-skill.md`.

---

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | error / app not running |
| 2 | bad usage |
| 3 | not found / ambiguous |
| 4 | resource limit |
| 5 | FORBIDDEN_AGENT |
| 124 | `--wait` timeout |

---

## Don't

- Don't parse human tables — pass `--json`.
- Don't write schedules/personas as JSON to "make the CLI work"; use `zcc schedule` / the UI.
- Don't set `ZCC_SESSION_ID` yourself.
- Don't treat `zcc run` / `zcc agent send` / `zcc term` as the documented names.
- Don't invent verbs. If the user needs a new capability, use `zcc-plugin-authoring`.
- Don't use `extension-creator` unless you are already inside an in-app local plugin working dir.
