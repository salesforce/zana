# Extension-Contributed Personas & a Core Team Primitive — Build Plan

> Design doc, 2026-06-18. Lets **extensions register Personas and Teams** through
> ZCC's core SDK, making personas/teams a first-class core concept usable anywhere
> while extensions populate their own — without violating the core/extension
> separation (CLAUDE.md Rules 1–7, esp. Rule 6). Grounded against current `src/`.
>
> Supersedes nothing in [`personas-plan.md`](./personas-plan.md) /
> [`cu-parity-master-plan.md`](./cu-parity-master-plan.md) WIN 1 Phase 4 — it
> sequences "extension-contributed personas + a Team primitive" as the next step.

## 0. Design thesis (the one decision everything hangs on)

Extension personas/teams are **in-memory, lifecycle-bound registrations**, never
written to disk. They flow through a **new pair of `MainModuleContext` services**
(`ctx.personas.register(...)` / `ctx.teams.register(...)`) that the host implements
per-module. The host already binds the authenticated `moduleId` to every ctx
(built-in: `registry.ts` `setupAll` loops per `mod.id`; disk: `process-host.ts`
`handleBroker` uses `state.moduleId`). So provenance is **stamped by the host from
the id it already owns** — the extension never names itself. This satisfies Rule 6
and Rule 1 with zero new id literals in core logic.

This mirrors the existing `source` provenance pattern in `persona-store.ts`
(the loader stamps `source`, never the file) and the `list_personas`
projection-in-main pattern.

---

## 1. Data model changes — `src/shared/types.ts`

### 1a. Extend `Persona.source`

```ts
export type PersonaSource =
  | 'builtin'
  | 'user'
  | { projectId: string; projectName?: string }
  | { extensionId: string; extensionTitle?: string };
```

Replace the inline union at `Persona['source']` with `source?: PersonaSource;`.
Naming the union `PersonaSource` lets `TeamSource` reuse it and keeps
`listInDir`'s `source: Persona['source']` param working. The `{ extensionId }`
variant is structurally distinct from `{ projectId }`, so the renderer narrows
cleanly (`'extensionId' in source`).

### 1b. New Team types

```ts
/** One row in a team: a persona id + how many tabs to open for it. */
export interface TeamSlot {
  personaId: string;        // references a Persona.id (any source); validated at launch
  quantity?: number;        // tabs to open; default 1; host caps at TEAM_SLOT_MAX
  label?: string;           // optional tab label override
}

export interface Team {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  orchestratorPersonaId?: string;  // opened first; gets the team prompt
  slots: TeamSlot[];
  defaultProjectId?: string;
  initialPrompt?: string;
  source?: PersonaSource;          // stamped by loader/host; never trusted from renderer
}

export type TeamInput = Omit<Team, 'id' | 'source'> & { id?: string };

export interface TeamSummary {
  id: string;
  name: string;
  description?: string;
  slotCount: number;
  source?: PersonaSource;
}

export function toTeamSummary(t: Team): TeamSummary { /* project non-sensitive fields */ }
```

`TeamSlot` references **persona ids** — the ZCC mirror of Zana's
`slots:[{profileId,quantity}]` and CU's `members[]`. No daemon: a Team is a
registry row; launching opens tabs (§4d).

### 1c. Add provenance to `PersonaSummary`

Add `source?: PersonaSource;` to `PersonaSummary` and populate it in
`toPersonaSummary`. Non-sensitive; lets MCP/CLI/renderer show the badge. The
`appendSystemPrompt`/tools omission stays.

---

## 2. The SDK capability — how an extension registers

### 2a. Permission token — reuse, do NOT add new

**Decision: no new `ExtensionPermission`.** Personas/teams are pure declarative
metadata (a flag bundle + a slot list), inert until an **operator** launches one.
The dangerous half (spawning argv) is already gated where it belongs:
`resolvePersonaLaunch` → `pty.ts` / `createTerminalConfined` strip dangerous
flags (`host.ts` denylist, authoritative in main). A Team launch reuses that exact
path per slot. Registration is allowed for any live module (built-in trusted,
disk-ext consented-to-exist); the teeth are at launch. (If a future policy wants it
gated, the seam is one `broker.assert(id, …)` line in the host method.)

### 2b. SDK surface — `packages/extension-sdk/src/main.ts`

Add to `MainModuleContext` (both **optional**):

```ts
/**
 * Contribute Personas to ZCC's core registry. The host STAMPS provenance
 * ({extensionId} from the authenticated calling module — never self-declared)
 * and runs every input through core's shared sanitizePersona gate. Registrations
 * are IN-MEMORY and lifecycle-bound: cleared on teardown/disable/hot-reload.
 * Calling again REPLACES this extension's full set (declarative, not additive),
 * bounded at PERSONAS_PER_EXTENSION_MAX. Ids are namespaced by the host as
 * `ext:<id>:<rawId>`. Returns the accepted (sanitized) personas.
 */
personas?: {
  register(personas: PersonaInput[]): Promise<Persona[]>;
  clear(): Promise<void>;
};
/** Same contract for Teams. Slot personaIds may reference the ext's own personas. */
teams?: {
  register(teams: TeamInput[]): Promise<Team[]>;
  clear(): Promise<void>;
};
```

Plumb `Persona`/`PersonaInput`/`Team`/`TeamInput` types into the SDK package the
same way the repo already bridges shared types (verify the SDK tsconfig path; keep
the package decoupled).

### 2c. Wire path (built-in tier, in-process)

In `registry.ts` `setupAll` the per-module `ctx` is built with `mod.id` in scope.
Add a `registry` dep to `ModuleHostDeps` (a host-side `PersonaTeamRegistry`, §3)
and wire:

```ts
personas: {
  register: (list) => Promise.resolve(deps.registry.setPersonas(mod.id, list)),
  clear: () => Promise.resolve(deps.registry.clearModule(mod.id)),
},
teams: { register: (list) => …, clear: … },
```

The extension passes only input; the host supplies `mod.id`. Zero id literals.

### 2d. Wire path (disk tier, out-of-process)

Three mechanical mirrors of existing `storage`/`exec` brokering:
1. `host-protocol.ts` `BrokerMethod`: add `'personas.register' | 'personas.clear' | 'teams.register' | 'teams.clear'`.
2. `host-child.ts` `proxyCtx`: add `personas`/`teams` that call `broker('personas.register',[l])` etc.
3. `process-host.ts` `handleBroker` switch: add cases calling the injected registry. The authenticated id is **`state.moduleId`** (the anti-spoof anchor). These cases are unconditional like `storage`/`log` (no `caps` gate, §2a). Add `registry` to `ProcessHostOptions`, wired from the same singleton given to the built-in host.

### 2e. Lifecycle (clear on teardown) — critical correctness

Hook the registry into every teardown choke point so registrations die with the module:
- `registry.ts` `MainModuleHost.teardown`: after `mod.teardown?()`, `this.deps.registry?.clearModule(moduleId)`.
- `process-host.ts` `teardown` **and** `onChildExit` (crash) **and** `killAndForget`: `this.opts.registry?.clearModule(state.moduleId)`. Crash must clear too, else a crashed ext leaves zombie personas.

`teardownAll` (quit) flows through `teardown`. Hot-reload = teardown + respawn →
`setPersonas` replaces. Ties into `ModuleRouter.teardown`/`liveModuleIds`.

---

## 3. Stores — extend `PersonaStore`, add `TeamStore` + in-memory `PersonaTeamRegistry`

### 3a. `PersonaTeamRegistry` (new `src/main/extensions/persona-team-registry.ts`)

A tiny `EventEmitter` holding two `Map<moduleId, Persona[] | Team[]>` — the single
shared in-memory source both hosts write to.

```ts
export const PERSONAS_PER_EXTENSION_MAX = 50;   // Rule 5: bounded
export const TEAMS_PER_EXTENSION_MAX = 20;
export const TEAM_SLOT_MAX = 16;
```

- `setPersonas(moduleId, raw)`: `slice` to cap → `sanitizePersona({ ...r, id: 'ext:'+moduleId+':'+slug })` → stamp `source:{extensionId,extensionTitle}` → store → `emit('changed')`.
- `clearModule(moduleId)`, `allPersonas()`, `setTeams`/`allTeams()` twin.
- Reuses the **shared `sanitizePersona`** — same gate as disk/UI.
- Id namespacing `ext:<moduleId>:<slug>` ⇒ no collision with `builtin:`/user/project, no cross-ext shadowing.
- Rule 5: hard caps, `slice` before map; `setPersonas` replaces (not accumulates).

### 3b. `PersonaStore` merge

Add an optional registry ref to the constructor; in `refresh` insert extension
personas (ids are `ext:*`, so collisions with `builtin:`/user/project are
impossible — insert before builtins defensively). Subscribe
`registry.on('changed', () => this.refresh())` in `start()` so (de)registration
re-emits the existing `personas.on('changed')` → `safeSend(IPC.personas.onChanged)`
broadcast. **No new IPC channel needed for personas.**

### 3c. New `TeamStore` (new `src/main/team-store.ts`)

Structural clone of `PersonaStore`: builtin (seed or empty) ⊕ `~/.zcc/teams/*.json`
⊕ `<project>/.zcc/teams/*.json` ⊕ registry. Reuse `writeJsonAtomic` (tmp +
uniquely-suffixed rename) for **Rule 4**. New `sanitizeTeam(raw)`: require
`id`,`name`,`slots:[]`; coerce `quantity` to `1..TEAM_SLOT_MAX`; drop slots whose
`personaId` isn't a string. Persona-existence is checked at **launch**, not store
time. `fs.watch` debounce, `rebindProjects`, `userDir`, `saveUser`, `deleteUser`.

### 3d. Wiring in `index.ts`

- `const personaTeamRegistry = new PersonaTeamRegistry(() => extensionEntries)`.
- `const personas = new PersonaStore(() => store.listProjects(), personaTeamRegistry)`.
- `const teams = new TeamStore(() => store.listProjects(), personaTeamRegistry)`.
- Pass `registry: personaTeamRegistry` into `MainModuleHost` and `ExtensionProcessHost`.
- `teams.start()`/`teams.stop()` beside personas'; `teams.rebindProjects()` everywhere `personas.rebindProjects()` is called.

---

## 4. Surfacing

### 4a. MCP tools
- `list_personas` summaries carry `source` automatically (§1c) — no tool change.
- New `register-teams-mcp-tool.ts` mirroring `register-personas-mcp-tool.ts`: `registerListTeamsTool`, `listTeams?: () => TeamSummary[]` in `McpServerOptions`, gated on the dep, wired `listTeams: () => teams.list().map(toTeamSummary)` at both session + project call sites.

### 4b. Control-plane CLI — `control-plane.ts`
- Add `'team.list'` to `AGENT_ALLOWED_OPS` + `KNOWN_OPS`; `listTeams` in `ControlPlaneDeps`; `case 'team.list'`. `persona.list` now returns `source`.

### 4c. Renderer
- **Persona source badge:** `PersonasPanel.tsx` renders a badge when `'extensionId' in p.source` (shows `extensionTitle`); edit/delete disabled for ext personas (not file-backed).
- **TeamsPanel** (new) + `useTeams` store slice (mirror `usePersonas`), new IPC `teams:{list,onChanged,revealDir,save,delete,launch}`, preload bridge, `safeHandle` handlers, `teams.on('changed')` → `safeSend(IPC.teams.onChanged)`. Ext teams render with badge, editor read-only.

### 4d. Team launch UX (no daemon — cockpit hand-off)
A main-side `launchTeam(teamId, projectId)`: for each slot (orchestrator first),
loop `quantity` calling the existing `resolvePersonaLaunch` + `ptys.create` path —
opens N real tabs, orchestrator carrying `team.initialPrompt`, argv sanitized by the
existing denylist. Renderer "Launch Team" → `teams:launch` IPC; unknown personaIds
skipped with a toast.

**Promote-to-Zana** (cu-parity WIN1 Phase 4): a Team from the zana extension may
expose `promoteTo: "zana-team:<template>"` handled **inside the zana extension's own
code** (the ext naming itself — allowed), not core. Core's `launchTeam` stays generic.

---

## 5. Security / trust review (CLAUDE.md Rules 1–7)

- **Rule 1 (main authorizes):** registration + sanitize run host-side in Electron main; the disk child only *requests* via broker; launch argv sanitized by the existing main-side denylist. ✅
- **Rule 2 (confine paths):** no new path-trust surface; `addDirs` → `--add-dir` handled by the existing confined launch path. ✅
- **Rule 3 (subscribe once / release):** stores subscribe to `registry` in `start()`, release in `stop()`; registrations released on teardown/crash/kill. ✅
- **Rule 4 (atomic writes):** user/project teams use `writeJsonAtomic`; extension registrations are in-memory. ✅
- **Rule 5 (bounded):** per-extension + per-slot caps with `slice`; `setPersonas` replaces. ✅
- **Rule 6 (no extension id in core logic):** provenance stamped by host from `mod.id`/`state.moduleId` — never a literal, never self-declared. New code contains zero hardcoded extension-id strings; the renderer badge reads `source.extensionId` (data). **The Rule-6 guard test adds zero allowlist entries and still passes.** ✅
- **Rule 7 (promotion bounded):** no new built-in promotion; personas/teams are data, brokered like storage. ✅

---

## 6. Test plan (test-parity)

1. **`persona-team-registry.test.ts`** — sanitize, `ext:<id>:*` namespacing, `source.extensionId` stamp, cap at MAX, replace on re-register, `clearModule` empties + emits, invalid dropped.
2. **`persona-store.test.ts`** (extend) — merge precedence with registry source; `onChanged` fires on registry emit; ext ids never shadow builtin/user.
3. **`team-store.test.ts`** (new) — 4-source merge/precedence; `sanitizeTeam` clamping; atomic save/delete; project rebind.
4. **Teardown-clears-registrations** — process-host: register via mock child → non-empty → teardown/crash → empty. registry.ts: `teardown` clears.
5. **Broker routing** — `personas.register` reaches `registry.setPersonas(state.moduleId,…)` with the **authenticated** id (child can't override id in payload).
6. **Rule-6 guard still passes** — run unchanged; allowlist unchanged.
7. **Launch-team** — resolves slots, opens `Σ quantity` ptys, orchestrator first, skips unknown, sanitizes argv.
8. **sanitize/validation** — `sanitizeTeam` unit tests.

---

## 7. File-by-file task list (phased; Personas before Teams)

### Phase 0 — Data model
- `src/shared/types.ts`: `PersonaSource`, repoint `Persona.source`, `PersonaSummary.source` + `toPersonaSummary`, `Team`/`TeamSlot`/`TeamInput`/`TeamSummary`/`toTeamSummary`.
- `packages/extension-sdk/src/main.ts`: `personas?`/`teams?` on `MainModuleContext`.

### Phase 1 — Extension PERSONA source (build & ship first)
1. **`src/main/extensions/persona-team-registry.ts`** (new) — registry + caps + `sanitizePersona` reuse. **First.**
2. `src/main/persona-store.ts` — constructor registry ref; `refresh` merge; subscribe in `start`.
3. `src/main/modules/registry.ts` — `ModuleHostDeps.registry`; ctx `personas`; clear in `teardown`.
4. `src/main/extensions/host-protocol.ts` — `BrokerMethod` personas cases.
5. `src/main/extensions/host-child.ts` — proxyCtx `personas`.
6. `src/main/extensions/process-host.ts` — `ProcessHostOptions.registry`; handleBroker cases; clear in `teardown`/`onChildExit`/`killAndForget`.
7. `src/main/index.ts` — construct registry; pass to both hosts.
8. `src/renderer/components/PersonasPanel.tsx` — extension badge, read-only for ext personas.
9. Tests: 1, 2, 4, 5, 6.

### Phase 2 — Core TEAM primitive (depends on Phase 1 registry)
10. `src/main/team-store.ts` (new) — PersonaStore clone + `sanitizeTeam` + registry merge.
11. `persona-team-registry.ts` — add `setTeams`/teams map.
12. SDK/proxy/protocol/process-host — `teams` ctx + broker cases.
13. `src/main/index.ts` — `teams` store, start/stop/rebind, `teams:*` handlers, broadcast, `teams:launch` + `launchTeam`.
14. `src/shared/ipc.ts`, `src/preload/index.ts` — `teams:{list,onChanged,revealDir,save,delete,launch}`.
15. `src/main/register-teams-mcp-tool.ts` (new) + `mcp-server.ts` wiring; `control-plane.ts` `team.list`.
16. `src/renderer/store.ts` `useTeams`; `src/renderer/components/TeamsPanel.tsx` (new) + nav entry.
17. Tests: 3, 7, 8; re-run 6.

---

## Key decisions

1. **Transport = `MainModuleContext` services**, not new top-level IPC — reuses the per-module ctx where the authenticated id lives.
2. **Provenance stamped by host from the bound `moduleId`** → Rule 6 clean, guard untouched.
3. **Extension personas/teams in-memory & lifecycle-bound** in a shared `PersonaTeamRegistry`, cleared on teardown/crash/hot-reload.
4. **No new `ExtensionPermission`** — registration is inert data; teeth at the already-gated launch path.
5. **Team = registry row referencing persona ids**; launch = open N tabs via the existing pty path. No daemon; Zana deep-orchestration via the ext's own `promoteTo`.
6. **Id namespacing `ext:<moduleId>:<slug>`** ⇒ collisions/shadowing impossible.
7. **TeamStore is a structural clone of PersonaStore** (atomic writes, bounded, watch/debounce, rebind).
8. **Phase order:** data model → extension-persona-source (registry first) → team primitive. Personas ship before Teams.
