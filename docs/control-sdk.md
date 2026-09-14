# Control SDK (`@zana-ai/zcc-control`)

Node client for **live-driving a running Zana Command Center** over loopback
product HTTP. Tests, one-off scripts, and the operator CLI (`zcc thread` /
`zcc agent`) use the same client.

It is **not** a Playwright replacement, **not** part of plugin-sdk, and **not**
a new `zcc control` namespace. Plugin origin stays `plugin`. This client always
stamps `origin: 'sdk'`.

Operator surface: [`docs/cli.md`](./cli.md). Coupling note: `CLAUDE.md`
(“Verify threads / CLI Agents still launch” → `pnpm live:mode-reasoning`
then `pnpm live:memory`).

## What it is / is not

| Is | Is not |
|---|---|
| Attach to a running app (`:8780` / `:8781`) | Playwright / Electron E2E |
| Isolated server + host-daemon for **threads** | Isolated CLI Agent (needs Electron) |
| Shared client for live tests and `zcc thread` / `zcc agent` / `zcc browser` | Plugin SDK (`definePluginApp`) |
| Tagged live-test janitor (`[zcc-live:<runId>]`) | Operator titles (CLI uses `tagged: false`) |
| Modern threads + CLI Agents + desktop-browser product HTTP | `teams.launch`, shell PTY (`POST /api/v1/terminals`), in-app chrome (find-in-page, Take over) |

## Connect

```ts
import { Zcc } from '@zana-ai/zcc-control';

const zcc = await Zcc.connect();
const project = await zcc.projects.ensureLiveSandbox();
await zcc.harness.preflight({ surface: 'thread', providerId: 'claude-code' });
const thread = await zcc.threads.spawn({
  projectId: project.id,
  prompt: 'reply with PONG and stop',
  permissionMode: 'accept-edits'
});
await thread.wait({ until: 'idle', onInteraction: 'fail' });
await thread.send('second turn: reply PONG2 and stop');
await thread.wait({ until: 'idle' });
await zcc.cleanup();
```

`Zcc.connect()` **attaches** to a running app. It probes
`http://127.0.0.1:8780` (packaged / `pnpm start`) then `:8781`
(`pnpm dev` + `~/.zcc-dev`). If both answer, set `ZCC_SERVER_URL`.

`Zcc.launch({ isolated: true })` starts **server + enrolled host-daemon** in a
temp data dir (threads only). **CLI Agent cannot run here** until host-rpc
`harness.start` exists. Parallel CLI Agent in v1 = many sessions on **one
desktop**, not N Electron-less workers.

Do not call `Zcc.connect()` from operator CLI if that would mint a live-run
journal. `zcc thread spawn` / `zcc agent launch` construct `ProductHttpClient`
and call `spawnThread` / `launchCliAgent` with `tagged: false`.

### Host shell and credentials

Live tests and mutating CLI **must** run from a **host shell**, not a ZCC agent
terminal. `ZCC_SESSION_ID` (injected by the app) marks the caller as an agent:
mutating product HTTP returns `FORBIDDEN_AGENT` (CLI exit 5). Unset it before
live scripts (`unset ZCC_SESSION_ID`).

CLI Agent HTTP (`POST /api/v1/cli-agents`) uses a boot-injected
**product-server credential** in Electron main. That credential is **not** on
Electron `process.env`. Human `zcc` over UDS still confirms. Unattended HTTP
does not mint consent — some `executionState` values return a clean DENIED.

### Fake binaries and PATH

`provider: 'fake'` **cannot** rewrite an already-running Electron PATH.
`Zcc.connect({ provider: 'fake' })` throws. Use `Zcc.launch({ isolated: true, fake: true })`
or start the app with fake binaries already on PATH / config `*Binary` keys.
Helpers live in `@zana-ai/zcc-control/testing`.

## Surfaces

| Surface | HTTP | Backend |
|---|---|---|
| Modern thread | `POST /api/v1/threads` | host-daemon ACP |
| CLI Agent | `POST /api/v1/cli-agents` | Electron `createTerminalConfined` via product-server credential (no native confirm) |
| Desktop browser | `POST /api/v1/desktop-browsers/*` | Electron BrowserView broker (attach only; isolated stacks skip) |

Do not overload `POST /api/v1/terminals` (shell PTY). Team launch is a product
HTTP + control-plane confirm path, not an SDK verb. In-app browser chrome
(find-in-page, Take over, plugin-page Browser tab) stays Playwright
(`e2e/desktop-browser-broker.spec.ts`). This client never imports cookies in
live tests — listing import sources is enough to prove cookie values stay in
main.

## API

### `Zcc`

| Method | Notes |
|---|---|
| `Zcc.connect(opts?)` | Attach. Probes 8780 then 8781. Mints a `runId`. |
| `Zcc.launch({ isolated: true })` | Isolated stack, threads only. |
| `health()` | Product health + whether a host is connected. |
| `projects.list()` | Registered projects. |
| `projects.ensureLiveSandbox()` | Dedicated live-sandbox project. |
| `hosts.list()` | Registered machines (`GET /api/v1/hosts`). |
| `harness.preflight({ surface, providerId?, profile? })` | Fail fast if the harness is missing. |
| `threads.spawn(spec)` | Tagged live spawn (`visibility: 'hidden'` unless set). |
| `cliAgents.launch(spec)` | Tagged live launch. Throws `ISOLATED_CLI_AGENT` on isolated stacks. |
| `browsers.pickInstance({ hostId? })` | First connected desktop window, or `{ skip, reason }` (isolated / no host / no BrowserView). |
| `browsers.session(scope)` | Thread-scoped tab/lease handle. |
| `browsers.listInstances(hostId)` / `listImportSources` / `importCookies` | Same HTTP as `zcc browser`. |
| `cleanup({ runId?, stale? })` | Stop journaled ids for this run, or all stale journals. |
| `close()` | Cleanup then stop an isolated stack. |

### `ThreadHandle`

| Method | Notes |
|---|---|
| `snapshot()` / `status` | Last fetched row. |
| `refresh()` | `GET /api/v1/threads/:id` |
| `wait({ until, timeoutMs, onInteraction })` | `idle` (default) / `quiet` / `error` / `needs_you`. `onInteraction`: `fail` (default) / `deny` / `approve-safe`. |
| `waitForEvent(type)` | Long-poll thread events. |
| `send(text, { mode, model, acpMode }?)` | Follow-up turn. |
| `stop()` | Stop the thread. |
| `fork()` | Fork history into a new thread. |
| `timeline()` | Timeline snapshot. |
| `interactions()` / `resolveInteraction(id, resolution)` | Pending permission prompts. |
| `assertHealthy()` | Throws `UNHEALTHY` if `status === 'error'`. |

### `CliAgentHandle`

| Method | Notes |
|---|---|
| `snapshot()` / `status` | Last fetched row. |
| `refresh()` | `GET /api/v1/cli-agents/:id` |
| `wait({ until, timeoutMs })` | `idle` (default) / `working` / `done` / `exited`. `idle` also accepts `done`/`exited`. |
| `reply(text)` | Inject a follow-up at the live prompt. |
| `stop()` | Stop the PTY session. |

### `DesktopBrowserHandle`

Thread-scoped native tabs on an attached Electron window. Isolated
`Zcc.launch({ isolated: true })` cannot run this — there is no BrowserView.

```ts
const picked = await zcc.browsers.pickInstance();
if ('skip' in picked) return;
const thread = await zcc.threads.spawn({ projectId: project.id, prompt: 'stop immediately' });
const browser = zcc.browsers.session({ ...picked.instance, threadId: thread.id });
const cycle = await runDesktopBrowserLeaseCycle(browser, { probeCdp: true });
```

| Method | Notes |
|---|---|
| `listTabs()` / `create({ url, presentation })` | Hidden `about:blank` automation profile by default. |
| `acquire({ tabIds, controllerLabel, ttlMs?, allowPersonal? })` | Exclusive lease. Personal tabs need `allowPersonal`. |
| `connection(leaseId)` | Loopback `ws://127.0.0.1` only; non-loopback throws. |
| `capture(tabId)` | Bounded JPEG (no focus required). |
| `reveal(tabId)` / `close(tabId)` / `release(leaseId)` | Reveal is a no-op unless that thread is already focused. |

`runDesktopBrowserLeaseCycle` (create → acquire → CDP `Browser.getVersion` →
capture → release → close) is the live-test helper.
`runDesktopBrowserImportProbe` then POSTs `importCookies` into the tagged
thread's **automation** partition (never personal). The default probe uses a
missing source profile so it does not copy signed-in cookies; set
`ZCC_LIVE_BROWSER_IMPORT=1` to import a listed profile when one is available.

### Launch context (tagged vs operator)

```ts
ctx: { runId: string; dataDir: string; tagged?: boolean }
// tagged defaults true
```

| | Tagged (`Zcc.threads.spawn`, live tests) | Untagged (`zcc thread spawn` / `zcc agent launch`) |
|---|---|---|
| Title | `[zcc-live:<runId>] …` | User title as given |
| Thread visibility | `hidden` unless set | `visible` unless set |
| Journal | `{dataDir}/live-runs/` | none |
| `origin` | `'sdk'` | `'sdk'` |
| Role XOR model | `assertRoleXorModel` | same |

## Launch specs

### Thread `providerId` vs CLI `profile`

| Harness | Thread `providerId` | CLI Agent `profile` |
|---|---|---|
| Claude Code | `claude-code` | `claude` |
| Cursor | `acp-cursor` | `cursor` |
| Codex | `codex` | `codex` |
| OpenCode | `acp-opencode` | `opencode` |

### Modes (threads)

| Harness | How to set mode |
|---|---|
| Claude Code | Leading `/plan` in the prompt (slash Plan). Default agent has no `acpMode`. |
| Codex | Same `/plan` prompt convention. |
| Cursor | `acpMode: 'agent' \| 'plan'` |
| OpenCode | `acpMode: 'build' \| 'plan'` |

Thread reasoning is `reasoningLevel`: `low` / `medium` / `high`.
Thread permission: `permissionMode` `accept-edits` / `auto` / `full`.

### Modes (CLI Agents)

Trusted `harnessRouting.byAdapter[profile]`:

| Field | Values | Notes |
|---|---|---|
| `executionState` | `plan` / `interactive` / `accept-edits` / `autonomous` | Write-allow uses **trusted** `autonomous` (Claude bypassPermissions, Cursor `--force`, Codex sandbox+never, OpenCode `--auto`). |
| `modelLevel` | `low` / `medium` / `high` / `extra-high` | Cursor has no `low` / `extra-high` mapping. |
| `roleTargetId` | OpenCode `build` / `plan` | **XOR** catalog model (`modelTargetId` / `modelLevel` / `compatibility.model`). A native role pins its own model. |

`assertRoleXorModel` rejects `roleTargetId` together with any catalog model.
OpenCode `roleTargetId` + `executionState` is also denied at the product server.

Unattended product-server HTTP **cannot mint consent**. `accept-edits` sets
`unattendedAllowed: false` on every harness target, so those launches return a
clean **DENIED**. Some `interactive` mappings do the same. That is policy, not
a crash.

### extraArgs sanitization

Do not pass `--extra-args` from the operator CLI. Denied flags would be
stripped (`sanitizeExtraArgs`) and look like they worked.

Stripped tokens include `--force`, `--permission-mode`, `-s`, `--auto`,
`--dangerously-skip-permissions`, `--mcp-config`, `--agent`, and the rest of
`DENIED_LAUNCH_FLAGS` in `@zana-ai/zcc-domain`. Write-allow belongs on
trusted `harnessRouting.executionState: 'autonomous'`.

## Cleanup, tagging, live scripts

Tagged launches are hidden, titled `[zcc-live:<runId>] …`, and journaled under
`{dataDir}/live-runs/`. `zcc live cleanup --stale` (or `zcc.cleanup({ stale: true })`)
stops leftover tagged threads/agents and project processes after a killed Vitest.

Operator CLI launches are **not** tagged and are **not** journaled — `live cleanup`
will not reap them.

```bash
pnpm live:smoke            # attach: threads + CLI Agent
pnpm live:matrix
pnpm live:cli-scenarios    # second turn, file edit, stop mid-run
pnpm live:mode-reasoning   # required after spawn / mode / reasoning changes
pnpm live:browser          # desktop-browser product HTTP (attach Electron)
pnpm live:memory           # required with mode-reasoning; Memory catalog injection
zcc live cleanup --stale
```

Run live scripts from a host shell: `unset ZCC_SESSION_ID && pnpm live:mode-reasoning && pnpm live:memory`.

### CLI Agent scenarios (`pnpm live:cli-scenarios`)

Against Claude Code, Cursor, Codex, and OpenCode:

1. **Second turn** — launch → idle → `reply()` → idle.
2. **File edit** — write `zcc-live-<runId>-<profile>.txt` under live-sandbox with trusted `executionState: 'autonomous'`.
3. **Stop mid-run** — `stop()` once working; session leaves the live list and its pid is dead.

OpenCode launches with native role `build` and no catalog `--model`.

### Mode and reasoning (`pnpm live:mode-reasoning`)

Additive (each mode once, each reasoning once), not cartesian. Asserts the spawn
stays alive then `stop()` — no PONG or wait-until-idle. Missing harnesses
`console.warn` and skip. Keep this suite off `pnpm live:matrix`.

Required after spawn / mode / reasoning changes on threads or CLI Agents
(see `CLAUDE.md`). Follow with `pnpm live:memory` on the same attach.

### Desktop browser (`pnpm live:browser`)

Against an attached Electron app (not an isolated stack): pick a connected
desktop window, spawn a tagged hidden thread, then
`runDesktopBrowserLeaseCycle` — create a hidden automation tab, acquire
control, probe loopback CDP `Browser.getVersion`, capture a JPEG, release,
close. Then `runDesktopBrowserImportProbe` POSTs `importCookies` into that
thread's automation partition (never personal) and asserts cookie **values**
never leave main. The default probe does not copy signed-in cookies; set
`ZCC_LIVE_BROWSER_IMPORT=1` to import a listed profile when one is available.
Missing host / no registered desktop window / harness `console.warn` and skip.
A connected host that answers `desktop_browser_unavailable` is a **failure**
(product HTTP cannot see Electron's BrowserView broker). Keep this off
`pnpm live:matrix`. Native chrome (find-in-page, Take over)
stays `e2e/desktop-browser-broker.spec.ts`.

Required after desktop-browser product HTTP, broker lease/CDP, or
`zcc browser` changes (see `CLAUDE.md`).

### Memory plugin (`pnpm live:memory`)

Against an attached app with the Memory plugin installed and `running`:
product-HTTP CLI (add / catalog / search / get / isolate / forget), then a
tagged hidden Claude Code thread that must quote a seeded catalog summary
from `contributeInstructions` (no tools). Missing plugin or harness
`console.warn` and skip — an empty verify that finishes in milliseconds is a
false green. Keep this off `pnpm live:matrix`.

Required after Memory plugin CLI, catalog injection, or `zcc memory` changes,
and after thread / CLI Agent spawn changes (see `CLAUDE.md`).

## CLI mapping

Each SDK verb has a `zcc` counterpart. Operator commands pass `tagged: false`.

| SDK | CLI |
|---|---|
| `spawnThread` | `zcc thread spawn` |
| `ThreadHandle.wait` (`idle` / `quiet`) | `zcc thread wait` / `spawn --wait` (`--until turn` → idle, `quiet` → quiet) |
| `ThreadHandle.send` | `zcc thread tell` |
| `ThreadHandle.stop` | `zcc thread stop` |
| `ThreadHandle.fork` | `zcc thread fork` |
| `ThreadHandle.timeline` | `zcc thread log` |
| `ThreadHandle.interactions` | `zcc thread interactions` |
| `launchCliAgent` | `zcc agent launch` |
| `CliAgentHandle.wait` | `zcc agent wait` / `launch --wait` |
| `CliAgentHandle.reply` | `zcc agent reply` |
| `CliAgentHandle.stop` | `zcc agent stop` |
| `browsers.listInstances` | `zcc browser instances` |
| `browsers.session().listTabs` | `zcc browser tabs` |
| `browsers.session().create` | `zcc browser create` |
| `browsers.session().acquire` | `zcc browser acquire` |
| `browsers.session().connection` | `zcc browser connection` |
| `browsers.session().release` | `zcc browser release` |
| `browsers.session().reveal` / `close` / `capture` | `zcc browser reveal` / `close` / `capture` |
| `browsers.listImportSources` / `importCookies` | `zcc browser import-sources` / `import-cookies` |
| `cleanupRun` / `cleanupStale` | `zcc live cleanup --tag` / `--stale` |

```bash
zcc thread spawn --project <id> --prompt "…" [--provider claude-code] [--model <id>] \
  [--acp-mode <mode>] [--reasoning-level low|medium|high] [--permission-mode accept-edits|auto|full] [--wait]

zcc agent launch --project <id> --prompt "…" [--profile claude] [--persona <id>] [--title] \
  [--execution-state plan|interactive|accept-edits|autonomous] \
  [--model-level low|medium|high|extra-high] [--role <id>] [--wait] [--timeout]
zcc agent wait <id> [--until idle|working|done] [--timeout]
zcc agent reply <id> "…"
zcc agent stop <id>
```

`--role` XOR `--model-level`. `zcc agent ls` and `zcc term reply` stay on the
control plane.

## Not wired

- **`teams.launch`** — types exist (`TeamLaunchSpec`); the SDK has no
  `zcc.teams.launch`. Use `zcc team launch` (product HTTP).
- **Shell PTY** — `zcc terminal create` / `POST /api/v1/terminals`. Not a
  harness launch.
- **Isolated CLI Agent** — rejected until host-rpc `harness.start` exists.
