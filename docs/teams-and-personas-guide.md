# Teams & Personas — Developer Guide

How to create, configure, and launch multi-agent teams in Zana (ZCC).

---

## Overview

ZCC's Teams system lets you define a bundle of named agent personas that launch together into a project. Each **Persona** is a reusable Claude Code flag bundle (model, permissions, system prompt, tools). A **Team** references multiple personas by id and opens one terminal tab per slot — optionally running autonomously toward a goal.

Key files:
- `packages/domain/src/product.ts` — shared Persona, Team, slot, and launch contracts
- `apps/server/src/services/agents/` — Persona and Squad discovery, validation, and routing
- `apps/server/src/services/execution/` — durable Squad execution, plan admission, and recovery
- `apps/desktop/src/squad-launch-core.ts` — host-side Squad launch assembly
- `apps/app/src/components/TeamComposer.tsx` — composer launch surface

---

## Persona

A Persona is a JSON file that declares how a Claude session should be configured:

```jsonc
// ~/.zcc/personas/my-persona.json
{
  "id": "my-persona",           // stable, url-safe slug
  "name": "My Persona",
  "icon": "Sparkles",           // Lucide icon name
  "description": "What this agent does",
  "baseProfile": "claude",      // "shell" | "claude" | "claude-resume" | "claude-yolo"
  "model": "opus",             // "opus" | "sonnet" | "haiku" | "default"
  "permissionMode": "plan",    // "default" | "acceptEdits" | "plan" | "bypassPermissions"
  "appendSystemPrompt": "Custom system instructions.",
  "allowedTools": ["Read", "Grep", "Glob"],
  "deniedTools": ["Write"],
  "addDirs": ["../other-repo"],
  "mcpServers": ["github"],     // optional MCP server allowlist; omit for no limit (see "MCP server allowlist")
  "initialPrompt": "Opening instruction typed on first turn."
}
```

### Discovery & Precedence

Personas are discovered and merged by id (later wins):

1. **Extension** — in-memory registrations from live extensions (`ext:<moduleId>:<slug>`)
2. **Builtin** — shipped with the app (`builtin:reviewer`, `builtin:software-engineer`, `builtin:orchestrator`)
3. **User** — `~/.zcc/personas/<id>.json`
4. **Project** — `<project-path>/.zcc/personas/<id>.json`

A user file with the same id as a builtin shadows it. Project personas win over all.

### Built-in Personas

| Id | Name | Model | Purpose |
|----|------|-------|---------|
| `builtin:reviewer` | Code Reviewer | high tier | Reviews diffs for correctness, edge cases, clarity |
| `builtin:software-engineer` | Software Engineer | medium tier | Generalist, ships features end to end |
| `builtin:orchestrator` | Orchestrator | medium tier | Coordinates work, delegates to workers |
| `builtin:squad-worker-low` | Squad Worker (Low) | low tier | Bounded, mechanical, read-heavy squad work |
| `builtin:squad-worker-medium` | Squad Worker (Medium) | medium tier | Normal engineering and synthesis squad work |
| `builtin:squad-worker-high` | Squad Worker (High) | high tier | Hard reasoning and final verification squad work |
| `builtin:architect` | Architect | high tier | Deprecated compatibility persona; use Squad Worker (High) for new squads |

### Validation

All persona files pass through `sanitizePersona()` (in `persona-store.ts`). A file is silently skipped if:
- `id` or `name` is missing/empty
- `baseProfile` is not one of the 4 valid values
- `model` is not `opus`/`sonnet`/`haiku`/`default`
- `permissionMode` is not one of the 4 valid values

### Flag Precedence at Launch

When a persona is launched, its flags slot into the middle of the existing chain:

```
base profile → AppConfig globals → ProjectSettings → PERSONA → per-tab extraArgs
```

Persona settings take priority over ProjectSettings. Per-tab Agent choices remain the final layer.

---

## Team

A Team bundles multiple personas into a single-click launch:

```jsonc
// ~/.zcc/teams/my-team.json
{
  "id": "my-team",
  "name": "Feature Squad",
  "icon": "Users",
  "description": "A team for building features",
  "orchestratorPersonaId": "builtin:orchestrator",
  "initialPrompt": "Lead the implementation of [feature]. Delegate to workers.",
  "defaultProjectId": "project-uuid-here",
  "slots": [
    { "personaId": "builtin:orchestrator", "quantity": 1 },
    { "personaId": "builtin:software-engineer", "quantity": 2 },
    { "personaId": "builtin:reviewer", "quantity": 1 }
  ]
}
```

### Team Schema

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Stable slug; `builtin:` prefix for shipped teams |
| `name` | string | Display name |
| `icon` | string? | Lucide icon name |
| `description` | string? | Human-readable purpose |
| `orchestratorPersonaId` | string? | Persona opened FIRST; receives `initialPrompt` |
| `slots` | TeamSlot[] | The worker agents to spawn |
| `defaultProjectId` | string? | Fallback project when none supplied at launch |
| `initialPrompt` | string? | Opening text for the orchestrator's tab |
| `worktreeIsolation` | boolean? | Shared-worktree override for Squad runs; absent follows the Project or global default |
| `worktreeOnComplete` | `"leave"` \| `"merge"` \| `"delete"`? | Disposition for a generated Squad worktree; default is `leave` |
| `routingEnforced` | boolean? | Require eligible routing where model-tier routing is available |
| `retainOrchestrator` | boolean? | Keep the coordinator session after successful completion |
| `defaultPlanning` | `"infer"` \| `"provided"`? | Planning mode preselected when the Squad is picked in the composer or proposed by an agent; absent uses the global default. Set it in Settings → Squads → Default planning |

### TeamSlot

| Field | Type | Description |
|-------|------|-------------|
| `personaId` | string | References a Persona id (any source) |
| `quantity` | number? | Tabs to open (default 1; clamped to 1–16) |
| `label` | string? | Optional tab label override |

### Discovery

Same pattern as personas: `builtin ⊕ ~/.zcc/teams/*.json ⊕ <project>/.zcc/teams/*.json ⊕ extension registrations`.

### Squad execution model

A durable Squad run is not the legacy tab-launch flow. Zana validates the Project
and plan, persists the execution in SQLite, starts its coordinator and workers,
and reconciles durable executions after app restart. Squad details retains the
plan, assignments, outputs, lifecycle state, and recovery record.

The separate `AutonomousRunSupervisor` nudge loop described below is in-memory.
Restarting ZCC ends that nudge loop; it does not erase durable Squad executions.

Launch settings resolve once at claim and stay frozen for that run. For every
shared launch option, precedence is explicit launch > plan `## Launch` > Squad >
default. Worktree isolation retains its host-derived Project/global fallback at
the default rung. The persisted snapshot records both effective value and source;
editing a Squad while a run is active does not change its disposition or push
permission.

Registered SSH remote Projects use their configured remote default path. They
support inferred and provided plans, including inline provided plans and locally
attached source capabilities, without local I/O against a remote-checkout
placeholder. Remote launches reject explicit targets, generated worktree
isolation, named checks, and push; they do not fall back to a local checkout.

---

## Autonomous Teams

An autonomous run drives a team toward a goal without manual intervention. A main-process supervisor monitors all agents and nudges idle ones to continue.

### Launching

```typescript
cc.teams.launchAutonomous(teamId, projectId, goal)
// Returns: { runId: string }
```

Or via the UI's Teams panel (when an autonomous launch action is available).

### How It Works

1. **Spawn** — orchestrator + workers open as tabs (same as `launch`)
2. **Supervise** — the `AutonomousRunSupervisor` watches agent status via the `onAgentStatus` edge
3. **Nudge idle agents** — when any agent sits idle for `autonomousNudgeDelaySeconds` (default 45s), a goal-aware message is typed into its terminal:
   - **Orchestrator** gets: "Keep delegating... When the goal is FULLY met, call `close_session_with_summary`."
   - **Workers** get: "Check your inbox with `agent_inbox` for the orchestrator's instructions and continue your part."
4. **Completion** — the orchestrator calls `complete_autonomous_run` (an MCP tool), recording a summary
5. **Teardown** — workers are closed, orchestrator tab stays open for review, inbox gets a run summary

### Stop Conditions

| Reason | Trigger |
|--------|---------|
| `goal-reached` | Orchestrator calls `complete_autonomous_run` |
| `max-rounds` | Total nudges exceed `autonomousMaxRounds` (default 30) |
| `timeout` | Wall-clock exceeds `autonomousTimeoutMs` (default 45 min) |
| `manual` | User clicks Stop |
| `orchestrator-gone` | Orchestrator's pty exits without declaring done |

### Configuration (AppConfig)

| Setting | Default | Description |
|---------|---------|-------------|
| `autonomousMaxRounds` | 30 | Max nudges before stopping (0 = no cap) |
| `autonomousTimeoutMs` | 2,700,000 (45m) | Wall-clock budget (0 = no timeout) |
| `autonomousNudgeDelaySeconds` | 45 | Idle seconds before nudging |

### Limits

- Max **8** concurrent autonomous runs (`MAX_CONCURRENT_RUNS`)
- Max **20** ended runs retained in memory (`MAX_RETAINED_ENDED_RUNS`)
- Run state is in-memory only — dies with the app

---

## Creating a Team for a Real Codebase

To build a team suited for feature development in your own project:

### 1. Define Specialized Personas

Create persona files under `~/.zcc/personas/`:

**app-architect.json** — plans the approach:
```json
{
  "id": "app-architect",
  "name": "App Architect",
  "icon": "Compass",
  "description": "Plans feature implementation for this codebase",
  "baseProfile": "claude",
  "model": "opus",
  "permissionMode": "plan",
  "addDirs": ["/path/to/your/repo"],
  "appendSystemPrompt": "You are an architect for this codebase. Plan implementations considering existing conventions, performance limits, and backward compatibility."
}
```

**app-engineer.json** — implements the code:
```json
{
  "id": "app-engineer",
  "name": "App Engineer",
  "icon": "Code2",
  "description": "Implements features following existing patterns",
  "baseProfile": "claude",
  "model": "sonnet",
  "addDirs": ["/path/to/your/repo"],
  "appendSystemPrompt": "You are an engineer on this codebase. Write code that follows existing patterns, passes tests, and meets project conventions."
}
```

**app-tester.json** — validates and tests:
```json
{
  "id": "app-tester",
  "name": "App Tester",
  "icon": "TestTube2",
  "description": "Writes and runs tests for new features",
  "baseProfile": "claude",
  "model": "sonnet",
  "addDirs": ["/path/to/your/repo"],
  "appendSystemPrompt": "You are a QA engineer for this codebase. Write tests, validate edge cases, and check for regressions."
}
```

### 2. Define the Team

Create `~/.zcc/teams/feature-squad.json`:

```json
{
  "id": "feature-squad",
  "name": "Feature Squad",
  "icon": "Users",
  "description": "Multi-agent team for developing features in this codebase",
  "orchestratorPersonaId": "builtin:orchestrator",
  "initialPrompt": "We are building a new feature. Research the codebase, plan the implementation, delegate coding to engineers and testing to the tester. Coordinate via agent_send.",
  "slots": [
    { "personaId": "builtin:orchestrator", "quantity": 1 },
    { "personaId": "app-architect", "quantity": 1 },
    { "personaId": "app-engineer", "quantity": 2 },
    { "personaId": "app-tester", "quantity": 1 }
  ]
}
```

### MCP server allowlist (`mcpServers`)

`mcpServers` is an exclusive allowlist of MCP servers, not a list of extras. It is a context filter, not a security boundary.

| Stored value | Meaning |
| --- | --- |
| Absent (field omitted) | No limit: every server the harness would normally load. |
| `[]` | Only `zcc-inbox`, which is always allowed. |
| `["a", "b"]` | Exactly `a` and `b`, plus `zcc-inbox`. |

Entries are server names. `name` matches a user, project, plugin or extension server with that name; `plugin:<id>:<name>` and `ext:<id>:<name>` pin one source. There are no globs and no `server:tool` selectors: this restricts servers only, and tool control stays with `allowedTools` and `deniedTools`. `alwaysOn` plugin servers are not exempt; a plugin server not named is dropped. Limits: at most 63 entries of at most 128 characters; invalid entries are dropped with a warning.

Behaviour change: before the allowlist, a stored list only added servers to the defaults. A persona that already stores `["zana"]` or `[]` now narrows to exactly those servers, and Zana posts a one-time notice at launch for such personas. Remove the field to allow all servers. A build that predates the allowlist treats the stored list as additive again.

Where it applies:

- **CLI Agents and Squads (Claude, Codex, OpenCode):** the harness is launched with only the allowlisted servers plus `zcc-inbox`. Claude builds a per-session MCP config from sanitised copies of the user and project definitions. Codex and OpenCode have no switch that disables every server, so unlisted user servers are disabled by name.
- **Modern threads and Modern Squads:** only the plugin servers that Zana injects are limited. The ACP protocol adds Zana's servers to the agent's own configuration and cannot exclude servers the agent configures itself, so those stay available. A launch notice states this limit. Automated Claude sessions on a Zana-generated config also filter the user-config servers.
- **Ignored:** harnesses that do not support MCP, and SSH sessions that cannot deliver MCP, ignore the allowlist. A launch notice says so; save and launch are never blocked.
- **Authentication stays with the harness.** The allowlist never delivers or changes credentials. When an allowlisted server's credentials are stripped from the sanitised config, or the server is missing, the launch shows a warning naming it.
- **Squad Requires:** a server in a plan's `requires.mcpServers` that a slot's persona allowlist excludes fails the launch check; an allowlisted server that is merely missing is an advisory warning only.

### 3. Skills Each Persona Should Use

Each persona's `allowedTools`/`deniedTools` control which tools it may call, and its optional `mcpServers` allowlist controls which MCP servers it can see (see below). Additionally, Claude Code skills (from `~/.claude/commands/` and plugins) are available to all agents in the session. Key skills to enable per role:

- **Orchestrator**: coordination skills (`zana:team`, agent messaging), planning skills
- **Architect**: code search, doc search, chat search for context
- **Engineer**: full Read/Write/Edit/Bash, code search, test runners
- **Tester**: Read/Write/Edit/Bash, test framework tools, validation tools

### 4. Testing

Autonomous teams test their work through:
- The tester persona writing and running tests
- Engineers verifying builds pass
- The orchestrator checking all agents' reports before declaring done

### 5. Launch

From the Teams panel in ZCC, click **Launch** on "Feature Squad". For autonomous mode, use:

```
cc.teams.launchAutonomous("feature-squad", projectId, "Implement [feature description]")
```

---

## Start a Squad from a conversation

You can design in a CLI Agent or Modern session and hand the result to a Squad
in the same Project.

1. **Say it.** In the session, say "build it with <Squad>". The agent uses the
   design (and a plan, if it has one) it wrote or read, wherever it keeps them,
   checks the plan, and prepares the launch.
2. **Open the Inbox card.** A "Squad launch ready" card appears in the Inbox. It
   names the Squad, the planning mode and the files. Nothing has started.
3. **Review.** Press **Review Squad launch**. The Squad composer opens already
   filled in: Squad, goal, planning mode and the attached files. Change anything
   you like. Press **Dismiss** to drop the proposal.
4. **Launch.** Press **Launch**. The files are captured at that moment, so later
   edits are not included.
5. **Report back.** When the Squad finishes or needs you, the session that
   proposed it gets a short `[Squad report]`. It can tell you what happened but
   cannot answer the Squad's questions, stop it or steer it; you stay the owner.
   Answers go through the Inbox.

**Review first or start now.** How you phrase it picks the path. "Build it with
X", "prepare a launch for X" or anything unclear gets the review-first card above.
Only an explicit "run it now with X", "start X immediately" or "skip the Inbox"
makes the agent start the Squad straight away (`squad_launch` with `mode: 'now'`), as the run's
owner. Either way the agent says in one line which path it took.

Agents launch Squads with the `squad_launch` tool (`mode: 'review'` or `'now'`);
`squad_propose` still works and equals review mode. `execution.start` remains
the low-level path (explicit slots, work units, policy) and is deprecated for
agent use.

**Launch approval.** The agent picks the mode from what you asked: `now` only
when you explicitly said to run it now, `review` otherwise. Each Squad (Squad
editor) and each Project (Project settings) also has a **Launch approval** setting. **Review before
launch** makes agents propose the run so you press Launch from the Inbox: `now`,
agent `execution.start` and agent `launch_team` are refused with
`LAUNCH_REVIEW_REQUIRED`. Review is a floor: if either the Squad or its Project
says Review before launch, the run needs review; a Squad set to launch directly
cannot lift its Project's review. Launching from the composer, schedules and
triggers is not affected.

These settings constrain the agent launch tools (`squad_launch`,
`execution.start`, `launch_team`). They are not a sandbox: an agent with shell
or local network access to the app can still reach the product HTTP API that
the desktop UI uses. Treat them as guardrails for cooperative agents, not as a
security boundary against a hostile one. Bounds: a repeat launch
within 10 minutes returns the same run, one launch is in flight per conversation,
and an agent owns at most 3 active runs.

An owner that starts the run with `notify: true` (the bundled skills do) gets the
same `[Squad report]` when its run finishes or needs a human answer, so it doesn't
have to poll; the reports follow it to a fresh session that takes the run over
with `execution.resume_binding` (Recover orchestrator relaunches the run's coordinator
and leaves the reports with the owner's session). It may answer
such a question itself with `execution.respond` when what you told it decides it;
otherwise it asks you, and the question is in your Inbox too. An owner gets no
"Squad completed" Inbox entry: the run is on its board, and if the owner's conversation is gone when the run ends, the report falls back to the Project Inbox. Without `notify: true`,
`execution.start` behaves as before.

Rules: the Squad always runs in the proposing session's Project. Its files can be
in that Project, your home folder (for example a doc vault or `~/.zcc/library`) or
the clone root. A file outside the Project shows its full path, marked "outside the
Project", on the card and in the composer, so you see what leaves the checkout
before Launch. Text that is not on disk is passed by value as `attachments: [{ name, text }]`
(shared budget with sources: 16 items, 4 MiB each, 16 MiB total; names are NFC-normalised,
clash case-insensitively, are deduplicated when identical and otherwise numbered "(n)";
the result maps `{ given, used, deduplicated? }`). In review mode attachments are kept as
private owner-only unencrypted copies under the Zana data folder until launched, dismissed
or expired (64 MiB total). The card says: "Attached content was captured when this launch
was prepared. Anything changed after that is not included, and the Squad will use only
the captured version." A file is attached either through the proposal's `sources` or by
name in the goal; a goal that names a file outside the Project is refused, and the
agent is told to pass it in `sources` so it shows on the card. Some locations are always refused, for proposals and for paths
named in any Squad goal:
- credential stores and agent sessions (`~/.ssh`, `~/.aws`, `~/.gnupg`,
  `~/.config/gh`, `~/.config/gcloud`, `~/.netrc`, `~/.docker/config.json`,
  `~/.codex`, `~/.cursor`, `~/.claude/sessions`, `~/.local/share/opencode`,
  `~/.pi`, `~/.grok`, `~/.gemini`, `~/.git-credentials`,
  `~/.npmrc`, `~/.pypirc`, `~/.kube`, `~/.claude.json`,
  `~/.claude/.credentials.json`, `~/.claude/projects`, `~/Library/Keychains`),
  even through a symlink (a link is followed step by step, so a link into one of
  these, or a link inside one of these, is refused; so is a loop of links); a
  hard-linked file is refused too. Inside the Project itself only `~/.ssh` and
  `~/.aws` stay refused from this list, so a Project that lives under, say,
  `~/.claude/projects` keeps its own files;
- the app's own data;
- Zana's data folders (`~/.zcc`, `~/.zcc-dev`, `~/.zcc-machines`, `~/.cc-center`, `ZCC_DATA_DIR`).
  Only their `library`, `personas`, `teams`, `templates` and `saved` folders and
  the checkouts Zana manages there can be read.

A clone root that is a disk root, contains your home folder, is world-writable on macOS or Linux (such as `/tmp`) or is `/Volumes` is not used, and a refusal names only the locations that are in use. Members of a running Squad cannot propose. Proposals expire
after 7 days. If the Squad's orchestrator cannot write files, "Infer plan from
goal" is refused; the agent proposes a plan it has written and checked instead
(`planning: "provided"`). Use `defaultPlanning` on the Squad to preselect a mode.

---

## Gotchas

- A persona id referenced in a team slot that doesn't resolve at launch time is **silently skipped** (not an error).
- The orchestrator's `initialPrompt` is delivered as a positional argv element to Claude — it runs as the first user turn.
- Autonomous runs are **in-memory only**: restarting ZCC kills all active runs.
- The 32-tab cap per team launch means a team with many high-quantity slots will be truncated.
- `baseProfile: "claude-yolo"` ignores `permissionMode` (it forces skip-permissions regardless).
- Extension-contributed teams/personas are in-memory and read-only — they vanish when the extension is disabled.

## Internal Comparison Guidance

For authors and agents comparing Squads with Claude Unleashed, read [Authoring Squad Comparisons](squad-comparison-authoring.md). It distinguishes intentional workflow style from missing capabilities and requires version-pinned external evidence.
