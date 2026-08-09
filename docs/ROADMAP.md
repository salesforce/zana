# Roadmap

Parked ideas and planned work, newest first. Each entry is self-contained so it
can be picked up cold. `Status` ∈ {parked, planned, in-progress, shipped, dropped}.

> **Shipped recently (1.0.0):** the `zana-tickets` re-extraction (core is now
> framework-free), a per-project Activity Feed + recap, the macOS menu-bar
> popover, `inbox_ask` (agents ask structured questions and block for the
> answer), launcher Advanced mode (persona + framework presets), spawn-an-agent
> on follow-ups, and Library full-text search + 1.0 hardening. See
> [`docs/releases/1.0.0.md`](./releases/1.0.0.md).
> Earlier (0.8.7): Inbox AI Summary, `inbox_search`, the Zana Hub extension,
> project-focus navigation, the Orchestrator→Chat rename
> ([`docs/releases/0.8.7.md`](./releases/0.8.7.md)); Document Library, Goals, and
> Follow-ups.

---

## Document Library

**Status:** shipped (designed 2026-06-12; `LibraryView` + `.zcc/library/` live)
**Full plan:** [`docs/document-library-plan.md`](./document-library-plan.md)

### One-line
A first-class place to keep generated artifacts (md, pdf, images, code), browse
them with a tree + multi-format preview, and let agents search/fetch/store them
via a skill.

### Key insight (don't re-derive)
~85% of this already exists — it's assembly, not new infrastructure.
`saved-store.ts` (atomic write, tolerant read, `onChanged`) + `template-store.ts`
(dual-scope precedence merge) are the store template; `fs.ts` already does
`walkFiles`/`searchFiles`/`readFile`; `ExplorerView` is tree + Monaco + md/mermaid
preview; `PreviewPane` already hosts `<webview>`s (→ Chromium's built-in PDF
viewer). The agent-access pattern is the **`saved-reports` skill** — explicitly
"NOT an API and NOT an MCP tool": agents just Read/Write/Grep the store.

### Resolved decisions (2026-06-12)
- **Storage:** *both, project-default* — `<repo>/.zcc/library/` (git-trackable)
  **+** `~/.zcc/library/` (global), precedence-merged with source badges.
- **Storage shape:** real files on disk + a rolled-up `index.json` manifest
  (title, tags, provenance, summary) — NOT a JSON-blob store (PDFs don't inline;
  agents read files best).
- **Agent access:** a `library` skill + normal file tools. MCP `library_*` tools
  deferred until a remote/programmatic/server-validated need appears.

### Scope guard (v1)
`saved-store` stays as-is (frozen inbox snapshots); add a one-click "Save to
library" bridge. New `'library'` `WorkspaceMode`; `LibraryView` = ExplorerView's
tree + a format-switched preview (md→react-markdown, pdf→webview, image→`<img>`,
code→Monaco). No versioning graph (date-stamped names). Scheduled-run deposits
write the manifest inline (see `scheduled-runs-no-background-agents` memory).

### Phases (detail in document-library-plan.md)
1. **Store, no UI** — types; `library-store.ts` (fork template-store + saved-store);
   manifest reconciliation; IPC; tests. Hand-write JSON to test.
2. **Browse UI** — `'library'` mode; `LibraryView.tsx`; format-switched preview;
   tag filter; `fs.searchFiles` full-text.
3. **Deposit paths** — "Save to library" from inbox/saved; `inbox_push docs:`
   promotion; scheduled-run artifact → library.
4. **Agent skill** — `library` skill (clone `saved-reports`): where / manifest /
   search / fetch / store + minimal-valid-entry recipe + path-traversal caution.
5. **Optional** — `library_search/fetch/store` MCP tools with traversal guard.

### Entry points when resuming
- Store to fork: `src/main/template-store.ts`, `src/main/saved-store.ts`.
- File ops: `src/main/fs.ts`. Browse/preview: `src/renderer/components/{ExplorerView,PreviewPane,MermaidDiagram}.tsx`.
- Workspace mode: `src/renderer/store.ts:50`, `:429-492`.
- Skill precedent: `resources/saved-reports-skill.md`, `src/main/skill-installer.ts`.

---

## Live Agent Status Awareness

**Status:** planned (designed 2026-06-10 via Zana arch council)
**Full plan:** [`docs/live-agent-status-plan.md`](./live-agent-status-plan.md)
**Tickets:** [`docs/live-agent-status-tickets.md`](./live-agent-status-tickets.md)
**Inspiration:** `herdr` (a Rust TUI multiplexer for Claude Code sessions)

### One-line
Live per-tab agent state (🔴 blocked / 🟡 working / 🔵 done-unseen / 🟢 idle),
rolled up to project/sidebar, with tab-aware notifications.

### Council verdict
APPROVE WITH CONDITIONS (security-reviewer + performance-engineer + researcher).
20 binding conditions; all traced to tickets LAS-00…LAS-14.

### Key insight (don't re-derive)
Detection is **screen-scan-PRIMARY, hooks ADVISORY** — NOT hook-primary. herdr
removed Claude lifecycle-state hooks in v5 (`herdr/src/integration/mod.rs:1374`)
because `SubagentStop` fires after turn-end and revives idle panes; screen-scan
(`herdr/.../claude.toml`) is its Claude authority. `blocked` is screen-only
(`Notification` hook is unreliable for permission prompts). Hooks only accelerate
`idle→working` and stamp `done`.

### Where we beat herdr (the enhancement — LAS-07b + idle-veto)
Because we *launch* Claude (herdr only watches the screen) we have two signals it
gave up on: (1) **OSC-title spinner parsed from the raw PTY byte stream** in
`pty.ts` — near-zero-cost `working`/`done`, and it works for **hidden/unfocused
tabs** (herdr needs the rendered title); (2) **hook idle-veto** — a `PreToolUse`
with no closing `Stop`/`PostToolUse` means a tool is in flight, so we *suppress* a
false `idle` during a quiet-screen moment. herdr can only *delay* a false idle;
we *know* it's false. "idle" = `❯` prompt box + no question + title not a spinner
+ no tool in flight, held ~300 ms.

### Three non-negotiables
1. **Don't re-key `/hook/stop/...`** — scheduler auto-close depends on it
   (`scheduler.ts:664`). Add lifecycle as a new route that *also* drives it.
2. **One composed `--settings`** (`composeSettings()`) — live-status + scheduler +
   parked Personas all want it; Claude takes a single flag (last wins).
3. **Status in a dedicated store, not on `TerminalSession`** — else every tick
   render-storms `terminals` consumers; rollup precomputed, read as a primitive
   (zustand infinite-loop trap, see UI-state memory).

### Entry points
- Hooks/spawn: `src/main/pty.ts` (`buildStopHookSettings` :563, `ZCC_HOOK_URL` :206).
- Callback route: `src/main/mcp-server.ts` (:126-194).
- Scheduler done path: `src/main/scheduler.ts` (`onAgentFinished` :664).
- Store: `src/renderer/store.ts` (`onUpdated` :750). Detector ref: `herdr/src/detect/`.

---

## Launchable Personas

**Status:** parked (brainstormed + planned 2026-06-09, deferred for later thought)
**Full plan:** [`docs/personas-plan.md`](./personas-plan.md)

### One-line
Spawn named, reusable Claude Code personalities (Reviewer, Architect, Bug-hunter…)
into terminal tabs, per project — à la Zana personas, but native to this app.

### Why it's worth doing
~90% of the plumbing already exists. The launch path in `src/main/pty.ts` is
already a layered profile system; it's just hardcoded to 4 profiles. A persona is
"one more layer" + a manifest loader we've already written once (the scheduler's
`ScheduleTemplate` discovery). High value (the spawn moment), low blast radius.

### Key insight (don't re-derive this later)
A Persona is **a manifest that composes native `claude` CLI flags** — NOT a new
launch mechanism or runtime. It maps only to flags the CLI already accepts:
`--append-system-prompt`, `--model`, `--permission-mode`, `--allowedTools`,
`--disallowedTools`, `--add-dir`, `--mcp-config`, `--agents`. This keeps us
forward-compatible: if Anthropic ships richer agent config, we map to it, not
around it.

Two existing rails it rides:
1. **Precedence chain in `pty.ts`** — `resolveLaunch(profile)` → AppConfig globals
   → ProjectSettings → extraArgs → MCP injection. Persona = a NEW layer between
   AppConfig globals and ProjectSettings. `ProjectSettings` is already effectively
   an unnamed, one-per-project persona (appendSystemPrompt + model + permissionMode
   + allowedTools + deniedTools + addDirs + extraArgs).
2. **`ScheduleTemplate` loader in `src/main/template-store.ts`** — builtin ⊕
   `~/.zcc/templates/*.json` ⊕ `<project>/.zcc/templates/*.json`,
   precedence-merged, hot-reloaded via `onTemplatesChanged`. Fork this verbatim
   for persona discovery (`~/.zcc/personas/`, `<repo>/.zcc/personas/`).

### Decision already made (2026-06-09)
**Sit-beside, NOT absorb.** `LaunchProfileId` stays the 4-value union
(`shell | claude | claude-resume | claude-yolo`). `TerminalSession`,
`CreateTerminalRequest`, scheduler etc. gain an optional `personaId`. A persona
declares a `baseProfile` it builds on. Rejected alternative: replacing the union
with a Persona record ("personas all the way down") — cleaner end state but touches
every `LaunchProfileId` site, `profileIcon`, scheduler, command palette, store,
persistence. Not worth the churn.

### Scope guard (v1 is small)
v1 persona = the `ProjectSettings` fields + name/icon/description + optional
`initialPrompt` + optional MCP allowlist. NO new orchestration, NO lifecycle, NO
inheritance graph. Reuse `inbox_push` for "persona finished". Multi-agent stays a
Phase 4 hand-off to the existing Zana `team`/`council` skills — we do NOT
reimplement orchestration or take a daemon dependency.

### Phases (detail in personas-plan.md)
1. **Core, no UI** — `Persona` type; `persona-store.ts` (fork template-store);
   `personaArgs()` layer in `pty.ts` + remote parity; IPC; scheduler pass-through;
   tests. Launchable from hand-written JSON.
2. **Spawn UX** — `+` picker lists personas; `Project.defaultPersonas`; one-click
   default; persona icon on tabs; `initialPrompt` write-on-spawn.
3. **Panel** — `PersonasPanel.tsx` (clone `SchedulerPanel`); project-shipped
   `<repo>/.zcc/personas/` with source badges.
4. **Optional** — `--agents` subagents; `promoteTo: "zana-team:<template>"`.

### Open questions to revisit
- MCP server registry: how does a persona name an MCP server (`"mcpServers": ["gus"]`)
  and how is that name resolved to a config block in the launcher-owned `.mcp.json`?
  Needs a small registry — design not yet done.
- `initialPrompt` delivery for interactive vs. scheduled (non-interactive) sessions:
  pty-write `prompt + \r` vs. scheduler's positional-argv path. Pick per context.
- Builtin starter personas: which ship in-box? (Reviewer, Architect proposed.)
- Should `defaultPersonas` supersede or coexist with the existing `defaultAgents`
  field on `Project`?

### Entry points when resuming
- Launch assembly + precedence: `src/main/pty.ts` (`resolveLaunch`,
  `projectSettingsArgs`, `mergeAllowedTools`, `buildRemoteCmd`).
- Loader to fork: `src/main/template-store.ts`.
- Types: `src/shared/types.ts` (`LaunchProfileId`, `ProjectSettings`,
  `ScheduleTemplate`, `Project.defaultAgents`).
- MCP injection: `src/main/mcp-config.ts`.
- Spawn UI: `src/renderer/components/{TabBar,Workspace}.tsx`, `util/profileIcon.tsx`.
