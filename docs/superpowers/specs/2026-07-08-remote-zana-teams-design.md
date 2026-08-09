# Remote Zana Teams — Design

**Date:** 2026-07-08
**Status:** Approved (brainstorm) — pending implementation plan
**Author:** brainstorm session

## Problem

Launching a zana "squad" against a **remote (SSH) project** does not work. The
symptom (observed in a live remote session — Claude Code v2.1.197 on
`/opt/workspace/core-public/core`, cwd `~/.zcc/remote-projects/<id>`):

```
● Unknown command: /zana:team
● Args from unknown skill: dev-squad Working on W-1234567
```

The squad launch hands the remote agent an opening prompt of literally
`/zana:team <slug> <goal>` (`src/renderer/components/LaunchPanel.tsx:201-203`).
That resolves locally because the whole zana toolchain is installed on the host
machine — but **none of it crosses the SSH boundary**:

1. **`/zana:*` commands** live in the `zana` Claude Code plugin at
   `~/.claude/plugins/cache/zana-marketplace/zana/<ver>/commands/*.md` (installed
   via `claude plugin install`, `src/main/dependency-doctor.ts:301-323`). Absent
   on the remote → "Unknown command".
2. **The squad definition** (`core-dev-squad`) lives in the host's
   `~/.zana/teams/*.json`. The remote's `~/.zana/teams` is empty.
3. **The coordination backbone** — the `zcc-inbox` MCP server — is a
   `127.0.0.1` HTTP listener in the app's main process. It is **deliberately
   dropped** for remote sessions today (`src/main/pty.ts:1087-1096`): the remote
   claude argv omits `--mcp-config`, `ZCC_MCP_URL`, the hook `--settings`, and the
   inbox allowlist, because those point at a local listener unreachable from the
   remote "without a reverse tunnel."

So "run a squad on remote" = a lone `claude` session trying to invoke tooling
that isn't installed on the box.

## Approach (decided)

**Keep the remote thin; orchestrate on the host.** Rather than provision the
zana plugin + squad files onto locked-down `sfwork` workspaces, the host performs
the orchestration it already knows how to do — the app-native `launchTeam()` —
and we make its coordination backbone reachable from the remote over an
**authenticated SSH reverse tunnel**. The remote stays a stock `ssh` + `claude`
box; nothing is installed there.

Decisions locked in during brainstorm:

- **Orchestration model:** orchestrate locally (not "provision zana on remote").
- **Tunnel lifecycle:** one persistent reverse tunnel **per remote host**,
  ref-counted, lazily opened, torn down when the last remote session on that host
  closes.
- **Squad bridge:** translate `~/.zana` squad → app-native `Team` **on the fly**
  (not "author separate `~/.zcc` teams"), because the two shapes are a 1:1 mirror
  by design (`Team.slots` is documented as "the ZCC mirror of Zana's
  `slots:[{profileId,quantity}]`", `src/shared/types.ts:1891`), and the squad
  picker is the primary affordance the user hits.
- **Listener auth (Component 4):** token is **required and injected for all
  sessions** (local + remote) — one enforcement path. This also hardens the
  currently-open local listener. Caveat documented below.

## Why `launchTeam` is the right host-side engine

`launchTeam()` (`src/main/index.ts:1531`) is **already transport-agnostic**: it
never branches on `project.remote`. It calls `createTerminalConfined` per tab,
which passes `remote: project.remote` down to `ptys.create` →
`createRemote` (`src/main/pty.ts:534-535`), so it already spawns N+1 remote `ssh`
PTY tabs correctly and the orchestrator's opening prompt/roster reaches a remote
orchestrator via argv (`buildRemoteCmd` re-appends `extraArgs`,
`src/main/pty.ts:1687,1722`).

**The only functional gap is MCP.** `createRemote` never calls
`safeEnsureMcpConfig` and `buildRemoteCmd` never adds `--mcp-config`, so a remote
team gets no `zcc-inbox` → no `agent_send` / `agent_inbox` / `inbox_push`. The
orchestrator prompt tells it to delegate via `agent_send`
(`src/main/index.ts:1511`), but those tools don't exist remotely. Closing that
gap is the load-bearing work.

## Components

### Component 1 — Remote launch routing (renderer + IPC)

`LaunchPanel.launch()` builds `body = /zana:team <slug> <goal>` unconditionally
today (`src/renderer/components/LaunchPanel.tsx:201-203`).

Change: when `project.remote` is set **and** a squad is selected, do **not** emit
the slash-command prompt. Instead call a new IPC
`teams.launchSquad(squadId, projectId, goal)` that runs the host-side path
(Components 2–3). Behavior unchanged for:

- Local squad launches (still `/zana:team …`).
- Remote **single** agents with no squad selected (already work today — the
  free-text prompt is fine over SSH).

The renderer already knows `project.remote` (it drives other remote branches), so
this is a branch in `launch()`, not new plumbing.

### Component 2 — Squad → Team translation (main)

> **Correction (2026-07-08, from inspecting real on-disk data).** An earlier
> draft of this section assumed a squad slot's `profileId` was a **structural
> 1:1 mirror of an app `personaId`** validatable against the app persona store.
> That is FALSE. A daemon squad slot's `profileId` is a **UUID that references a
> full daemon agent definition** at `~/.zana/profiles/<uuid>.json` — e.g.
> `{ displayName, description, icon, model: "claude-opus-4-8", effortLevel,
> permissionMode, allowedTools, disallowedTools, systemPrompt }`. No app persona
> shares those UUIDs, so `launchTeam`'s `known.has(slot.personaId)` gate
> (`src/main/index.ts:1590`) would skip EVERY slot and launch an empty team. The
> daemon team file ALSO already carries `orchestratorProfileId` and
> `initialPrompt` (the earlier draft claimed it lacked both). The translation
> below reads and MAPS each daemon profile into an in-memory app `Persona`.

The current `listSquads()` (`src/main/daemon-team-store.ts:75-93`) deliberately
surfaces only `SquadSummary` and **discards `slots`, `profileId`s, orchestrator,
and prompts**. We add:

1. **A full-file squad reader** for `~/.zana/teams/<id>.json` parsing the complete
   daemon shape (`{ id, name, icon, description, orchestratorProfileId?, slots:
   [{ profileId, quantity }], initialPrompt? }`).
2. **A daemon-profile reader + mapper** for `~/.zana/profiles/<uuid>.json` that
   produces an in-memory app `Persona` (`src/shared/types.ts` `Persona`):
   - `id` ← `zana:<uuid>` (namespaced so a bridged persona can never collide with
     a `builtin:`/user/project/`ext:` id).
   - `name` ← `displayName`; `description`, `icon` pass through.
   - `model` ← the daemon's CLI model string mapped to the persona enum:
     `claude-opus-*` → `'opus'`, `claude-sonnet-*`/`claude-5-*` → `'sonnet'`,
     `claude-haiku-*` → `'haiku'`, anything else → `'default'`.
   - `appendSystemPrompt` ← `systemPrompt`.
   - `allowedTools` ← `allowedTools`; `deniedTools` ← `disallowedTools`.
   - `permissionMode` ← `permissionMode` when it's a valid app enum, else omitted.
   - `baseProfile` ← `'claude'`. (The daemon's `effortLevel` has no app persona
     field and is dropped.)
   The mapper runs through the shared `sanitizePersona` gate so a malformed
   profile file is rejected the same way a hand-edited persona file is.
3. **A `bridgeSquad(squadId, goal)` builder** that ties the two together into an
   in-memory `Team` PLUS the array of bridged `Persona`s it references:
   - Each `slot.profileId` → a bridged persona (id `zana:<uuid>`); the slot's
     `personaId` becomes that bridged id, `quantity` preserved.
   - `orchestratorPersonaId` ← `zana:<orchestratorProfileId>` when the squad
     names one AND its profile mapped; else the first successfully-mapped slot.
   - `initialPrompt` ← the squad's own `initialPrompt`, with the user's `goal`
     folded in (the `orchestratorPrompt` helper already appends the goal briefing
     + worker roster, so we pass `initialPrompt` through as the team prompt and
     `goal` through `opts.goal`).
   - **Unmapped slots are surfaced loudly.** Any `profileId` whose profile file is
     missing/unparseable is collected and returned so the caller can warn
     ("4 of 6 roles launched; 2 profiles not found: …"). Never a silent empty team.

**The bridged personas are injected into the launch, not persisted to the store.**
Both launch seams resolve persona ids against `personas.list()` — `launchTeam`'s
`known` set (`src/main/index.ts:1550`) and `createTerminalConfined`'s
`resolvePersonaLaunch(safeReq, personas.list())` (`src/main/index.ts:1438`). To
keep the translation "on the fly" (no persistent registry mutation), we extract
the body of `launchTeam` into `launchTeamCore(team, targetProjectId,
extraPersonas, opts)` and thread a **MAIN-only `extraPersonas: Persona[]`** down
through `createTerminalConfined` (a new MAIN-only param, never renderer-sourced —
Rule 1) so `resolvePersonaLaunch` resolves against `[...extraPersonas,
...personas.list()]`. `launchTeam(teamId, …)` becomes a thin wrapper passing
`extraPersonas = []`; the new host-side squad launch calls `launchTeamCore` with
the bridged team + bridged personas. `launchTeam`'s worker-first / orchestrator-
last loop, cohort wiring, and tab cap are otherwise unchanged.

### Component 3 — Authenticated MCP reverse tunnel (main)

**Tunnel manager** (new module):

- One persistent control connection per remote host:
  `ssh -N -R <remotePort>:127.0.0.1:<mcpPort> <target>`, opened **lazily** on the
  first remote-team launch to that host.
- **Ref-counted** across every tab and every team targeting that host (a team is
  N+1 tabs to the *same* host, so they share one tunnel). Torn down when the last
  remote session on the host closes.
- **Dynamic remote port**: request `-R 0:127.0.0.1:<mcpPort>` and read back the
  assigned remote port (via ControlMaster `-O forward` output), avoiding fixed-port
  collisions on shared boxes. The MCP listener's local port is the ephemeral one
  already captured at boot (`http://127.0.0.1:<port>`, `src/main/mcp-server.ts:762-794`,
  exposed via `ptys.setMcpBaseUrl`, `src/main/index.ts:4956`).

**Re-enable the dropped injection** in `buildRemoteCmd` /
`createRemote` (`src/main/pty.ts:1097-1225`, `1653-1728`), pointed at the
tunneled endpoint `http://127.0.0.1:<remotePort>`:

- `--mcp-config <path>` (+ the inbox `--append-system-prompt` guidance). The
  config body is static and env-substituted by the CLI
  (`{"mcpServers":{"zcc-inbox":{"type":"streamable-http","url":"${ZCC_MCP_URL}"}}}`,
  `src/main/mcp-config.ts:47-62`), so pointing it at the tunnel is just an env
  change.
- `ZCC_MCP_URL = http://127.0.0.1:<remotePort>/mcp/<projectId>/<sessionId>`.
- **`ZCC_SESSION_ID`** — the mesh identity/attestation marker
  (`src/main/pty.ts:855`). Currently NOT set remotely; without it `agent_send`
  peer resolution and the orchestrator worker-roster break. Must be injected
  remotely (via the `ssh` env — see note below).
- The `--settings` hook block (stop/notify/firstprompt/subagent/overseer) with
  its `ZCC_*_URL` env vars pointed at `http://127.0.0.1:<remotePort>/hook/…`.
- The inbox/mesh/agent-data `--allowedTools` allowlist.

**Env-over-SSH note.** `createRemote` builds a bare `ssh -t <target> <remoteCmd>`
with no env forwarding today (`src/main/pty.ts:1182-1193`). The `ZCC_*` env vars
must reach the remote claude process. Options for the plan to pick from: prefix
them into the remote command string (`cd … && ZCC_MCP_URL=… ZCC_SESSION_ID=… exec
claude …`, consistent with how auto-mode's `CLAUDE_CODE_ENABLE_AUTO_MODE=1` is
already prepended at `src/main/pty.ts:1720`), or `SendEnv`/`SetEnv`. Prefixing the
command string is the least-surprising, matches the existing pattern, and keeps
the values out of the remote's ambient environment.

### Component 4 — Auth on the listener (main, security)

The MCP listener trusts `127.0.0.1` and carries **no token** — the only
identifiers in the route are `projectId`/`sessionId` UUIDs, which are not secrets
(`src/main/mcp-server.ts`, route matcher). A reverse tunnel exposes the listener
on the **remote's loopback**, reachable by any process on that (potentially
shared) box. That is an unacceptable trust widening without auth.

- Mint a **bearer token** (host process, per boot or per tunnel — plan decides
  granularity; per-tunnel is stronger).
- Inject it: MCP config `headers: { Authorization: "Bearer <token>" }` (and/or
  `ZCC_MCP_TOKEN` env consumed by the config), and the curl hooks gain
  `-H "Authorization: Bearer <token>"` (`buildHookSettings`,
  `src/main/pty.ts:1763+`).
- Validate it in the route matcher for **both** `/mcp/*` and `/hook/*` routes;
  reject missing/incorrect tokens with 401.
- **Applied to all sessions (local + remote)** — one enforcement path, and it
  closes the pre-existing open-local-listener exposure.

**Migration caveat:** because the token becomes required for every session, any
local claude session already running from before the upgrade would lose MCP/hook
connectivity until restarted (its injected argv predates the token). New sessions
are unaffected. This is acceptable and will be noted in the release notes.

## Data flow (remote squad launch)

```
User picks squad "core-dev-squad" on a REMOTE project, enters goal
  → LaunchPanel.launch(): project.remote? yes + squad? yes
      → IPC teams.launchSquad(squadId, projectId, goal)
  → main: readFullSquad(~/.zana/teams/core-dev-squad.json)
      → translate slots→personas, validate, collect unmapped, synthesize
        orchestrator + initialPrompt  →  in-memory Team
  → tunnelManager.ensure(host): open/reuse ssh -N -R, get <remotePort>, token
  → launchTeam(Team, projectId):
      for each worker slot + orchestrator:
        createTerminalConfined → createRemote(ssh -t) with re-enabled MCP/hook
        injection pointed at http://127.0.0.1:<remotePort>, Bearer <token>
  → remote claude sessions reach zcc-inbox through the tunnel:
        orchestrator agent_send → workers;  workers inbox_push / report back
  → last remote session on host closes → tunnelManager tears down the tunnel
```

## Error handling & risks

- **`AllowTcpForwarding no` on remote sshd** (plausible on locked-down `sfwork`
  boxes) → the reverse tunnel fails to establish. Detect once per host and surface
  a clear, actionable error ("remote host disallows SSH port forwarding; team
  coordination unavailable") instead of silently launching a team that can't
  coordinate. Do not fall back to the broken `/zana:team` path.
- **Tunnel drop / reconnect.** On control-connection death, mark that host's
  sessions degraded and re-establish the tunnel on the next launch. (The remote
  claude sessions themselves persist under tmux per existing behavior.)
- **Unmapped personas.** Warn + list; launch with what mapped. Never silent.
- **Port collision.** Dynamic remote port (`-R 0:…`) avoids fixed-port clashes on
  shared workspaces.
- **Token leakage.** Token rides in argv/env of the remote process; acceptable
  given it is scoped to the tunnel and the listener is loopback-only on both ends.
  Prefer per-tunnel tokens so a leak is bounded.

## Testing

- **Unit**
  - Squad→Team translation: `profileId→personaId` mapping, orchestrator/prompt
    synthesis, and unmapped-slot collection (asserts they are surfaced, not
    dropped).
  - Token validation: `/mcp/*` and `/hook/*` reject missing/wrong bearer (401),
    accept correct.
  - Launch routing: remote+squad dispatches `teams.launchSquad`; local+squad still
    emits `/zana:team …`; remote single-agent unchanged.
- **Integration**
  - `buildRemoteCmd` output for a remote claude session includes `--mcp-config`,
    `ZCC_MCP_URL`/hook URLs at the tunneled port, `ZCC_SESSION_ID`, the allowlist,
    and the bearer header — and omits them again if the tunnel is unavailable
    (degraded path).
  - Tunnel manager ref-count: open on first launch, reuse across tabs/teams to the
    same host, teardown on last close; failure surfaces the actionable error.

## Out of scope (natural follow-ons)

- **Single remote agents** gaining `inbox_push` / report-back: rides the same
  tunnel + injection nearly for free, but core scope stays on teams.
- Provisioning the zana plugin/skills onto remotes (the rejected alternative).
- Remote-to-remote (cross-host) teams — all tabs of a team target one host here.

## Key code references

- Squad slash-command prompt: `src/renderer/components/LaunchPanel.tsx:201-223`
- Squad picker vs native team affordances: `LaunchPanel.tsx:252-302, 390-437`
- Squad summary reader (discards slots): `src/main/daemon-team-store.ts:14-93`
- `SquadSummary` / `Team` / `TeamSlot` types: `src/shared/types.ts:1891-1967`
- `launchTeam` (transport-agnostic): `src/main/index.ts:1531-1661`
- `createTerminalConfined` (remote passthrough): `src/main/index.ts:1374-1470`
- MCP listener (127.0.0.1, ephemeral port, no auth): `src/main/mcp-server.ts:535-698, 762-794`
- Per-project MCP config file body: `src/main/mcp-config.ts:24-113`
- Local injection (mcp-config/env/hooks): `src/main/pty.ts:595-617, 845-913, 1763+`
- Deliberate remote drop: `src/main/pty.ts:1087-1096, 1182-1193`
- `buildRemoteCmd`: `src/main/pty.ts:1653-1728`
- Zana plugin install (context): `src/main/dependency-doctor.ts:301-323`
