# Authoring a ZCC Extension

A Zana Command Center (ZCC) extension is a self-contained feature — a
nav entry plus a panel, optionally backed by main-process capabilities — that
plugs into the app shell without editing core. Extensions build against the
stable `@zana-ai/zcc-extension-sdk` contract and load at runtime from disk.

Fastest start: scaffold with [`tools/create-zcc-extension`](../tools/create-zcc-extension)
(its `sample-hello` source is the minimal worked example).

## On-disk shape

The host discovers extensions under `~/.zcc/extensions/<id>/`:

```
~/.zcc/extensions/hello/
  extension.json        manifest
  renderer.js           the panel bundle (ESM, default-exports a RendererEntry)
  main.js               optional main module (ESM, default-exports a MainModule)
```

## Manifest (`extension.json`)

```json
{
  "id": "hello",
  "title": "Hello",
  "icon": "Sparkles",
  "entry": { "renderer": "renderer.js", "main": "main.js" },
  "engines": { "zccApi": "^1.0.0" },
  "permissions": ["projects:read"]
}
```

| Field | Meaning |
|---|---|
| `id` | Stable, URL-safe id. Doubles as the nav id and the storage namespace. Must match `MainModule.id`. |
| `title` | Sidebar label. |
| `icon` | A **lucide-react icon name** (e.g. `Sparkles`, `Ticket`), resolved host-side. Unknown names fall back to `HelpCircle`. |
| `titleLabel` | Optional window-title suffix when active; defaults to `title`. |
| `entry.renderer` | Filename of the renderer bundle, relative to the extension dir. Optional (a headless extension omits it). |
| `entry.main` | Filename of the main bundle. Optional (a renderer-only extension omits it). |
| `engines.zccApi` | Contract-version range; the host gates against `SDK_API_VERSION` at load and refuses to mount on mismatch. |
| `permissions` | Capabilities the extension intends to use. **Enforced deny-by-default for disk extensions** (P3-B) — see below. |
| `permissionScopes` | Scopes for `exec`/`fs:*`/`net`/`mcp`/`stream` (`execAllowlist`, `fsRoots`, `egressAllowlist`, `mcpAllowlist`, `streamAllowlist`) — see below. |
| `projectTab` | Optional. Opt the renderer panel into a **per-project tab** (alongside Terminals / Explorer / Tickets). `{ label?, icon?, order? }`. See [Per-project tabs](#per-project-tabs-projecttab). |
| `agentPreset` | Optional. Contribute a **framework preset** to the Advanced Quick-Agent launcher — a primer that boots a supported harness session already understanding your framework. `{ systemPrompt, label?, description?, icon?, initialPrompt?, model?, baseProfile? }`. See [Framework presets](#framework-presets-agentpreset). |
| `skills` | Optional `SKILL.md` contributions, deployed only with `agent:contribute`. See [Contributing Skills & MCP servers](#contributing-skills--mcp-servers-agentcontribute). |
| `mcpServers` | Optional MCP server definitions owned by this extension, deployed only with `agent:contribute`. See [Contributing Skills & MCP servers](#contributing-skills--mcp-servers-agentcontribute). |

## The renderer entry — why React is injected

The renderer bundle default-exports a `RendererEntry`: an `activate({ React, host })`
factory that returns the panel component.

```ts
import type { RendererEntry } from '@zana-ai/zcc-extension-sdk/renderer';

const entry: RendererEntry = {
  activate({ React, host }) {
    return function Panel() {
      const [n, setN] = React.useState(0);
      return React.createElement('button', { onClick: () => setN(n + 1) }, `${host.moduleId}: ${n}`);
    };
  },
};
export default entry;
```

The host blob-imports the bundle and calls `entry.activate({ React, host })`,
passing **its own React instance**. The bundle must NOT `import 'react'`: a
second React copy in one tree breaks hooks ("Invalid hook call" / mismatched
dispatcher), because hook state lives in module-level singletons. Building with
`React.createElement` (rather than JSX) keeps the bundle from referencing the
externalized jsx-runtime. The returned component is mounted with a `{ host }`
prop.

`host` (`ModuleHost`) is the only surface an extension touches — there is no
escape hatch to `window.cc`. It exposes: `moduleId`, `call`, `storage`,
`openExternal`, `pushInbox`, `toast`, `getActiveProject`, `listProjects`,
`selectProject`, `launchSession`, and (Phase 2) `on` and `cache`.

### Reaching host from non-React code

Panels get `host` as a prop. But some extension code lives **outside** the React
tree and can't take a prop — a module-singleton store (zustand), a data seam that
store calls, a timer or loop started at module-eval. For those, the SDK exposes a
module-scoped accessor:

```ts
import { primeModuleHost, getModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';

// In your renderer entry — prime ONCE, before returning:
const entry: RendererEntry = {
  activate({ React, host }) {
    primeModuleHost(host);
    return MyPanel;
  },
};

// Anywhere non-React in the SAME bundle — read lazily at call time:
async function loadRows() {
  const host = getModuleHost();
  if (!host) return []; // activate hasn't primed the bridge yet — null-check!
  return host.call<Row[]>('listRows');
}
```

Semantics (mirrors the host-React priming pattern):

- **One instance per extension.** The holder is a module-level singleton of your
  bundle; each disk extension is blob-imported as its own module graph, so the
  host it returns is already the per-extension `ModuleHost` — a global accessor
  gives away no more scope than the `host` prop does.
- **`getModuleHost()` returns `null` before `activate` primes it** — it NEVER
  throws. Callers **must** null-check (a store read that legitimately races
  module-eval gets `null`, not a crash). If your seam should never run before
  activate, throw your own diagnostic on the null.

This **replaces the per-extension `host-holder.ts` hack** (a hand-rolled
`let host` + `setHost`/`getHost` pair each extension copied). In tests, prime the
accessor with `setModuleHostForTesting(createMockHost())` and reset it with
`setModuleHostForTesting(null)` in teardown — no `activate` needed.

### Using JSX, hooks, or a UI library (e.g. lucide-react)

The `React.createElement` style above needs nothing beyond `activate`'s `React`.
But a real panel usually wants JSX and a component library — and those reference
React at **module-eval time** (when the bundle is imported), *before* `activate`
runs. For example, `lucide-react`'s icons call `forwardRef(...)` at import. An
`activate`-only React won't exist yet, so eval throws.

The host therefore ALSO publishes its React instance on a global,
`globalThis.__ZCC_HOST_REACT__`, set synchronously immediately before the
bundle is blob-imported. The pattern (used by the Zana extension):

- Alias `react`, `react/jsx-runtime`, `react/jsx-dev-runtime` (in your build) to
  tiny in-bundle **shims** that delegate to the host React — read lazily from the
  global, falling back to the `activate({ React })` arg. Do NOT `external`-ize
  them (a bare `import 'react'` is unresolvable under blob-import), and do NOT
  let a second real React get bundled (breaks hooks).
- **Bundle** your UI library (lucide-react, etc.) — the host does not inject it.
- Net result: `rollupOptions.external: []`, one host React, JSX/hooks/lucide all
  work. See `extensions/zana/vite.config.ts` + `extensions/zana/src/react-shim.ts`
  for a working reference, and `create-zcc-extension` for the scaffolded setup.

The simplest extensions (no JSX, no eval-time React, like the `hello` sample)
can ignore the global entirely and just use `activate({ React })`.

## Events — `host.on(event, cb)`

`host.on` subscribes to a **read-only notification** the host already emits and
returns an **unsubscribe function** (mirroring core's `on*` convention). The
handler fires with the event's typed, JSON-serialisable payload on every
occurrence. These notify the panel that something changed; they never mutate
anything.

You **can** unsubscribe manually in your effect cleanup, but you don't have to:
every `host.on`/`host.subscribe` subscription is **auto-registered into the
host's cleanup scope** and released for you when your panel unmounts (or the
extension is disabled/removed). So the classic effect-cleanup form and the
"just subscribe" form are both leak-free:

```ts
// Explicit — still fine, returns the unsubscribe from the effect.
React.useEffect(() => {
  const off = host.on('project:changed', ({ project }) => setProject(project));
  return off; // unsubscribe on unmount
}, []);

// Or lean on auto-dispose — the subscription is torn down on unmount anyway.
React.useEffect(() => {
  host.on('project:changed', ({ project }) => setProject(project));
}, []);
```

Calling the returned `off()` AND letting the scope dispose is safe — cleanup is
**idempotent** (the handler is removed exactly once). See
[`register()`](#cleanup--hostregister-auto-dispose) for registering your own
teardown into the same scope.

| Event | Payload |
|---|---|
| `project:changed` | `{ project: { id, name, path } \| null }` — the shell's selected project changed/cleared. |
| `nav:changed` | `{ nav: string }` — the active nav (sidebar selection) changed. |
| `session:updated` | `{ session: SessionInfo }` where `SessionInfo = { id, projectId, title, status }`. |
| `session:agentStatus` | `{ sessionId, state: 'working' \| 'blocked' \| 'done' \| 'idle' \| 'unknown' }`. |
| `session:exit` | `{ sessionId, code }`. |
| `inbox:appended` | `{ id }` — new inbox entry id. |
| `inbox:removed` | `{ id }` — removed inbox entry id. |
| `schedule:changed` | `{}` (empty — re-read scheduled tasks as needed). |
| `mcp:changed` | `{}` (empty — re-read MCP config as needed). |
| `skills:changed` | `{}` (empty — re-read installed skills as needed). |

Treat payloads as immutable, and don't assume any delivery ordering between
distinct event types. `SessionInfo` is a deliberately minimal SDK-owned
projection of core's richer session — stable across versions.

## Cache — `host.cache`

`host.cache` is a **synchronous, in-memory** scratch store private to the
extension: `get(key)`, `set(key, value)`, `delete(key)` — no Promises. Its
contents **survive panel unmount** (unlike React state, which is torn down when
the nav switches away), so it's the right home for ephemeral working data you
don't want to recompute on every remount (a fetched list, a counter). It does
**not** persist to disk and is gone on app/extension restart, and it is dropped
when the extension is disabled/removed.

`cache` vs `storage`:

| | `host.cache` | `host.storage` |
|---|---|---|
| Sync/async | synchronous (no `await`) | async (`Promise`) |
| Lifetime | in-memory; survives unmount; gone on restart/disable | persisted to disk; survives restart |
| Use for | ephemeral, cheap-to-lose working data | durable view preferences (selected sprint, …) |

## Cleanup — `host.register` (auto-dispose)

`host.register(disposable)` hands the host a `() => void` cleanup function to run
for you at the right time — you never have to thread an unsubscribe through React
state or remember to release it. In a **panel**, registered disposables run on
**unmount**; in **background** code (a runtime bundle's `commands`/`navBadge`,
or work kicked off outside a panel), they run when the extension is
**disabled/removed**. This is the same scope `host.on`/`host.subscribe` register
into, so a mix of event subscriptions and your own resources all tear down
together.

```ts
React.useEffect(() => {
  const timer = setInterval(poll, 5_000);
  host.register(() => clearInterval(timer)); // cleared on unmount
  const ws = new WebSocket(url);
  host.register(() => ws.close());
}, []);
```

Two guarantees worth relying on:

- **Idempotent** — a disposable runs **at most once**, even if you also call it
  yourself. So `const off = host.on(...); host.register(off);` and later calling
  `off()` is safe: the underlying teardown fires exactly once.
- **Late registration is not a leak** — registering a disposable *after* the
  scope has already disposed runs it **immediately**, so a resource acquired in a
  race with unmount is still released.

On the **main side**, `ctx.register(disposable)` is the twin: registered
disposables run on `teardown` (extension disable / uninstall / hot-reload),
**after** your `MainModule.teardown()`, so a disposable can still observe state
your `teardown()` cleaned up. Same idempotency + throw-isolation (one disposable
throwing is logged and doesn't block the rest).

```ts
setup(ctx) {
  const sub = source.subscribe(onFrame);
  ctx.register(() => sub.unsubscribe()); // runs on teardown, after teardown()
  return { /* capabilities */ };
}
```

Manual cleanup still works everywhere — `register` is a convenience, not a
requirement. In tests, `createMockHost()` / `createMockMainContext()` collect
registered disposables into a non-enumerable `__disposables` array you can assert
on and drain to simulate unmount/teardown (see `@zana-ai/zcc-extension-sdk/testing`).

## Host UX primitives — `confirm` / `quickPick` / `prompt` / `alert` / `withProgress`

The host renders five modal/interactive primitives on your behalf so you never
have to build (or restyle) a dialog. They are **promise-based**, drawn by the
shell on its shared `Modal` primitive, and **inherit the app theme + a11y** —
your extension injects **no CSS** and needs **no permission token** for any of
them.

```ts
// Renderer (ModuleHost) — all five:
const ok = await host.confirm({
  title: 'Delete 3 tickets?',
  body: 'This cannot be undone.',
  confirmLabel: 'Delete',
  danger: true              // renders the confirm button as destructive
});                         // → boolean (false on cancel / backdrop / Esc)

const branch = await host.quickPick(
  [{ label: 'main', value: 'main' }, { label: 'develop', value: 'develop' }],
  { title: 'Pick a branch', placeholder: 'Filter…' }
);                          // → the picked item's `value` (T) | null

const name = await host.prompt({
  title: 'New sprint name', placeholder: 'Q3 polish', initialValue: ''
});                         // → string | null (null on cancel)

const action = await host.alert({
  title: 'Build finished', body: 'All green.', kind: 'info',
  actions: [{ id: 'open', label: 'Open report' }]
});                         // → the clicked action id | null (dismissed)

const result = await host.withProgress(
  async (signal) => doLongThing(signal),   // pass `signal` to make it cancellable
  { title: 'Migrating…', cancellable: true }
);                          // resolves/rejects with the task's result
```

Notes:

- **`confirm` returns `false`, `quickPick`/`prompt`/`alert` return `null`** on
  cancel, backdrop click, or Esc — always the safe/no-op value, never a throw.
- **`withProgress`** shows a non-dismissable spinner while your task runs and
  resolves/rejects with whatever the task returns. If `cancellable: true`, a
  Cancel button aborts the passed `AbortSignal` — your task decides what that
  means; the modal closes when the task settles either way.
- **`confirm` and `alert` are ALSO reachable from a headless main module** via
  `ctx.host.confirm(...)` / `ctx.host.alert(...)` (same shape, plain data). The
  shell renders the dialog and the human's answer round-trips back to main. On a
  **windowless host** these **fail closed** — `confirm` → `false`, `alert` →
  `null` — immediately, so a background watcher's destructive-action gate degrades
  safe rather than hanging. (`quickPick` / `prompt` / `withProgress` are
  renderer-only.)
- Mocks: `createMockHost()` returns `confirm → false`, `quickPick → null`,
  `prompt → null`, `alert → null`, and `withProgress` runs the task with a fresh
  `AbortSignal` — override per test.

## Durable notifications — `ctx.inbox.push` (requires `inbox:push`)

`ctx.host.alert` above is **ephemeral** — it renders a one-off dialog and its
answer isn't kept anywhere. When your main module has something the user
should be able to come back to later — a background job finished, a scheduled
check found something worth a look — push it to the Inbox instead:

```ts
// Main module (MainModuleContext) — requires the `inbox:push` permission:
const { id } = await ctx.inbox!.push({
  projectId: myProjectId,
  comments: 'Nightly build finished with 2 warnings.',
  docs: [{ path: 'build/report.html' }]   // optional, relative to the project
});
```

This appends a real, persisted Inbox entry — it counts toward the bell's
unread badge and survives a restart, unlike `alert`. The host stamps the entry
with your extension's id (`extensionSource`) from its own authenticated record
of who's calling, never from anything you pass — you cannot forge another
extension's provenance or push to a project you don't have access to (an
unknown `projectId` is rejected). `ctx.inbox` is absent unless `inbox:push` is
granted; check for it before calling.

### Click-navigation targets

By default, clicking the notification this produces — the native OS alert
fired for a `notify: 'loud'` entry, or the row in the bell's slide-over drawer —
opens that specific entry in the full Inbox. If your extension has its own
surface that's a better place to land (a project-tab panel showing the build
report itself, say, rather than a generic Inbox message about it), tell the
host where to go with `target`:

```ts
const { id } = await ctx.inbox!.push({
  projectId: myProjectId,
  comments: 'Nightly build finished with 2 warnings.',
  docs: [{ path: 'build/report.html' }],
  target: { moduleId: 'my-extension-id' }   // must be YOUR OWN module id
});
```

`target.moduleId` must name your own extension (the id declared in
`extension.json`) — the host rejects a push whose `target` names any other
module, even from the authenticated brokered path, so one extension can never
redirect a click into a sibling's surface. This is checked twice: once at push
time (reject if the id isn't yours), and again at click time against the *live*
module registry, so a stale `target` degrades gracefully — if your extension
has since been disabled or uninstalled, the click just falls back to the
default Inbox landing instead of going nowhere.

Where the click lands depends on how your module is declared:
- A module with a `projectTab` contribution opens that project's tab for the
  entry's `projectId` (the user is taken into that project, on your tab).
  Requires `panel` — a project tab with no panel to render is treated as if it
  weren't there.
- A module without `projectTab` (a plain sidebar module) just switches the
  nav to your module id, scoped to the entry's project.

## Contributions — `commands`, `navBadge`, and `background` (panel now optional)

A module contributes through any subset of three extension points on the
`AppModule`: `panel`, `commands`, and `navBadge`. **`panel` is now optional** —
a module may contribute only `commands` and/or a `navBadge`. A panel-less module
still gets a sidebar nav entry; selecting it renders a small placeholder
(`.module-no-panel`) rather than a view.

```ts
// On the AppModule (the module manifest object), NOT the RendererEntry:
commands: (host) => [
  { id: 'say-hi', label: 'Hello: say hi', keywords: ['greet'], run: () => host.toast('hi') }
],
navBadge: (host) => host.listProjects().length, // number | string | null (null/0/'' → no badge)
```

- **`commands(host)`** returns `ExtensionCommand[]` (`{ id, label, run, keywords? }`).
  Core merges them into the command palette (⌘K), namespaced `ext:<moduleId>:<id>`,
  grouped under the module title, each throw-isolated.
- **`navBadge(host)`** returns a `number | string | null` rendered in the
  sidebar's `.nav-badge` slot. Keep it **cheap and synchronous** — it may be
  invoked on every render. For a precisely-live badge, recompute off
  `host.cache` / state updated from a `host.on` subscription.

### Runtime bundles contribute `commands` / `navBadge` / `background` too

A **runtime-loaded** extension reaches these extension points by
returning the richer shape from `activate()`. `activate` may return EITHER the
panel component directly (the original shape) OR an `ActivateResult`:

```ts
import type { RendererEntry, ModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';

const entry: RendererEntry = {
  activate({ React, host }) {
    const Panel = () => React.createElement('div', null, host.moduleId);
    const Background = () => {
      React.useEffect(() => {
        // Start extension-owned polling or subscriptions here.
      }, []);
      return null;
    };
    return {
      panel: Panel,                                  // optional
      background: Background,                         // optional, always mounted
      commands: (h) => [                             // optional
        { id: 'ping', label: 'Hello: ping', run: () => h.toast('pong from hello') }
      ],
      navBadge: (h) => h.listProjects().length       // optional — number | string | null
    };
  },
};
export default entry;
```

`ActivateResult` is `{ panel?, settingsPanel?, background?, commands?, navBadge? }`.
`commands` and `navBadge` use the **exact same `(host) => …` signatures** as the
`AppModule` fields above. The host loader normalizes the return — a bare component
becomes `{ panel }`, an object preserves valid component contributions — then copies
them onto the module. `background` mounts through `ModuleBackgroundHost`, outside
all navigation conditions, and stays mounted for the app session while the extension
remains loaded. It receives the cached module host and should render `null` after
starting its extension-owned effects. A background alone is not a visible extension
contribution; return a panel, settings panel, command, or badge too. Returning just
the component (no `commands` / `navBadge`) remains fully supported. See the
[`hello` sample](../tools/create-zcc-extension/sample-hello) — it now returns this richer
shape, contributing a `Hello: ping` command and a project-count badge alongside
its panel.

## Per-project tabs (`projectTab`)

By default an extension surfaces as a top-level entry under the sidebar
**Extensions** group — a cross-project tool. Some extensions are better
expressed as **part of a project's workspace**, sitting next to the built-in
project tabs (Terminals · Explorer · Preview · Library · Tickets) so they feel
integrated rather than off to the side.

Declare `projectTab` in the manifest to opt in:

```json
{
  "id": "framework-example",
  "title": "Framework Example",
  "icon": "Sparkles",
  "entry": { "renderer": "renderer.js", "main": "main.mjs" },
  "engines": { "zccApi": "^1.0.0" },
  "projectTab": { "label": "Framework", "icon": "Sparkles", "order": 50 }
}
```

| Field | Meaning |
|---|---|
| `label` | Tab label. Defaults to the module `title`. |
| `icon`  | lucide-react icon name for the tab. Defaults to the module `icon`. |
| `order` | Sort hint among extension tabs (default `100`); extension tabs always come after core's built-in tabs, ascending by `order` then id. |
| `global` | Optional. `false` opts the extension **out** of its top-level sidebar entry — making it a per-project tab *only*. Absent/`true` keeps the default dual surface (global sidebar entry **and** per-project tab). Use `false` for inherently project-scoped tools (e.g. Consensus decisions) that have no meaningful cross-project view. |

**What it does.** Core mounts the extension's `panel` inside the active
project's workspace, scoped to that project — **in addition** to its global
sidebar entry (unless `projectTab.global` is `false`, which drops the global
entry). With the default (`global` absent/`true`) the same panel surfaces twice:

- **Global sidebar entry** — cross-project. `host.getScopedProjectId()` is `null`.
- **Per-project tab** — bound to one project. Core mounts the panel with a host
  whose `host.getScopedProjectId()` returns that project's id (and
  `host.getActiveProject()` is that project).

A project-aware panel reads `getScopedProjectId()` to decide whether to filter
its data to a single project (see below). Reading it is **opt-in**: a panel that
ignores it renders identically in both surfaces, so adding `projectTab` alone
needs no panel change. A panel that *does* branch on it gets a global view and a
focused per-project view from one component.

With `projectTab.global: false` the panel surfaces **once** — the per-project tab
only — and `getScopedProjectId()` is always non-null there. `global:false` only
hides the sidebar entry; it does **not** scope your data for you, so a
project-tab-only panel must still branch on `getScopedProjectId()` to filter.

**How the panel scopes itself.** Branch on `getScopedProjectId()`: non-null
means "you're a project tab — show only this project"; null means "you're the
global sidebar view — show everything".

```ts
function Panel({ host }) {
  const scopedId = host.getScopedProjectId();              // null in the sidebar
  const scoped = scopedId
    ? host.listProjects().find((p) => p.id === scopedId)   // { id, name, path } | undefined
    : null;
  // …fetch globally, then `if (scoped) filter rows to scoped.path`.
}
```

Core re-mounts the project tab per project (fresh effects), mirroring the
built-in Explorer / Tickets tabs. Scope your module's `host.cache` / `storage`
keys by `scopedId` so the global and per-project surfaces don't clobber each
other's snapshot. In a **per-project window** the tab also appears on the left
rail (`ProjectScopedNav`).

**Decoupling note (for core maintainers).** This is fully data-driven: core
discovers `projectTab` from the manifest and renders a generic tab + a generic
`ProjectExtensionTab` mount. Core never names a concrete extension in its tab
logic (engineering Rule 6) — the selector `selectProjectTabModules` and the
`ProjectExtensionTab` component take any module by id. The persisted per-project
view (`AppConfig.workspaceModes`) stores the module id as an opaque string; an
id whose extension is later uninstalled is tolerated (falls back to the default
view).

## Framework presets (`agentPreset`)

Some extensions wrap a whole *way of working* — an orchestration surface, a CLI,
a decision ritual. Declaring `agentPreset` lets your extension contribute a
**framework preset** to the Advanced view of the Quick-Agent launcher (Agents →
"+" → **Advanced** → **Framework**). Picking it spawns a harness session with your
`systemPrompt` injected via `--append-system-prompt`, so the agent boots already
fluent in your framework's concepts, tools, and conventions — no per-launch
copy-paste of a primer.

Declare `agentPreset` in the manifest:

```json
{
  "id": "framework-example",
  "title": "Framework Example",
  "icon": "Sparkles",
  "entry": { "renderer": "renderer.js", "main": "main.mjs" },
  "engines": { "zccApi": "^1.0.0" },
  "agentPreset": {
    "label": "Framework Example",
    "description": "Drive this framework's local tools and repeatable workflows.",
    "icon": "Sparkles",
    "model": "opus",
    "initialPrompt": "Run the framework's status command to orient before starting work.",
    "systemPrompt": "You are operating with the Framework Example tools. Use its documented workflow and preserve the user's approval boundaries."
  }
}
```

| Field | Meaning |
|---|---|
| `systemPrompt` | **Required.** The framework primer, injected verbatim as `--append-system-prompt`. A preset with no (or blank) primer is **dropped at discovery** — it would be indistinguishable from a bare launch. Make it a real orientation: what the framework is, its key tools/commands, and how to work in it. |
| `label` | Chip label in the launcher. Defaults to the manifest `title`. |
| `description` | One-line text shown as the chip's tooltip. |
| `icon` | lucide-react icon name for the chip. Defaults to the manifest `icon`. |
| `initialPrompt` | Optional opening turn written to the session after spawn (claude-family only), e.g. "Run `/zana:status` to orient." Dropped when the user typed their own task (their turn runs alone); used as the first turn when the prompt box was empty. |
| `model` | Model hint → `--model`. One of `opus` / `sonnet` / `haiku` / `default`. A value outside this set is silently dropped. |
| `baseProfile` | Which base profile to launch on — `claude` or `claude-yolo`. Defaults to `claude`. A framework primer only makes sense on a fresh claude session, so `shell`/`claude-resume` are ignored. |

**How it launches.** The preset shares the launcher's *persona slot*: picking a
framework and picking a curated persona are mutually exclusive (an explicit
persona wins). Core mints an ephemeral, host-stamped persona from your preset
(`appendSystemPrompt` = your primer, provenance `{ extensionId }`) and launches
it through the **same audited persona → `--append-system-prompt` path** any
persona uses. There is no bespoke per-framework code path.

**Decoupling note (for core maintainers).** Fully data-driven, like `projectTab`:
core discovers presets by scanning installed manifests and never names a concrete
extension in launch logic (engineering Rule 6). main **re-reads the primer from
its own copy of the manifest** at launch, keyed only by the extension id the
renderer passes back — renderer-supplied primer text is never trusted (Rule 1).
`parseAgentPreset` (`discovery.ts`) sanitizes every field structurally and narrows
`model`/`baseProfile` to their enums.

**Shipping note.** The launcher only lists presets from **enabled** extensions.
Adding `agentPreset` is a new capability, so bump the extension `version` — the
boot-time reseed only refreshes an installed extension when the bundled version is
strictly newer, otherwise an already-installed copy keeps its old (preset-less)
manifest.

## The main module (optional)

`main.js` default-exports a `MainModule`. `setup(ctx)` runs once at boot and
returns a map of named capabilities; the panel reaches each via
`host.call('<name>', ...args)`. A disk extension runs its main module in an
isolated utility process, using the permission-gated `ctx` capabilities for host
and OS access. Return values are structured-cloned over IPC, so they must be
JSON-serialisable. Add `teardown()` to release timers/watchers/child processes
on disable.

```ts
import { defineMainModule } from '@zana-ai/zcc-extension-sdk';
export default defineMainModule({
  id: 'hello',
  setup(ctx) {
    return { async ping(name: string) { ctx.log(`ping ${name}`); return { ok: true }; } };
  },
});
```

## Contributing Personas & Teams

A main module may contribute reusable **Personas** (named `claude` flag bundles) and **Teams** (a bundle of personas that opens N tabs when launched) into ZCC's core registries. They surface in the Personas/Teams panels, the `list_personas`/`list_teams` MCP tools, and the `zcc personas/teams ls` CLI.

```ts
setup(ctx) {
  ctx.personas?.register([
    { name: 'Reviewer', baseProfile: 'claude', appendSystemPrompt: '…' },
  ]);
  ctx.teams?.register([
    { name: 'Review Crew', slots: [{ personaId: 'ext:<your-id>:reviewer', quantity: 2 }] },
  ]);
  return { /* capabilities */ };
}
```

Key facts:
- **In-memory & lifecycle-bound.** Never written to disk; cleared automatically on teardown / disable / crash / hot-reload.
- **Declarative, not additive.** Calling `register` again **replaces** this extension's full set; `clear()` empties it. (Note: `clear()` on either service clears both this extension's personas and teams.)
- **Host-stamped provenance.** You never name yourself — the host stamps `source: { extensionId }` from the authenticated calling module and namespaces every id as **`ext:<your-id>:<slug>`**, so there is no collision with builtin/user/project personas.
- **Sanitized + bounded.** Every input passes core's shared persona/team sanitizer; bounded at **50 personas / 20 teams per extension, 16 tabs per team slot**.
- **No permission token required.** Registration is inert metadata; the dangerous half (launch argv) is gated at the existing launch path, not at registration.
- Types: `PersonaInput` / `TeamInput` from the SDK. A `TeamSlot` is `{ personaId, quantity?, label? }`; a `Team` is `{ id, name, slots, orchestratorPersonaId?, initialPrompt?, … }`.

## Contributing Skills & MCP servers (`agent:contribute`)

Unlike Personas/Teams (pure in-memory data ZCC owns end-to-end), a **skill** is
a `SKILL.md` file compatible agent sessions on the machine can load, and an
**MCP server** contribution is a server *definition* your extension owns (an
arbitrary `command`/`args`/`url`) — both are artifacts that outlive your
process and are consumed by `claude` CLI processes ZCC doesn't control. So
these are **declared in the manifest**, not registered at runtime via `ctx`:

```jsonc
{
  "permissions": ["agent:contribute"],
  "skills": [
    { "path": "skills/my-skill.md", "slug": "my-skill" }
  ],
  "mcpServers": [
    {
      "name": "my-tools",
      "type": "stdio",
      "command": "my-mcp-server",
      "args": ["--port", "0"],
      "alwaysOn": false
    }
  ]
}
```

Key facts:

- **One permission gates both.** `agent:contribute` covers `skills` and
  `mcpServers` alike — from the user's POV it's the same trust question ("does
  this extension get to expand what my agents can do"), asked once.
- **Namespaced, never colliding.** A skill deploys to
  `~/.claude/skills/ext-<your-id>-<slug>/SKILL.md`; an MCP server registers as
  `ext:<your-id>:<name>`. Both are derived from your **host-authenticated**
  manifest id — you never name yourself.
- **`skills[].path` is confined to your own extension dir** (Rule 2 — the same
  containment check, including symlink-escape defense, that guards
  `entry.main`/`entry.renderer`). An escaping path is dropped, not just that
  one entry blocked.
- **`mcpServers[].command` is a bare basename**, exactly like `execAllowlist`
  — no paths, no shell strings. A `stdio` server needs `command`; a
  `streamable-http`/`sse` server needs `url` instead.
- **`alwaysOn: true`** merges that server into *every* project's `.mcp.json`
  unconditionally, without a persona having to name it — use this for a
  server your extension's whole feature set depends on. Omit it (default
  `false`) and a **persona** can still opt a session into your server by
  naming `ext:<your-id>:<name>` in its own `mcpServers` list.
- **Effective only when enabled + consented.** Same posture as every other
  brokered permission: a declared-but-unconsented extension contributes
  nothing until the user approves it; disabling/uninstalling removes its
  skill dirs and drops its servers from the registry.
- **Skill contributions are bounded**: the host deploys at most 20 skills from
  an extension. Keep the number of MCP server definitions small as well; each
  one expands the agent configuration the host has to maintain.
- Types: `ExtensionSkillContribution` (`{ path, slug? }`) /
  `ExtensionMcpServerContribution` (`{ name, type, command?, args?, url?, env?, alwaysOn? }`)
  from the SDK.

## Build

Use Vite **library mode** — one entry in, one ESM out. The scaffold's renderer
uses `React.createElement` and type-only SDK imports, so it has no runtime React
import to resolve. If you use JSX, hooks imported at module evaluation, or a UI
library such as `lucide-react`, follow [Using JSX, hooks, or a UI library](#using-jsx-hooks-or-a-ui-library-eg-lucide-react): provide host-React shims and
bundle the UI library with your extension. Do not assume the host provides a
resolvable `react` or `lucide-react` package to a blob-imported bundle.

For the main build, externalize `electron` and Node built-ins only when they are
type-only or otherwise absent at runtime. Disk extensions must use brokered
`ctx.exec`, `ctx.fs`, and `ctx.fetch` for OS access; bundle all other runtime
dependencies because the host's `node_modules` is not available to an on-disk
extension.

Output filenames must match the manifest `entry`. The scaffold's
[`vite.config.ts`](../tools/create-zcc-extension/template/vite.config.ts) does
both builds (selected by a `BUILD_TARGET` env var).

## Install & dev loop

You can install an extension three ways, none of which need an app rebuild:

1. **In-app (recommended).** Settings → Extensions → **Open existing
   extension** to choose a local source folder or clone a Git repository. The
   source must contain `extension.json` and its current `dist/` build. Zana
   records it as local authoring source, installs its current build through the
   normal validation path, and gives it **Continue building** and **Reload now**
   actions. With a Creator or shell session open in that source folder, changes
   in `dist/` reload automatically; no app restart is needed. For a one-off
   install with no editable source connection, use **Marketplace** → **Install
   from folder…** (pick a built artifact dir) or **Install from archive…** (a
   published `<id>-<version>.json` bundle). Main validates the
   manifest/id/containment/API and installs atomically; the consent overlay
   gates the first run if the extension declares permissions.
2. **From a marketplace registry.** When `~/.zcc/extension-registry.json` is
    enabled (HTTPS), the Marketplace tab lists shared extensions with
    Install / Update buttons. See `examples/registry/README.md` and the
    [Publishing](#publishing-to-a-marketplace-registry) section below.
3. **By hand (lowest-level dev loop):**
   ```sh
   npm run build
   ID=hello
   mkdir -p ~/.zcc/extensions/$ID
   cp extension.json dist/renderer.js ~/.zcc/extensions/$ID/
   cp dist/main.js ~/.zcc/extensions/$ID/   # only if you ship a main module
   ```

Dev loop: edit `src/` → `npm run build`. An imported editable folder retains
its local source connection, so while a Creator or shell session is rooted in
the source folder, Zana re-packs only `extension.json` + `dist/` and reconciles
the running extension **live**. Use **Reload now** as a manual fallback. A
changed main-bearing extension is respawned out-of-process; no app restart is
needed.

## Enable / disable — when changes take effect

Extensions are enabled/disabled in ZCC (Settings → Extensions) via an
enabled-map (modeled on the CLI-plugins loader). What "takes effect" means
depends on whether the extension ships a main module:

- **Renderer-only extension** (no `entry.main`): enable/disable takes effect
  **immediately** — the panel mounts (or unmounts) on the next render.
- **Main-bearing extension** (`entry.main`): its main side runs **out of process**
  (one `utilityProcess` per extension), so it hot-swaps cleanly:
  - **Enabling** (when the extension is consented) reconciles the disk and
    **spawns the child right away** — `mainActive` flips to `true` and
    `host.call(...)` works without a relaunch. (Pre-P3-A the main module ran
    in-process and an ESM `import()` was cached by URL, so enabling needed a
    relaunch; the out-of-process model forks a fresh child each spawn, so that
    caveat is gone.) An **unconsented** extension still won't spawn until the
    consent overlay is approved (P3-D).
  - **Disabling** tears the live child down **immediately** (its `teardown()`
    runs and its capabilities are dropped).

Dev loop: edit `src/` → `npm run build` → re-copy into the extensions dir. The
`~/.zcc/extensions` file-watcher (or the **Reload** button) reconciles live —
a changed main-bearing extension is respawned out-of-process with the new code,
no app restart needed.

## Publishing to a marketplace registry

Share an extension without rebuilding the app: publish a built artifact dir into
a static, HTTPS-hosted registry that the in-app **Marketplace** browses.

```sh
npm run publish-extension -- <built-artifact-dir> \
  --out dist-registry \
  --base-url https://extensions.example.com \
  [--key ed25519-private.pem]      # optional: sign the release
  [--index dist-registry/index.json]
```

Run `npm run publish-extension -- --help` for the full flag list.

The script (`scripts/publish-extension.mjs`, no dependencies) reads your
`extension.json`, then:

- builds a **dependency-free archive** — `{ "files": { "<name>": "<base64>" } }`,
  exactly what the app's `decodeArchive` expects (no tar/zip). File names may not
  contain `/`, `\`, `..`, or a leading `.`, and `extension.json` must be present.
- computes the `sha256` integrity hash (and, with `--key`, an **Ed25519**
  `signature` over the archive bytes);
- upserts a `RegistryRelease` — `id`, `version`, `zccApi`, `url`, `sha256`,
  optional `signature` + `permissions`, plus catalog fields `title` /
  `description` / `author` / `icon` (read from your manifest) for the browse UI —
  into `index.json` (atomic write, keeps older versions so never-downgrade works).

Serve the `--out` directory over **HTTPS** and point a consumer's
`~/.zcc/extension-registry.json` at the index (`{ "enabled": true, "registryUrl":
"https://…/index.json" }`, optionally `"publicKey"` + `"requireSignature": true`).
The channel is **opt-in and HTTPS-only — the app never reaches a network by
default**. Full hosting walkthrough + a working sample: `examples/registry/README.md`.

## Permissions are ENFORCED for disk extensions (P3-B)

The `permissions` field is **enforced deny-by-default for disk extensions** (the
ones installed under `~/.zcc/extensions/`). Compiled-in built-in modules (today
just **slack**) are **trusted by provenance** and bypass enforcement entirely.
At install the user is shown a plain-language **consent** screen (P3-D) listing
exactly what you declared; the effective grant is `declared ∩ consented`, so an
unconsented extension can do nothing and won't even load, and a later update that
**widens** permissions re-prompts. Declare only what you actually use.

If you use a capability whose permission you didn't declare, the call is
rejected (`PermissionDenied`) and audited.

### Permission vocabulary

| Permission | Grants |
| --- | --- |
| `storage` | the per-extension KV store (`host.storage` / `ctx.storage`) |
| `projects:read` | reading the open-project list / active project |
| `projects:select` | changing the shell's selected project |
| `session:reply` | `host.replyToSession(...)` / `host.writeToSession(...)` — writing to an existing terminal |
| `session:launch` | `host.launchSession(...)` — launching an agent tab |
| `external:open` | `host.openExternal(url)` — opening an http(s) URL |
| `inbox:push` | `host.pushInbox(...)` / `ctx.inbox.push(...)` — pushing a durable inbox entry |
| `ssh:hosts` | `ctx.sshHosts` — contributing structured SSH hosts to the remote-project picker |
| `exec` | `ctx.exec({bin,args})` — run an allowlisted executable (no shell) |
| `fs:read` | `ctx.fs.readFile/readdir` within granted roots |
| `fs:write` | `ctx.fs.writeFile` within granted roots (never `~/.ssh`, `~/.aws`, `~/.zcc`) |
| `net` | `ctx.fetch(url)` to an allowlisted host |
| `mcp` | `ctx.mcp(serverId, tool, args)` — call a host-managed MCP server you don't own |
| `llm:invoke` | `ctx.llm(...)` — make a model call on your quota |
| `stream` | `ctx.stream(endpoint, opts?)` — subscribe to a host-managed live event feed |
| `agent:contribute` | declaring manifest `skills` / `mcpServers` — see below |

Persona/Team registration (`ctx.personas`/`ctx.teams`) needs **no** permission — it is inert declarative data, gated at launch.

### Scoping the brokered capabilities

`exec` / `fs:*` / `net` / `mcp` / `stream` need **scopes** alongside the permission — declared in a
`permissionScopes` block. The bare permission says "may exec"; the scope says
"may exec `git`":

```jsonc
{
  "permissions": ["exec", "fs:read", "net"],
  "permissionScopes": {
    "execAllowlist": ["git"],
    "fsRoots": ["~/work", "./data"],
    "egressAllowlist": ["api.github.com"],
    "mcpAllowlist": ["example-server"],
    "streamAllowlist": ["example.events"]
  }
}
```

`execAllowlist` is basenames only (no paths, no shell). `fsRoots` are
canonicalized and your extension's own dir is always readable. `egressAllowlist`
is hostnames only. `mcpAllowlist` names host-managed server ids and
`streamAllowlist` names host-managed stream handles. Each of those lists, plus
`execAllowlist` and `egressAllowlist`, accepts `["*"]`; `fsRoots` never does.

### Supplying SSH hosts

An extension can augment the host-owned remote-project picker with structured
SSH host records. Declare `ssh:hosts`, register in `setup`, and expose the
matching main capabilities. ZCC always keeps the generic `~/.ssh/config` parser
as a fallback; provider rows are merged with it.

```ts
setup(ctx) {
  void ctx.sshHosts?.register();
  return {
    async listSshHosts() {
      return [{ alias: 'build-box', hostname: 'build.example.com', user: 'dev' }];
    },
    async syncSshHosts() {
      return {
        hosts: [{ alias: 'build-box', hostname: 'build.example.com', user: 'dev' }]
      };
    }
  };
}
```

`listSshHosts()` is required for a provider and `syncSshHosts()` is optional.
`listSshHosts()` returns only `{ alias, hostname?, user?, proxyJump? }` records;
`syncSshHosts()` returns `{ hosts: records, warning?: string }`. The extension
never receives raw access to `~/.ssh`; registration is lifecycle-bound and is
automatically cleared on disable, crash, uninstall, or hot reload.

### Brokered capabilities (`ctx.exec` / `ctx.fs` / `ctx.fetch`)

A disk extension's main module runs **out-of-process** (one isolated child
process per extension — see the trust-boundary design). It cannot reach the
app's main process, other extensions, or the window, and a crash/hang is
isolated. For OS access it uses the **brokered** capabilities on
`MainModuleContext`, performed host-side and gated against your permissions. `MainModuleContext` also exposes `ctx.personas` and `ctx.teams` for contributing personas and teams (non-brokered, no permission gate — see [Contributing Personas & Teams](#contributing-personas--teams)):

```ts
const out = await ctx.exec?.({ bin: 'git', args: ['status', '--short'] });
const text = await ctx.fs?.readFile('/Users/me/work/notes.md');
const res = await ctx.fetch?.('https://api.github.com/repos/x/y');
```

`ctx.exec` takes a **bin + argv** — never a shell string — so there is no
command-injection surface.

- **Result vs. failure.** A process that runs and exits resolves an
  `ExecResult` (`{stdout, stderr, code}`); a non-zero exit still resolves (with
  that `code`), and a process that dies on a signal resolves with `code:null` +
  `signal`. But a **spawn failure** (bin not found) or a **host watchdog kill**
  (your `timeoutMs`, capped at 60s, or the 8 MiB output cap exceeded) **REJECTS**
  — so a hung child surfaces as an error, not a misleading `{code:null}` success.
- **exec PATH residual (S2).** `execAllowlist` gates the **basename** (`git`), not
  the on-disk binary; the bin is resolved against the **host's PATH** at spawn
  time, so whatever is *first* on PATH for that name runs. The host's PATH is the
  user's own trusted environment — an attacker who can prepend a hostile dir to
  it already has local code-execution — so we do not pin a separate PATH. Do not
  treat the allowlist as a guarantee of *which* `git` runs, only of *which names*
  may run.
- **fs is symlink-safe.** `ctx.fs` paths are checked after `realpath()` (the
  resolved real location, with the parent dir resolved for writes to new files),
  so a symlink inside a granted root that points outside it (or at a sensitive
  root like `~/.ssh`) cannot be used to escape — the real target is re-checked
  against your granted roots.

### Renderer-side `host` gates

`host.launchSession`, `host.openExternal`, and `host.pushInbox` are gated against
the same permissions. `launchSession`'s `extraArgs` are additionally sanitized:
flags that would create an over-privileged agent (`--dangerously-skip-permissions`,
`--mcp-config`, `--permission-mode`, `--append-system-prompt`, …) are stripped.

### Honest residual (read this)

The out-of-process child now installs a **Node-builtin denylist** (P3-HARDEN): an
ESM loader hook + a CJS `require` patch + neutered `process.binding`, so an
extension can no longer trivially `import('node:child_process')` / `require('fs')`
to skip the broker. The brokered caps are the only **practical** capability path.
This is **JS-level capability deprivation, not an OS sandbox** — a determined
attacker with a native addon (`process.dlopen`) or a realm-escape exploit could
still reach raw OS access; the true seal is the OS/process permission boundary
(Node `--permission` / sandbox), tracked as a follow-up. So: raw-Node bypass is no
longer a one-liner, but the child is not a hard sandbox.

The renderer-side `host` gates remain **advisory**: all panels currently share one
`window.cc`, so a panel could call core bridges directly; authoritative per-panel
attribution arrives with renderer isolation (a later phase). Treat the platform as
curated-trust for *panels* until that lands.

## Reference

- **Overview & two-tier model:** [`extensions.md`](./extensions.md) — start here
  for the big picture (built-in vs disk, architecture, doc map).
- Contract source: [`packages/extension-sdk/src`](../packages/extension-sdk/src)
  (`index.ts`, `renderer.ts`, `main.ts`).
- Worked sample (maintainable source): [`tools/create-zcc-extension/sample-hello`](../tools/create-zcc-extension/sample-hello).
- Sample source: [`tools/create-zcc-extension/sample-hello`](../tools/create-zcc-extension/sample-hello).
- A real disk extension: [`extensions/zana`](../extensions/zana).
