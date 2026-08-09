# Teams & Personas — Developer Guide

How to create, configure, and launch multi-agent teams in Zana Command Center (ZCC).

---

## Overview

ZCC's Teams system lets you define a bundle of named agent personas that launch together into a project. Each **Persona** is a reusable Claude Code flag bundle (model, permissions, system prompt, tools). A **Team** references multiple personas by id and opens one terminal tab per slot — optionally running autonomously toward a goal.

Key files:
- `src/shared/types.ts` — `Persona`, `Team`, `TeamSlot`, `AutonomousRun` interfaces
- `src/main/persona-store.ts` — discovery, validation, hot-reload for personas
- `src/main/team-store.ts` — discovery for teams (same pattern as persona-store)
- `src/main/autonomous-run-supervisor.ts` — drives autonomous runs toward a goal
- `src/renderer/components/TeamsPanel.tsx` — UI catalogue + launch action

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
  "mcpServers": ["zana"],       // extra MCP servers from the MCP registry
  "initialPrompt": "Opening instruction typed on first turn."
}
```

### Discovery & Precedence

Personas are discovered and merged by id (later wins):

1. **Extension** — in-memory registrations from live extensions (`ext:<moduleId>:<slug>`)
2. **Builtin** — shipped with the app (`builtin:reviewer`, `builtin:architect`, `builtin:software-engineer`, `builtin:orchestrator`)
3. **User** — `~/.zcc/personas/<id>.json`
4. **Project** — `<project-path>/.zcc/personas/<id>.json`

A user file with the same id as a builtin shadows it. Project personas win over all.

### Built-in Personas

| Id | Name | Model | Purpose |
|----|------|-------|---------|
| `builtin:reviewer` | Code Reviewer | opus | Reviews diffs for correctness, edge cases, clarity |
| `builtin:architect` | Architect | (default) | Systems design planner, proposes architectures |
| `builtin:software-engineer` | Software Engineer | sonnet | Generalist, ships features end to end |
| `builtin:orchestrator` | Orchestrator | opus | Coordinates work, delegates to workers |

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

### TeamSlot

| Field | Type | Description |
|-------|------|-------------|
| `personaId` | string | References a Persona id (any source) |
| `quantity` | number? | Tabs to open (default 1; clamped to 1–16) |
| `label` | string? | Optional tab label override |

### Discovery

Same pattern as personas: `builtin ⊕ ~/.zcc/teams/*.json ⊕ <project>/.zcc/teams/*.json ⊕ extension registrations`.

### Launch Behavior

When a team is launched (via UI or `cc.teams.launch(teamId, projectId)`):

1. The team is resolved from the store
2. The project is validated (from `defaultProjectId` or explicit arg)
3. The **orchestrator** tab opens first (with `initialPrompt` as its opening instruction)
4. Each **slot** opens `quantity` tabs for that persona (unknown persona ids are skipped)
5. Total tabs per launch are capped at **32** (Rule 5 — bound growing work)
6. Returns `{ launched: number, orchestratorSessionId, workerSessionIds }`

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
  "appendSystemPrompt": "You are an architect for this codebase. Plan implementations considering existing conventions, performance limits, and backward compatibility.",
  "mcpServers": ["zana"]
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
  "appendSystemPrompt": "You are an engineer on this codebase. Write code that follows existing patterns, passes tests, and meets project conventions.",
  "mcpServers": ["zana"]
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
  "appendSystemPrompt": "You are a QA engineer for this codebase. Write tests, validate edge cases, and check for regressions.",
  "mcpServers": ["zana"]
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

### 3. Skills Each Persona Should Use

Each persona's `mcpServers` and `allowedTools` determine what capabilities it has at runtime. Additionally, Claude Code skills (from `~/.claude/commands/` and plugins) are available to all agents in the session. Key skills to enable per role:

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

## Gotchas

- A persona id referenced in a team slot that doesn't resolve at launch time is **silently skipped** (not an error).
- The orchestrator's `initialPrompt` is delivered as a positional argv element to Claude — it runs as the first user turn.
- Autonomous runs are **in-memory only**: restarting ZCC kills all active runs.
- The 32-tab cap per team launch means a team with many high-quantity slots will be truncated.
- `baseProfile: "claude-yolo"` ignores `permissionMode` (it forces skip-permissions regardless).
- Extension-contributed teams/personas are in-memory and read-only — they vanish when the extension is disabled.
