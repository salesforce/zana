---
name: zcc-center
description: Author schedules, schedule templates, and personas for Zana by writing JSON files into .zcc. Use when the user asks to create, schedule, or automate a recurring agent/terminal task, to make a reusable schedule template, or to create/edit a persona (a reusable launch profile — role, model, system prompt, tools).
---

# zcc-center — schedule / template / persona file formats

> **Prefer the CLI.** `zcc schedule ls`, `zcc schedule run-now`, and
> `zcc schedule enable|disable` are the happy path for operating schedules.
> This skill is a **file-format appendix** for when you must author JSON on
> disk. Do not write JSON into `.zcc` as the default way to automate.

Zana (the desktop app this session is likely running
inside) runs **scheduled terminal sessions** on a recurring interval, offers
**reusable templates** that pre-fill the "new schedule" form, and lets you
launch agents as named **personas** (a role with its own model, permission
mode, system prompt, and tools). All three are plain JSON files on disk. This
skill teaches you their exact formats so you can author valid files the app
will pick up — schedules go live automatically (the app watches the
directories), templates and personas appear in their pickers live.

You are **writing JSON files**, not calling an API. Write them with the normal
file tools.

> Pushing a message to the user's inbox is a *different* feature — that's the
> `zcc-inbox` MCP tool (`inbox_push`), not this skill. Use this skill only for
> creating/editing **schedules** and **templates**.

---

## Where files go

| Kind | Scope | Directory | One file per |
| --- | --- | --- | --- |
| Schedule | Global (any project) | `~/.zcc/schedules/` | schedule, named `<id>.json` |
| Schedule | Per-project | `<project-root>/.zcc/schedules/` | schedule, named `<id>.json` |
| Template | Global | `~/.zcc/templates/` | template, named `<anything>.json` |
| Template | Per-project | `<project-root>/.zcc/templates/` | template |
| Persona | Global | `~/.zcc/personas/` | persona, named `<id>.json` |
| Persona | Per-project | `<project-root>/.zcc/personas/` | persona, named `<id>.json` |

- **`<id>` is the `id` field**, and the filename must match it for schedules
  (e.g. a schedule with `"id": "abc123"` lives at `…/schedules/abc123.json`).
- **Per-project** files live inside the repo, so they're git-trackable and
  travel with a clone. **Global** files are user-level in `$HOME`.
- The app **watches** these directories: a newly written schedule arms itself
  without an app restart; a new template appears in the picker live.
- Create the directory if it doesn't exist (`mkdir -p`).

### Picking scope

- If the task is specific to one repo → write to that repo's
  `.zcc/schedules/`. Prefer this; it keeps automation with the code.
- If it's cross-cutting / user-level → write to `~/.zcc/schedules/`.
- A schedule **must** name a real `projectId` regardless of where the file
  lives (see below) — scope only decides which directory holds the file.

---

## You need a real `projectId`

Every schedule spawns a terminal **inside a project**. `projectId` is a foreign
key into the app's project registry at `~/.zcc/projects.json`. A schedule
pointing at an unknown project is loaded but **skips every fire** (logged as
`skipped: project … not found`).

**Before writing a schedule, resolve the projectId:**

1. Read `~/.zcc/projects.json`. It's an array of
   `{ id, name, path, … }`. Match the project the user means by `name` or
   `path` and use its `id`.
2. If you're writing a *per-project* schedule, the enclosing repo's project is
   the one whose `path` is (or contains) the current working directory — match
   on `path`.
3. If no project matches, **stop and tell the user** they must add the project
   to the app first (the app's sidebar "+", or it's auto-added when they open
   a folder). Don't invent an id.

---

## Schedule JSON format

A complete, valid schedule. Fields marked **required** must be present and
well-formed or the file is silently skipped at load.

```json
{
  "id": "qa-hourly",
  "name": "Hourly QA sweep",
  "description": "Runs the test suite and type-checker every hour.",
  "enabled": true,
  "projectId": "PASTE-A-REAL-PROJECT-ID-FROM-projects.json",
  "profile": "claude-yolo",
  "extraArgs": [],
  "prompt": "Run the test suite and the type-checker. If anything fails, summarize the failure and the suspected root cause. If everything passes, reply 'all green'.",
  "schedule": { "every": "1h" },
  "overlap": "skip",
  "history": { "retain": 10 },
  "status": { "runCount": 0, "runs": [] },
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "inboxLevel": "quiet",
  "autoCloseOnFinish": false
}
```

### Field reference

| Field | Required | Rules |
| --- | --- | --- |
| `id` | ✅ | Non-empty string, unique across **all** schedules. Filename must equal `<id>.json`. Use a short kebab-case slug or a UUID. |
| `name` | ✅ | Non-empty display string. |
| `description` | — | Free text. |
| `enabled` | ✅ | Boolean. `false` = present but won't fire. |
| `projectId` | ✅ | Must match an `id` in `projects.json` (see above). |
| `profile` | ✅ | One of `"shell"`, `"claude"`, `"claude-resume"`, `"claude-yolo"`. |
| `extraArgs` | — | Array of strings, passed verbatim to the launched CLI. `[]` if none. |
| `prompt` | — | Initial prompt typed into the session. **Ignored for `shell`.** For claude profiles it's passed as the positional prompt arg. Multi-line is fine. |
| `schedule` | ✅ | Cadence object. Set **exactly one** of `every` (interval) or `cron` (wall-clock). See both syntaxes below. |
| `overlap` | ✅ | Must be `"skip"` (only mode supported; a fire is skipped if the previous run's session is still alive). |
| `history.retain` | ✅ | Number; how many past runs to keep in `status.runs`. Use `10`. |
| `status` | ✅ | For a brand-new schedule use exactly `{ "runCount": 0, "runs": [] }`. The app fills in `lastRunAt`, `nextRunAt`, etc. — **don't fabricate run history.** |
| `createdAt` | ✅ | ISO-8601 string. |
| `updatedAt` | ✅ | ISO-8601 string. |
| `inboxLevel` | — | One of `"silent"`, `"quiet"`, `"loud"`. Governs **all** inbox entries from a run — the run-completion summary AND any `inbox_push` the agent makes. `silent` = nothing recorded; `quiet` (default) = recorded in the collapsed "Scheduled" group, no unread badge; `loud` = surfaced inline and counted in the unread badge. Replaces the legacy boolean `notifyInbox` (`true`→`loud`, `false`→`quiet`), which is still read for backward compatibility. |
| `autoCloseOnFinish` | — | Boolean, **claude profiles only.** When `true`, a Stop hook closes the session once Claude finishes responding. Leave `false` if the agent should stay alive to receive a reply (these two are mutually exclusive in intent). |

### Profiles

- `shell` — plain shell session (`prompt` ignored). No "finished" signal, so
  `autoCloseOnFinish` does nothing.
- `claude` — interactive Claude Code with normal permission prompts.
- `claude-resume` — resumes the project's most recent Claude session.
- `claude-yolo` — Claude Code with `--dangerously-skip-permissions`. Use for
  unattended jobs that must not block on a permission prompt (QA, audits).
  **Only suggest this when the task is genuinely safe to run unattended.**

### Cadence: pick ONE of `every` or `cron`

`schedule` carries **exactly one** cadence. Setting both is rejected and the
file is skipped.

#### Interval syntax (`schedule.every`)

`<number><unit>` segments, concatenated. Units: `ms`, `s`, `m`, `h`, `d`.

- Examples: `"30m"`, `"1h"`, `"6h"`, `"24h"`, `"1h30m"`, `"300000ms"`.
- **Minimum 60 seconds** — anything shorter is clamped up to 60s.
- **Maximum 24 days** — anything longer is clamped down.
- Garbage (e.g. `"hourly"`, `"1 hour"`, `"weekly"`) is rejected and the whole
  file is skipped. Always emit a valid segment string.
- Fires roughly `every` after the last run — cadence drifts relative to
  wall-clock (a `"1h"` job lands at whatever minute the app happened to launch).
  Use `cron` when you need a specific time of day / day of week.

#### Cron syntax (`schedule.cron`, optional `schedule.tz`)

Standard **5-field** cron (`minute hour day-of-month month day-of-week`), for
wall-clock-aligned / calendar schedules the interval form can't express.

```json
"schedule": { "cron": "0 9 * * 1-5", "tz": "Europe/Paris" }
```

- Examples: `"0 9 * * 1-5"` (weekdays 09:00), `"0 8 1 * *"` (1st of month 08:00),
  `"*/15 * * * *"` (every 15 min, aligned), `"0 0 * * 0"` (Sundays midnight).
- `tz` is an optional IANA timezone (e.g. `"America/New_York"`); omit for host
  local time. DST is handled correctly.
- An unparseable or impossible expression (e.g. `"0 0 30 2 *"`) is rejected and
  the file is skipped.
- **In-process caveat:** the scheduler only fires while the app is running. A
  cron slot that falls while the app is closed is **caught up once** on next
  launch (not replayed per missed slot). For guaranteed firing regardless of the
  app being open, use the Zana daemon scheduler instead.

---

## Template JSON format

Templates **don't run.** They pre-fill the "new schedule" form so the user can
create a schedule with one click. A template needs no `projectId` (the user
picks the project when they instantiate it) — which makes templates the right
tool for **shareable starters**.

```json
{
  "id": "dependency-audit",
  "name": "Dependency audit",
  "description": "Weekly check for vulnerable or drifted dependencies.",
  "category": "Maintenance",
  "icon": "Package",
  "defaults": {
    "profile": "claude-yolo",
    "every": "24h",
    "name": "Dependency audit",
    "prompt": "Audit dependencies for known vulnerabilities and major version drift. Summarize findings and propose safe upgrades.",
    "extraArgs": []
  }
}
```

### Field reference

| Field | Required | Rules |
| --- | --- | --- |
| `id` | ✅ | Non-empty string. A template whose `id` matches a built-in **shadows** that built-in. |
| `name` | ✅ | Non-empty display string. |
| `description` | — | Free text shown in the picker. |
| `category` | — | Free-form grouping label (e.g. `"QA"`, `"Maintenance"`, `"Reports"`, `"Triage"`, `"Slack"`). |
| `icon` | — | A [lucide](https://lucide.dev) icon name (e.g. `"ShieldCheck"`, `"Package"`, `"Sun"`, `"Activity"`, `"Inbox"`, `"Clock"`, `"Sparkles"`). Unknown names fall back to a generic icon. |
| `defaults` | ✅ | Object. Must include a valid `profile` and a valid `every` (same rules as schedules). |
| `defaults.profile` | ✅ | Same profile enum as schedules. |
| `defaults.every` | ✅ | Same interval syntax as schedules. |
| `defaults.prompt` | — | Default prompt. |
| `defaults.extraArgs` | — | Default extra args. |
| `defaults.name` | — | Default schedule name when instantiated. |
| `defaults.description` | — | Default schedule description. |

Template filenames are free-form (`my-template.json`); only schedules require
the filename to match the `id`.

---

## Persona JSON format

A **persona** is a reusable launch profile — a named role the user (or a
schedule) can launch an agent as. It is **not** a new runtime: it compiles
entirely to flags the `claude` CLI already accepts (`--model`,
`--permission-mode`, `--append-system-prompt`, `--allowedTools`, …) layered on
top of a base profile. Personas appear in the "+" launcher's persona picker and
can be named by a schedule's `personaId` (a future field) or the
`zcc run … --persona <id>` CLI flag.

Like templates, a persona whose `id` matches a built-in **shadows** it. The
four built-ins (`builtin:reviewer`, `builtin:architect`,
`builtin:software-engineer`, `builtin:orchestrator`) live in code, not on disk —
drop a file with the same id to override one.

```json
{
  "id": "backend-engineer",
  "name": "Backend Engineer",
  "icon": "Server",
  "description": "Implements API + schema changes with tests.",
  "baseProfile": "claude",
  "model": "sonnet",
  "permissionMode": "acceptEdits",
  "appendSystemPrompt": "You are a backend engineer. Favor small vertical slices, validate at the boundary, and cover failure modes with tests.",
  "allowedTools": ["Read", "Grep", "Glob", "Edit", "Bash"],
  "deniedTools": [],
  "addDirs": [],
  "mcpServers": [],
  "initialPrompt": "What backend change do you want? I'll plan the slice and the tests."
}
```

### Field reference

| Field | Required | Rules |
| --- | --- | --- |
| `id` | ✅ | Non-empty string, unique across personas. **Filename must equal `<id>.json`.** Use a short kebab-case slug. Matching a `builtin:*` id shadows that built-in. |
| `name` | ✅ | Non-empty display string. |
| `icon` | — | A [lucide](https://lucide.dev) icon name (e.g. `"Server"`, `"ShieldCheck"`, `"Compass"`, `"Bot"`, `"Bug"`, `"Wrench"`, `"Layers"`). Unknown names fall back to the base-profile icon, then a generic bot. |
| `description` | — | One line shown in the catalogue and pickers. |
| `baseProfile` | — | Which of the four profiles to build on: `"claude"` (default), `"claude-resume"`, `"claude-yolo"`, `"shell"`. The persona's flags layer on top. |
| `model` | — | `"opus"`, `"sonnet"`, `"haiku"`, or `"default"` (let Claude decide) → `--model`. |
| `permissionMode` | — | `"default"`, `"acceptEdits"`, `"plan"`, or `"bypassPermissions"` → `--permission-mode`. **Ignored for `claude-yolo`** (it forces skip-permissions). |
| `appendSystemPrompt` | — | Appended to the system prompt → `--append-system-prompt`. This is where the role's behavior lives. Multi-line is fine. |
| `allowedTools` | — | Array of tool names → `--allowedTools` (merged + deduped with other layers). |
| `deniedTools` | — | Array of tool names → `--disallowedTools`. |
| `addDirs` | — | Array of extra context directories → `--add-dir`. |
| `mcpServers` | — | Array of MCP server names to wire into the session, resolved against the launcher's registry (the `zcc-inbox` server is always present). Unknown names are ignored. |
| `initialPrompt` | — | Opening prompt written to the session after spawn. **Claude-family only** — never written for `shell` (it would run as a shell command). For non-interactive scheduled runs it's delivered as the positional argv prompt. |

A persona maps **only** to flags `claude` already accepts — there's no bespoke
behavior beyond the system prompt + flag bundle. Files with invalid JSON, a
missing `id`/`name`, or a bad `baseProfile`/`model`/`permissionMode` enum are
**silently skipped** at load (same as schedules/templates).

> The user can also create and edit personas from the app's **Personas** panel
> (a form with the same fields). Writing the JSON file directly and using the
> form are equivalent — both land in `~/.zcc/personas/`.

---

## Squads (Teams) JSON format

A **squad** (internally called a **team**) is a named bundle of persona slots that launches multiple coordinated terminal tabs at once. When you launch a squad, it opens one tab per slot (multiplied by each slot's `quantity`), with the orchestrator tab opened first and given the team's initial prompt. Squads are useful for multi-agent workflows where you want to spin up a pre-configured team — e.g., an orchestrator + 2 engineers + a reviewer — in one click.

Like personas, a squad whose `id` matches a built-in **shadows** it. Built-in squads (e.g. `builtin:review-squad`) live in code — drop a file with the same id to override one.

```json
{
  "id": "feature-squad",
  "name": "Feature Squad",
  "icon": "Users",
  "description": "Orchestrator + 2 engineers + reviewer for end-to-end feature work.",
  "orchestratorPersonaId": "builtin:orchestrator",
  "slots": [
    { "personaId": "builtin:software-engineer", "quantity": 2, "label": "Engineer" },
    { "personaId": "builtin:reviewer", "quantity": 1, "label": "Reviewer" }
  ],
  "defaultProjectId": "PASTE-A-REAL-PROJECT-ID-FROM-projects.json",
  "initialPrompt": "You are the orchestrator for this feature squad. Break the goal into tasks, delegate to the engineer and reviewer tabs, and integrate their work."
}
```

### Field reference

| Field | Required | Rules |
| --- | --- | --- |
| `id` | ✅ | Non-empty string, unique across squads. **Filename must equal `<id>.json`.** Use a short kebab-case slug. Matching a `builtin:*` id shadows that built-in. |
| `name` | ✅ | Non-empty display string. |
| `icon` | — | A [lucide](https://lucide.dev) icon name (e.g. `"Users"`, `"Boxes"`, `"Globe"`, `"Shield"`). Unknown names fall back to a generic icon. |
| `description` | — | One line shown in the catalogue and pickers. |
| `orchestratorPersonaId` | — | Persona id for the orchestrator tab. If set, this tab is opened **first** and receives the `initialPrompt`. The orchestrator persona is **not** auto-added to `slots` — if you want it to appear there too (for the tab count), add it explicitly. |
| `slots` | ✅ | Array of slot objects. Each slot spawns `quantity` tabs using the persona named by `personaId`. Must be a non-empty array. |
| `slots[].personaId` | ✅ | Non-empty string referencing a persona `id` (builtin, user, or project). Persona **existence is checked at LAUNCH**, not at save — you can reference a persona that doesn't exist yet. |
| `slots[].quantity` | — | Number of tabs to open for this slot. Clamped to **1–16**. Defaults to 1 if omitted. |
| `slots[].label` | — | Optional display label for this slot (e.g. `"Engineer"`, `"Reviewer"`). Shown in the squad detail view. |
| `defaultProjectId` | — | Default project id to launch this squad in. If set, the launch picker pre-selects this project. Must match an `id` in `~/.zcc/projects.json` (but unlike schedules, it's optional — the user can pick any project at launch time). |
| `initialPrompt` | — | Opening prompt delivered to the **orchestrator tab** after spawn. Ignored if `orchestratorPersonaId` is not set. Multi-line is fine. |

### Where squad files go

| Scope | Directory | One file per |
| --- | --- | --- |
| Global (user-level) | `~/.zcc/teams/` | squad, named `<id>.json` |
| Per-project | `<project-root>/.zcc/teams/` | squad, named `<id>.json` |

- **Filename must match the `id` field** (same as schedules/personas).
- **Per-project** squads live in the repo and are git-trackable. **Global** squads are user-level in `$HOME/.zcc/teams/`.
- The app **watches** these directories: a newly written squad appears in the **Squads** panel (sidebar, above Extensions/Settings) without an app restart.
- Create the directory if it doesn't exist (`mkdir -p`).

### Validation rules

These are enforced by `sanitizeTeam` in `team-store.ts`:

- **`id` and `name` are required** and must be non-empty strings. Missing either → file is silently skipped.
- **`slots` must be a non-empty array.** Each slot is validated:
  - `personaId` must be a non-empty string. Slots with empty/missing `personaId` are **dropped**.
  - `quantity` is clamped to **1–16** (inclusive). Non-numeric or out-of-range values are clamped.
  - `label` (if present) must be a non-empty string, otherwise omitted.
- **Maximum 64 slots per squad** (defensive ceiling). Slots beyond the 64th are dropped.
- **Persona existence is checked at LAUNCH, not at save.** You can reference a persona id that doesn't exist yet — the slot will be skipped at launch if the persona still isn't resolvable then. This lets you author squads + personas in either order.
- **`defaultProjectId` is optional** and not validated at save. If set, it must match a real project at launch time or the squad won't launch.

### Worked example

A complete, valid squad that launches a 4-tab research + build team:

```json
{
  "id": "research-build-squad",
  "name": "Research & Build Squad",
  "icon": "Compass",
  "description": "Research-first workflow: 1 researcher, 1 architect, 2 implementers.",
  "orchestratorPersonaId": "builtin:orchestrator",
  "slots": [
    { "personaId": "builtin:orchestrator", "quantity": 1, "label": "Orchestrator" },
    { "personaId": "custom-researcher", "quantity": 1, "label": "Researcher" },
    { "personaId": "builtin:architect", "quantity": 1, "label": "Architect" },
    { "personaId": "builtin:software-engineer", "quantity": 2, "label": "Implementer" }
  ],
  "defaultProjectId": "a7f4e3c2-1234-5678-90ab-cdef12345678",
  "initialPrompt": "You are the orchestrator. First, have the researcher clarify the request and gather context. Then, hand off to the architect for a file-level plan. Finally, split the work across the two implementers and integrate their PRs."
}
```

Save this to `~/.zcc/teams/research-build-squad.json` (global) or `<project>/.zcc/teams/research-build-squad.json` (project-scoped). The squad appears in the app's **Squads** panel immediately.

### Creating and editing squads

You can author squads in **two ways**:

1. **Via the app UI:** Click **Squads** in the sidebar (above Extensions/Settings) → **New squad** button. Fill in the form: name, icon, description, orchestrator, slots (add rows with persona picker + quantity spinner). Saves to `~/.zcc/teams/<id>.json` automatically.
   
2. **By hand-editing JSON:** Write the JSON file directly into `~/.zcc/teams/` (user) or `<project>/.zcc/teams/` (project). The app picks it up via fs.watch immediately — no restart needed. Useful for:
   - Copying a squad template from a colleague or a gist.
   - Bulk-editing many squads with sed/jq.
   - Versioning project-scoped squads in git alongside the code.

Both methods are equivalent and write to the same location. The UI form is a convenience; the JSON file is the source of truth.

### Gotchas

- **Filename must match `id` for squads.** A mismatch means the app's delete/locate-by-id can't find the file (same as schedules/personas).
- **`slots` is required and must be non-empty.** An empty `slots` array is rejected; the file is silently skipped.
- **Quantity is clamped to 1–16.** Setting `"quantity": 100` opens 16 tabs, not 100 (defensive ceiling per slot). The total tab count = Σ(clamped quantity).
- **Persona IDs are not validated at save time.** A slot referencing `"nonexistent-persona"` is **legal on disk** — it just won't spawn a tab at launch. This is by design: you can write a squad before its personas exist (e.g., a project squad referencing project-local personas you haven't authored yet).
- **`defaultProjectId` is optional.** Unlike schedules (where `projectId` is mandatory), a squad can launch into any project the user picks at launch time. `defaultProjectId` just pre-selects one in the picker.
- Files with invalid JSON, a missing `id`/`name`, or a non-array `slots` are **silently skipped** at load (same as schedules/personas/templates).

---

## Workflow

When the user asks to schedule/automate something — or to create a role/persona:

1. **Decide what to write.** "Run X every hour in this repo" → a
   **schedule**. "Make a reusable preset for X" / "add a template" → a
   **template**. "Create a `<role>` persona" / "make an agent that acts like X"
   / "give me a reviewer/architect/QA agent" → a **persona**.
2. **For a schedule, resolve `projectId`** from `~/.zcc/projects.json`
   (see above). Bail out and ask if no project matches — never guess an id.
3. **Choose scope** (per-project repo dir vs. global) and ensure the directory
   exists.
4. **Write the JSON.** For schedules: filename = `<id>.json`,
   `status` = `{ "runCount": 0, "runs": [] }`, timestamps = now (ISO-8601),
   no fabricated run history.
5. **Pick a sensible interval and profile.** Default to `claude` unless the
   job is safe to run fully unattended (then `claude-yolo`). Default `every`
   to something conservative (`1h`+) unless the user specifies.
6. **Confirm what you wrote** — path, interval, profile, project — so the user
   can verify in the app. The schedule arms itself automatically; a template
   appears in the "From template" picker.

### Editing / disabling

- To **disable** a schedule without deleting it: set `"enabled": false` and
  bump `updatedAt`.
- To **delete**: remove the `<id>.json` file.
- To **change cadence**: edit `schedule` (set `every` OR `cron`+`tz`, not both)
  and bump `updatedAt`. Leave `status` untouched — the app recomputes the next
  fire on reload.

---

## Reporting what a run did (`schedule_report`)

When **you** are the agent running *inside* a scheduled session (not authoring
the schedule — actually executing one), leave a summary of what the run did so
the user can see the outcome in the scheduler's run history without re-reading
your terminal output.

Call the MCP tool **`schedule_report`** (server: `zcc-inbox`) at the **end** of
the run:

```
schedule_report({
  summary: "Ran the test suite (142 passed). Bumped lodash 4.17.20 → 4.17.21 to clear a prototype-pollution advisory; lockfile updated. No other drift.",
  status: "success"   // optional: 'success' | 'partial' | 'failure'
})
```

- `summary` is short **markdown** — what you checked, what you found or changed,
  and whether anything needs the user. It is a **report, not a log**: summarize,
  don't paste raw output.
- `status` is your own assessment, independent of the process exit code.
- The summary is attached to **this run** in the scheduler history (the app
  routes it by the session identity baked into the MCP URL — you can't report
  against another run). A 📄 affordance appears on the run row; clicking it
  shows your markdown.

**`schedule_report` vs `inbox_push`:**

| | `schedule_report` | `inbox_push` |
| --- | --- | --- |
| Purpose | Per-run record of what happened | Proactively flag something the user should act on |
| Cadence | **Every** scheduled run | Only when you need attention |
| Surfaces in | Scheduler run history | The inbox |

File a report on every scheduled run; push to the inbox only when warranted.

**Timing — important.** If the schedule has `autoCloseOnFinish: true`, the
session is **killed the moment you stop responding**. You MUST call
`schedule_report` **before** ending your turn — a report you intend to send
"after" will never go out. (You'll know this guidance applies because it's
injected into your system prompt for scheduled runs.)

---

## Gotchas

- **Filename must match `id` for schedules.** A mismatch means the app's
  delete/locate-by-id can't find the file.
- **Don't fabricate `status`.** A new schedule starts with
  `{ "runCount": 0, "runs": [] }`. Inventing `lastRunAt`/`runs` desyncs the UI.
- **`projectId` is mandatory and must exist.** This is the #1 reason a
  schedule looks present but never fires.
- **Intervals are strict.** `"every": "1 hour"` is invalid; use `"1h"`.
- **Pick ONE cadence.** Setting both `every` and `cron` on a `schedule` is
  rejected. Cron is 5-field; `"0 9 * * 1-5"` = weekdays at 09:00.
- **`shell` ignores `prompt`** and has no auto-close.
- Files with invalid JSON or a bad `profile`/`every` are **silently skipped**
  at load — if a schedule doesn't appear, re-check those first.
- **Personas: filename must match `id`** (`<id>.json`), same as schedules. A bad
  `baseProfile`/`model`/`permissionMode` enum silently skips the file.
- **`initialPrompt` is claude-only.** A `shell` persona's `initialPrompt` is
  dropped (it would run as a shell command).
