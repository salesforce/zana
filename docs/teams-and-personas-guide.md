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

All persona files pass through one shared rule set (`personaDropReason` in
`packages/domain/src/persona-validation.ts`), used by the server loader, the form
write path and `zcc personas ls`. A file is ignored when:
- it cannot be read, is not valid JSON, or its top level is not a JSON object
- `id` or `name` is missing or empty
- `baseProfile` is not one of the valid profiles
- `model` is present but not a string
- `permissionMode`, `codexSandbox`, `codexApproval`, `modelLevel` or `executionState` has an unknown value
- `harnessRouting` or `skills` is malformed

An unrecognised `reasoningLevel` does not drop a file on load (forward
compatibility); the persona form rejects it on save.

#### Persona files that fail to load

An ignored file is not silent. The server keeps a list of load warnings (file
basename, whether it came from the user or the Project, and a fixed reason; never
file contents; capped at 100) and **Settings > Personas** lists them. `zcc personas ls`
prints the same skipped files on stderr. A persona that is ignored is simply absent,
so any Squad slot that names it is unresolved (see below).

### Flag Precedence at Launch

When a persona is launched, its flags slot into the middle of the existing chain:

```
base profile → AppConfig globals → ProjectSettings → PERSONA → per-tab extraArgs
```

Persona settings take priority over ProjectSettings. Per-tab Agent choices remain the final layer.

This chain is the order command-line arguments are emitted, so for a repeated option the last one wins. It is not one order for every setting: provider, model, role and execution state resolve first-defined (Agent, Persona, Project, Global, native default), tools combine, and launch options and notifications have their own orders. The in-app order strips and help text are generated from `packages/domain/src/setting-precedence.ts`; change that table, not the prose.

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

#### Launch failures and warnings

**A slot that fails to start.** Each worker slot launches on its own: a spawn error
in one slot is recorded as a failed slot with a bounded, sanitized reason, and the
other slots still launch. What happens next depends on the planning mode.
- **Structured** (a complete portable plan): the run cannot finish with a missing
  worker, so it is FAILED at launch, the coordinator is not started, started workers are
  closed, and the slot reasons become the run's failure reason.
- **Freeform** (the coordinator infers the plan): the run continues. It records a run
  warning, and the coordinator's kickoff lists the failed slots (quoted, bounded data,
  not instructions) with a note not to assign work to them. A freeform run with no
  worker started, or with no orchestrator, still fails.

If a launch throws after workers started, those workers are closed by session id so no
live session is left behind.

**Unresolved personas.** A slot whose persona id does not resolve (missing file, or a
file ignored for the reasons above) is reported as `unknown persona: <id>`. The Squad
editor warns about it at save time and the Squad list shows a badge. At launch the slot
is skipped and reported as a failed slot as above. A structured launch on the default
(CLI) transport whose every worker slot is unresolved is refused before anything opens.
Modern Squads do not apply that refusal.

**Unknown model.** A persona whose legacy `model` string is not in the harness's static
model catalog gets an advisory notice at save (Squad editor) and at launch (an Inbox
notice, "Persona model not recognised"). It never blocks a launch. When the harness
accepts unlisted models or discovers them live, no notice is raised.

**Previewing a plan from the CLI.** `zcc team launch --plan-file <path> --dry-run`
validates the plan and prints the resolved launch without starting anything. An
unparseable plan returns its error (for example "no portable plan steps found") and a
non-zero exit. See [`team launch`](cli.md#team-launchstatuswaitanswerstop).

#### Failure reasons

Every run that ends FAILED keeps a persisted failure reason (control characters
removed, absolute paths reduced to file names, at most 2048 characters). It appears in
`zcc team status` and `zcc team wait`, the Inbox terminal report and the run detail.

#### Worker exits, retained cards and respawn

- **Exit warning.** A worker that exits non-zero (or by signal) raises a run warning
  with the exit code or signal and reason, and one Inbox row (deduped per run, slot and
  kind). A clean exit and idle on-demand seats never warn.
- **No-turn warning.** A worker that was assigned work but reports no turn and produces
  no output within the window (the run's claim stall limit, 10 minutes by default) raises
  one warning per claim.
- **Retained cards.** A Squad worker card that exited non-zero stays on the Agents board
  until you press **Dismiss** on it (a clean exit follows the normal fade). Dismissal is
  remembered.
- **Coordinator respawn.** When a worker's session is over and its unit still needs it,
  the coordinator can call `execution.worker.respawn` with the worker's `slotId`. Only
  the run's orchestrator can call it; the run and slot come from the host's binding, not
  from arguments. The slot restarts from its launch-time snapshot (role, persona and
  permissions as launched, not as the persona file reads now) as a new conversation.
  Each slot may be respawned twice per run; the count survives app restarts. It is
  refused while the worker is still running, for the coordinator slot, for a run that is
  not RUNNING or is stopping, and for remote Projects. A refusal, a cap
  hit or a spawn failure returns a reason and raises a run warning. Respawn is never
  automatic, so a crash loop stays visible. A `QUEUED` answer means the worker is waiting
  for machine capacity: do not call again.
- **Card Restart.** **Restart** on a Squad worker card puts the worker back in its Squad
  (same slot, run and cohort) through the same respawn path, without the two-per-slot
  cap, because a person asked. It is refused when the run has finished or is stopping.
  A card for a non-Squad session keeps the ordinary restart.
- **No live worker.** A run left with no live worker is BLOCKED and cannot be respawned: Stop it (one Stop is enough) and relaunch.

#### Stop, Dismiss and Cancel

Stop and Dismiss verify the teardown instead of assuming it. After asking the run's
sessions to close, Zana waits a short, bounded time for sessions that are still closing.
If any survive, the call fails with `CANCEL_INCOMPLETE` and lists the sessions: the run
is not marked stopped or hidden, so you can retry once they are gone. A FAILED run is
cancelled once by whoever recorded the failure, so no worker is left running behind a
failed run. Plan-correction **Cancel** saves the card as cancelled only after a verified
stop.

#### Parallelism

The coordinator prompt tells coordinators to give independent units disjoint, narrow
`files` scopes (specific files or small directories). Units with overlapping scopes run
one at a time, so broad or missing scopes serialise a run. Mutating units need a
non-empty `files` scope before a durable plan registers.

#### Run limits

A Squad can set three optional limits in the Squad editor. Leave a field blank to keep
the default.

| Limit | Allowed range | Default |
| --- | --- | --- |
| Max sessions (`maxConcurrent`) | 1 to 32 | 32 sessions |
| Claim wall-clock (minutes) | 1 minute to 24 hours | 20 minutes |
| Claim stall (minutes) | 1 minute to 24 hours | 10 minutes |

Main validates the limits on every save: invalid values are dropped and out-of-range
values are clamped. The limits apply to runs started with **Launch** for that Squad. The
run detail shows the effective values in a **Run limits** line. The claim stall limit also
sets how long a claimed worker can show no turn before the no-turn warning fires.

**Max sessions** is a launch cap, not a throttle. It counts the coordinator plus every
worker. A roster larger than the cap is refused at launch, and the limit does not queue
workers or reduce how many are busy at once. To run fewer workers, define a Squad with
fewer worker slots. Claim limits (wall-clock and stall) apply to every claimed unit.

#### Launching from Settings

**Settings > Squads > Launch** opens the New Agent dialog on the Squad composer with that
Squad (and the Project, when one is chosen) pre-selected, so the launch has a goal, the
usual preflight and a tracked run. It no longer opens bare member tabs. Squad export and
import are unchanged.

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

- A persona id referenced in a team slot that doesn't resolve at launch time is skipped and reported as a failed slot (`unknown persona: <id>`). In a structured run that fails the launch; in a freeform run the coordinator is told. The Squad editor and list warn about it beforehand. See [Launch failures and warnings](#launch-failures-and-warnings).
- The orchestrator's `initialPrompt` is delivered as a positional argv element to Claude — it runs as the first user turn.
- Autonomous runs are **in-memory only**: restarting ZCC kills all active runs.
- The 32-tab cap per team launch means a team with many high-quantity slots will be truncated.
- `baseProfile: "claude-yolo"` ignores `permissionMode` (it forces skip-permissions regardless).
- Extension-contributed teams/personas are in-memory and read-only — they vanish when the extension is disabled.

## Internal Comparison Guidance

For authors and agents comparing Squads with Claude Unleashed, read [Authoring Squad Comparisons](squad-comparison-authoring.md). It distinguishes intentional workflow style from missing capabilities and requires version-pinned external evidence.
