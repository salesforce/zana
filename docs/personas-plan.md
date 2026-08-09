# Launchable Personas — Implementation Plan & Status

Spawn named, reusable Claude Code personalities (Reviewer, Architect, Bug-hunter…)
into terminal tabs, per project — riding the two rails that already exist.

> **Status (2026-06-13):** Phases 1–3 are built and tested. The PersonasPanel
> renders (grid-layout bug fixed in `f3a7de4`). The three usability gaps —
> quick-"+" default, per-project default toggle, and CommandPalette entries —
> are now wired (see below). Phase 4 remains optional/unstarted, and a couple of
> original spec items stay dropped (`scope.projectTags`, `subagents`, empty MCP
> registry). See the **Status legend** and per-item checkboxes.

**Status legend:** ✅ done · 🟡 partial · ❌ not started · ⏸️ deferred (optional)

---

## Design

A **Persona** is a manifest that composes native `claude` CLI flags. It is **not** a
new launch mechanism — it slots in as one more layer in the precedence chain
`pty.ts` already runs:

```
resolveLaunch(baseProfile)        base command + args
  → AppConfig globals             --model, --permission-mode
  → PERSONA LAYER  (NEW)          --append-system-prompt, --model, --permission-mode,
                                  --allowedTools, --disallowedTools, --add-dir,
                                  + extra MCP servers merged into --mcp-config
  → ProjectSettings flags         (unchanged; still wins over persona)
  → extraArgs                     per-tab (still highest)
  + MCP injection                 zcc-inbox (unchanged)
```

Decision: **sit-beside.** `LaunchProfileId` stays a 4-value union. `TerminalSession`,
`CreateTerminalRequest`, scheduler, etc. gain an optional `personaId`. A persona
declares a `baseProfile` (which of the 4 it builds on, default `claude`).

Discovery + merge + hot-reload is **forked verbatim** from `template-store.ts`
(`ScheduleTemplate`): builtin ⊕ `~/.zcc/personas/*.json` ⊕
`<project>/.zcc/personas/*.json`, precedence-merged, with an
`onChanged` broadcast. The `initialPrompt` write-on-spawn reuses the scheduler's
prompt-delivery pattern.

## Persona schema (`~/.zcc/personas/<id>.json`)

Reflects the **actual** `Persona` interface in `src/shared/types.ts` (the
original plan listed `subagents` and `scope.projectTags`, which were never
added — see *Dropped from the plan* below).

```jsonc
{
  "id": "reviewer",
  "name": "Code Reviewer",
  "icon": "ShieldCheck",                  // lucide name; fallback if unknown
  "description": "Terse senior reviewer",
  "baseProfile": "claude",                // 'claude' | 'claude-resume' | 'claude-yolo' | 'shell'
  "model": "opus",                        // optional → --model
  "permissionMode": "plan",               // optional → --permission-mode (ignored for yolo)
  "appendSystemPrompt": "You are a senior reviewer…",  // → --append-system-prompt
  "allowedTools": ["Read", "Grep"],       // → --allowedTools (merged/deduped)
  "deniedTools": [],                       // → --disallowedTools
  "addDirs": [],                           // → --add-dir
  "mcpServers": ["gus"],                  // optional; names resolved against MCP_SERVER_REGISTRY
  "initialPrompt": "Review the current diff."  // written to pty after spawn
}
```

A persona maps **only** to flags `claude` already accepts. No bespoke runtime.

---

## Phase 1 — Core resolution (no UI) — ✅ COMPLETE
Goal: launch a persona from a hand-written JSON via scheduler / default chip.

- ✅ `src/shared/types.ts`: `Persona` interface; `personaId?` on `TerminalSession`,
  `CreateTerminalRequest`, `ScheduledTask`/inputs. `cc.personas` API surface
  (list/onChanged/revealDir).
- ✅ `src/main/persona-store.ts` (forked `template-store.ts`): builtin catalogue +
  user dir + project dir, precedence-merge by `id`, fs-watch → `onChanged`.
  Builtins shipped: **Code Reviewer**, **Architect**, **Software Engineer**, **Orchestrator**.
- ✅ `src/main/pty.ts`:
  - ✅ `create()` accepts `persona?: Persona`.
  - ✅ `personaArgs(persona, baseProfile)`, inserted after AppConfig globals,
    before `projectSettingsArgs`.
  - ✅ `effectiveProfile = persona.baseProfile ?? opts.profile`.
  - ✅ `buildRemoteCmd` extended with the persona layer (remote parity, minus MCP).
  - ✅ After spawn, `persona.initialPrompt` written to the pty (claude-family only).
  - ✅ Extra MCP servers: `mcp-config.ts` merges persona-named servers.
    🟡 **Caveat: `MCP_SERVER_REGISTRY` is empty** — the mechanism works but no
    server names resolve yet, so `mcpServers: [...]` is currently a no-op.
- ✅ `src/main/index.ts` + `preload`: `personas:*` IPC; resolves persona by id at
  create time and passes the resolved `Persona` into `ptys.create`.
- ✅ `src/main/scheduler.ts`: `resolvePersona` resolver; a task's `personaId` is
  resolved + passed through, prompt delivered as positional argv.
- ✅ Tests: `persona-store.test.ts` (merge/precedence) + `pty-persona-args.test.ts`
  (layer order + `--allowedTools` dedup). **26 tests pass.**

## Phase 2 — Spawn UX — ✅ COMPLETE
Goal: the spawn moment. "+" offers personas; one-click default.

- ✅ `src/shared/types.ts`: `Project.defaultPersonas?: string[]`.
- ✅ `src/renderer/store.ts`: `createTerminal` opts gain `personaId`; `usePersonas`
  store slice fed by `cc.personas.list` + `onChanged`.
- ✅ **Personas are reachable from every "+" entry point:**
  - ✅ `LaunchPanel.tsx` lists builtins **and** personas (project-filtered),
    selectable, launched with `personaId`.
  - ✅ **Quick "+" one-click default is wired.** Shared resolver
    `projectDefaultLaunch(project, personas)` in `util/launchProfile.ts` (unit
    tested) is consumed by the TabBar "+" right-click fast path, the focus-view
    new-tab menu (`ListPane.tsx`, which now also lists personas), the ⌘T
    keyboard shortcut (`shortcuts.ts`), and the ⌘T menu event (`App.tsx`). A
    pinned `defaultPersonas[0]` launches on its `baseProfile`; a stale id falls
    through to the profile default.
- ✅ `src/renderer/util/profileIcon.tsx`: `personaIcon(persona)` with lucide
  fallback.
- ✅ `src/renderer/components/TabBar.tsx`: tab chip shows the persona icon/label
  when `session.personaId` is set (falls back to profile icon; falls back again
  if the persona was deleted since launch).

## Phase 3 — Management panel + project-shipped personas — ✅ MOSTLY COMPLETE
- ✅ `src/renderer/components/PersonasPanel.tsx` (cloned `SkillsPanel`):
  - ✅ Lists / groups by source (All / Builtin / User / Project), search,
    "Reveal personas dir", source badge per row.
  - ✅ Renders in the full content area (grid-column span fixed in `f3a7de4`).
  - ✅ **Per-project "default persona" toggle** — a star on each persona chip in
    the project-contextual `LaunchPanel` pins `defaultPersonas` (live via the
    widened `updateProject` path: renderer store → IPC → `main/store.ts`).
    Clicking the pinned star again clears the default.
  - ✅ **In-app authoring** — the PersonasPanel rows are now clickable: a
    detail/editor modal (`PersonaEditor.tsx`) views a persona and edits it via a
    form. "New persona" creates one; built-ins open read-only with a
    fork-to-override / duplicate path; user personas are editable + deletable;
    project personas are read-only with "duplicate to user". Backed by a new
    `cc.personas.save` / `.delete` IPC pair → `PersonaStore.saveUser/deleteUser`
    (atomic write to `~/.zcc/personas/`, shared `sanitizePersona` gate, shadows
    built-ins by id). "Reveal" still opens the dir for hand-editing.
- ✅ `Sidebar.tsx`: Personas nav entry (icon `Drama`).
- ✅ **`CommandPalette` wiring** — `buildItems.tsx` emits an "Open Personas"
  action plus a "New &lt;persona&gt; tab in &lt;project&gt;" launch row per
  project persona (keyworded `persona` for fuzzy match); `CommandPalette.tsx`
  provides the `launchPersona` callback + project-filtered `personas`.
- ✅ Project-shipped discovery (`<repo>/.zcc/personas/`) works (Phase 1
  store) and the "project" source badge is shown.

## Phase 4 — Optional escalation — ⏸️ NOT STARTED (optional)
- ❌ `subagents` → `--agents` wiring. **Note:** `subagents` is not even a field on
  the `Persona` type — would need a schema add first.
- ❌ `persona.promoteTo: "zana-team:<template>"` hand-off to the Zana
  `team`/`council` skills.

---

## Dropped from the plan (in the original spec, never implemented)
- ❌ **`scope.projectTags`** — the original schema had
  `"scope": { "projectTags": ["*"] }`. Not on the `Persona` type. Project
  filtering today is by `source.projectId` only (a project-scoped persona shows
  for its own project; builtin/user personas show everywhere). Tag-based scoping
  doesn't exist.
- ❌ **`subagents`** — see Phase 4; spec'd but never added to the type.
- 🟡 **`mcpServers` registry** — wired end-to-end but `MCP_SERVER_REGISTRY` ships
  empty, so no server name resolves yet.

## Remaining work — suggested order
1. ✅ ~~Quick "+" default~~ — done (shared `projectDefaultLaunch`, all "+" paths).
2. ✅ ~~CommandPalette entries~~ — done ("Open Personas" + per-persona launch).
3. ✅ ~~Per-project default toggle~~ — done (star on the LaunchPanel persona chip).
4. **Populate `MCP_SERVER_REGISTRY`** with at least one real server (e.g. gus) so
   `mcpServers` is more than a no-op.
5. ✅ ~~Author a persona from the UI~~ — done (`PersonaEditor.tsx` + the
   `cc.personas.save`/`.delete` IPC pair; agents can author via the extended
   `zcc-center` skill).
6. ⏸️ Phase 4 (subagents, Zana promote) — defer until a concrete need.

## Risk / scope guards
- **Sit-beside keeps blast radius small**: the 4 builtins and every existing
  `LaunchProfileId` site keep working untouched; persona is purely additive.
- **No new runtime**: personas compile to existing `claude` flags only.
- **Precedence is explicit and tested**: persona sits below ProjectSettings and
  extraArgs so a project/tab can always override a persona.
- **Remote parity**: `buildRemoteCmd` gets the same persona layer (minus MCP).
- **`initialPrompt` safety**: claude-family only; never written for `shell`.
  Scheduled/non-interactive runs use positional-arg delivery.

## Touched files (as built)
New: `src/main/persona-store.ts`, `src/main/__tests__/persona-store.test.ts`,
`src/main/__tests__/pty-persona-args.test.ts`,
`src/renderer/components/PersonasPanel.tsx`, builtin personas (in `persona-store.ts`).
Modified: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`,
`src/main/index.ts`, `src/main/pty.ts`, `src/main/mcp-config.ts`,
`src/main/scheduler.ts`, `src/renderer/store.ts`,
`src/renderer/components/{TabBar,LaunchPanel,Sidebar}.tsx`,
`src/renderer/util/profileIcon.tsx`, `src/renderer/styles/global.css`.
Not yet touched (plan expected): `src/renderer/components/Workspace.tsx` quick-"+"
default, `src/renderer/components/CommandPalette.tsx` / `palette/*`.
