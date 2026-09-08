---
name: zcc-plugin-authoring
description: Extend Zana itself by writing a plugin — panel, CLI command, skills, settings, storage, HTTP, and SDK surfaces. Use when the user asks to add a capability ZCC does not have yet, or to create/install/reload a plugin with `zcc plugin new`, `install`, `dev`, and `types`.
---

# zcc-plugin-authoring

ZCC grows by plugins. Core is the runtime (threads, hosts, auth, confinement).
A new user-facing capability is a plugin unless it cannot be granted even scoped.

Start from **Plugins → New plugin**, Browse **Create a plugin**, or the composer
**Plugin** action. All seed the same prompt. Send it as an ordinary project
thread — not a dedicated Extensions project. Then:

```bash
zcc plugin new hello --app    # ./zcc-plugin-hello
cd zcc-plugin-hello
zcc plugin install .
```

After install the plugin is live. Then, only as needed:

- Unit-test logic → vitest + `@zana-ai/zcc-plugin-sdk/testing` (no app, no `dev`)
- Check it compiles → `zcc plugin build` (no app, no `dev`)
- Backend-only edit, path install → `zcc plugin reload <id>` (`dev` optional)
- UI (`zcc.app`) edit → `zcc plugin dev` (or `build` then `reload`)

Commands:

- `zcc plugin new <name> [--app] [--dir]` — TypeScript scaffold (`package.json` `zcc` block). Default dest is `./zcc-plugin-<id>`. `--app` adds a frontend; default is server-only.
- `zcc plugin types [dir]` — sync bundled SDK `.d.ts` (`--check` for CI). Look up the API here.
- `zcc plugin install <source>` — `path:` | `git:` | `npm:` | `builtin:<name>`. Path installs load `server.ts` from source.
- `zcc plugin reload <id>` — one-shot HTTP reload. Rebuild is not implied. Needs a running app.
- `zcc plugin dev [dir]` — optional watch loop **after** a path install. On save, rebuilds the declared **app** (unminified), then reloads. Needs a running app. A failed build keeps the last good generation. `--once` skips watch.
- `zcc plugin build [dir]` — one-shot `dist/` compile. No running app. CI / publish. Minified.
- `zcc plugin list` / `zcc plugin logs <id> [-n] [-f]` — inspect status and persisted JSONL logs.
- `zcc plugin run <pluginId> <args…>` — explicit equivalent of a contributed command.

Keep `extension-creator` only for an already-open local working dir. This skill
is the full SDK contract.

A plugin that adds a verb also teaches the next agent: CLI contributions rewrite
the generated `plugin-commands` skill, and plugin + generated skills are
runtime-injected for every provider (not only copies into `~/.claude/skills`).

## Scaffold, install, iterate

Path installs load `./server.ts` via jiti. Published git/npm/builtin packages
declare their JS entry (often under `dist`). `zcc plugin reload <id>` is a
one-shot reload. `zcc plugin dev` is an optional watch loop for UI iteration
after a path install; it is not required to create or run a plugin. `zcc plugin
build` writes `dist/` for CI / publish and needs no running app.

## Server factory

```js
export default function plugin(zcc) {
  zcc.log.info(`${zcc.pluginId} loaded`);
}
```

`zcc` is `ZccPluginApi`. Documented members (growing the SDK without updating
this list fails CI):

- `zcc.pluginId` — stable id derived from `package.json` `name`.
- `zcc.log` — `debug` / `info` / `warn` / `error`.
- `zcc.settings` — `define({ key: { type, label, default? } })` returns
  `{ get(), onChange(listener) }`. Descriptor types:
  `type: "string"`, `type: "boolean"`, `type: "select"` (needs `options`),
  `type: "project"`. String settings may set `secret: true`.
- `zcc.storage` — `storage.kv` (`get` / `set` / `delete` / `list`) and
  `storage.database()` (per-plugin SQLite under `<dataDir>/plugins/<id>/`).
  `database().runScript(sql)`, `prepare(sql)`, `migrate(statements)`, `transaction(fn)`.
- `zcc.http` — `http.route(method, path, handler)` served at
  `/api/v1/plugins/<id>/http<path>`.
- `zcc.rpc` — `rpc.method(name, handler)` for the plugin app via `callPluginRpc`.
  `rpc.register(contract, handlers)` is the typed-contract twin; handlers are
  registered by name and schema is advisory.
- `zcc.realtime` — `realtime.publish(event, payload)`.
- `zcc.background` — `service(name, start)` and `schedule(cron, job)`
  (5-field matcher: minute hour day month weekday; `*`, lists, `*/n`).
  Named `schedule(name, cron, job)` persists the last-fired minute so a 60s
  poll cannot double-fire.
- `zcc.cli` — `cli.register({ name, summary, commands?, run(argv, ctx) })`.
  `name` matches `^[a-z0-9-]+$`. Core `zcc` names always win. Combined
  stdout/stderr is capped at 1MiB (`plugin_cli_output_too_large`, never clipped).
- `zcc.agents` — `contributeInstructions(text | (ctx) => string | null)`, `contributeSkills(rootPaths)`,
  `registerTool({ name, description, inputSchema?, presentation?, execute })`,
  `experimental_registerProvider(declaration)`,
  `experimental_registerPtyHarness(declaration)`,
  `configure(provider)` (returns optional `{ tools, skills, instructions }`
  folded into the generated plugin-instructions skill).
- `zcc.events` — `events.on(name, handler)` for thread lifecycle.
  Names: `"thread.created"`, `"thread.active"`, `"thread.idle"`,
  `"thread.failed"`, `"thread.archived"`, `"thread.deleted"`.
  Payload fields: `name`, `threadId`, `projectId`, optional `thread` DTO,
  `lastAssistantText` (idle), and `error` (failed).
- `zcc.ui` — `ui.requestInput({ threadId, rendererId, title, payload, timeoutMs? })`.
  Pair with `pendingInteraction` so the thread workbench can render the form.
  `ui.registerMentionProvider({ id, label, triggers?, search(ctx), resolve(itemId) })`
  feeds `@` / `#` typeahead. `search` receives `{ query, trigger, projectId?,
  threadId? }` and returns `{ id, label, insertText? }[]`. `resolve` returns
  `{ context }` that the host appends as agent-only text at send.
- `zcc.status` — `status.needsConfiguration(message)`.
- `zcc.sdk` — product SDK. `sdk.threads.spawn({ projectId, prompt, providerId?, parentThreadId? })`
  attributes the thread to this plugin. `sdk.threads.archive` / `fork` /
  `unarchive` take `{ threadId }`. `sdk.inbox.push({ projectId, comments })`
  appends to the product inbox after the host confines `projectId` to a
  registered project. `sdk.projects.list()` returns `{ id, name, path? }[]`.
  Throws when the host has not wired the called member.
- `zcc.host` — optional native bridge. `host.experimental_call(method, input?)`
  and `host.experimental_client()` (`call(method, input, { hostId? })`) dispatch
  to a `zcc.host` worker loaded via `experimental_defineHostEntry`. Throws
  `not available` until that entry (or a test `hostCall`) is wired.
- `zcc.services` — experimental plugin-to-plugin SDK. `services.provide(impl)`
  publishes an in-process object keyed by this plugin's id. `services.use(id)`
  returns a live proxy that always dispatches to the current provider (survives
  reload) and throws `service_unavailable` until that plugin is running and has
  provided. `services.has(id)` is true after that plugin has called `provide`.
  Declare `zcc.requires: ["other-plugin-id"]` so the host loads providers first.
  A required plugin that is not running marks this plugin `needs-configuration`
  (`needs plugin: <id>`) without crashing host `start()`. Do not put a product
  API on `zcc.sdk`. Consumer example (Salesforce platform SDK — types only from
  `@zcc-ext/salesforce/sdk`; never import `createSalesforceSdk` or that
  plugin's internals). Method table: the Salesforce plugin's `SDK.md`.

```ts
import type { SalesforceSdk } from '@zcc-ext/salesforce/sdk';

export default async function plugin(zcc) {
  const sf = zcc.services.use<SalesforceSdk>('salesforce');
  zcc.agents.registerTool({
    name: 'gus_query',
    description: 'SOQL against GUS via the shared Salesforce session',
    execute: async (input) => {
      const page = await sf.query(input.query);
      return page.records;
    }
  });
}
```

  Register agent tools on the **consumer**. Org selection stays on the Salesforce
  tab (`defaultOrg`); `connect()` / `request()` never return `accessToken`.
- `zcc.onDispose(hook)` — cleanup when the plugin unloads.

Branding lives on the manifest (`zcc.name`, `zcc.description`, `zcc.branding`).
Prefer `branding.icon` as a canonical icon name or `./assets/icon.svg` (CSS mask,
`currentColor`). Logo-only marks use `logo.light` / `logo.dark`. There is
**no root logo auto-detection**. Do not duplicate the icon in the panel.
Optional `zcc.themes` (`id`, `name`, `description?`, `css`) inject CSS from
Settings → Appearance. Optional `zcc.host` is the worker entry.

## App slots (`definePluginApp`)

```js
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'main',
    title: 'Hello',
    icon: 'Puzzle',
    path: '/hello',
    component: Panel
  });
});
```

`PluginAppBuilder` exposes `slots`, `composer`, and `contentScripts`.
`isPluginAppDefinition` is the loader's type guard.
`collectPluginApp` / `emptyRegistrationSet` collect registrations in tests.
`threadPanelActionMatchesScope` (with `PLUGIN_THREAD_PANEL_SCOPES` /
`DEFAULT_PLUGIN_THREAD_PANEL_SCOPES`) filters New Tab rows by `"thread"` or
`"agent-session"`.

Frontend runtime exports you may import from `@zana-ai/zcc-plugin-sdk/app`:
`definePluginApp`, `isPluginAppDefinition`, `callPluginRpc`,
`getPluginSettings`, `setPluginSettings`, `collectPluginApp`,
`emptyRegistrationSet`, `PLUGIN_THREAD_PANEL_SCOPES`,
`DEFAULT_PLUGIN_THREAD_PANEL_SCOPES`, `threadPanelActionMatchesScope`,
`PLUGIN_COMPOSER_SCOPE_KINDS`, `PLUGIN_PROJECT_STATUSBAR_ALIGNS`,
`PLUGIN_NAV_PANEL_PLACEMENTS`, `navPanelListsInSidebar`,
`navPanelListsInExtensionsHub`,
`useRpc`, `useRealtime`,
`useRealtimeConnectionState`, `useSettings`, `useZccContext`,
`useZccNavigate`, `useComposer`, `useComposerView`,
`experimental_useSidebarThreads`, `experimental_useSidebarThreadActions`,
`experimental_useSidebarThreadPullRequest`,
`experimental_useSidebarThreadSplit`, `ThreadChat`, `Markdown`,
`experimental_NewThreadComposer`.

`composer.customize({ id, scopes?, actions?, banners?, plusMenu?, richText?, meta?, advanced? })`
adds chrome on the shared prompt box. `scopes` may include `"cli-agent"` for the
CLI Agent composer (Modern stays `"new-thread"`). `meta` chips land in the
composer meta row; `advanced` fields land in Customize launch.
`useComposer().experimental_setLaunchPatch({ extraArgs?, profileId?, harnessRouting? })`
overlays spawn options — the host merges at send, and main still authorizes.
`contentScripts.register({ id, mount })`
runs a headless same-origin script with an `AbortSignal` on unload.

`PluginAppSlots` (every slot name and its props):

- `navPanel` — registration fields `id`, `title`, `icon`, `path`, `placement`
  (`sidebar` | `extensions` | `unlisted` via `PLUGIN_NAV_PANEL_PLACEMENTS`, default `sidebar`), `component`,
  `headerContent`, `experimental_sidebarAccessory`.
  Component props: `pluginId`, `subPath`. `placement: "extensions"` lists the
  page under Plugins instead of the global sidebar. `placement: "unlisted"` is a
  full `/plugins/<id>/<path>` page with no rail row and no hub listing — open it
  from `sidebarFooterAction` or `commandPaletteAction` via `toPluginPanel`.
- `settingsSection` — `id`, `title`, `description`, `component`. Props: `pluginId`.
- `homepageSection` — `id`, `title`, `component`. Props: `pluginId`, `projectId`.
- `projectTab` — `id`, `label`, `icon`, `order`, `global`, `component`.
  Props: `pluginId`, `projectId`.
- `sidebarFooterAction` — `id`, `title`, `icon`, `run`. `run` receives
  `{ openSettings(), toPluginPanel(path) }`. `openSettings()` opens this plugin’s
  Plugins hub detail. `toPluginPanel` opens a `navPanel` route.
- `projectStatusbarItem` — a chip on the project statusbar (path/git
  strip). Registration: `id`, `align` (`"left"` | `"right"`, default `"right"`;
  `PLUGIN_PROJECT_STATUSBAR_ALIGNS`), `order`, `tooltip`, `icon`, `label`
  (required unless `item` is set), `item` (live React chrome), `component`
  (modal body), `run`. `run` (and `item` / dialog props) receive `projectId`,
  `toProject`, `toPluginPanel`, `openDialog({ title?, params? })`, and
  `openMenu([{ id, label, icon?, disabled?, run }])`. Call `openDialog()` to
  mount `component`; `openMenu` opens a host popup anchored to the chip.

```ts
app.slots.projectStatusbarItem({
  id: 'orgs',
  align: 'right',
  icon: 'Cloud',
  label: 'orgs',
  component: OrgPicker,
  run: (ctx) => {
    ctx.openMenu([
      { id: 'prod', label: 'Production', run: () => ctx.openDialog({ title: 'Switch org' }) },
      { id: 'soql', label: 'Open SOQL', run: () => ctx.toProject(ctx.projectId, { tabId: 'soql' }) }
    ]);
  }
});
```
- `pendingInteraction` — `id` must match `rendererId` passed to
  `zcc.ui.requestInput`. Component props: `interaction`, `submit`, `cancel`.
- `threadPanelAction` — a closable tab in the thread right-hand side panel.
  Registration: `id`, `title`, `icon`, `component`, `layout` (`padded` | `flush`),
  `scopes` (`"thread"` | `"agent-session"`, default `["thread"]`), `run`.
  Props: `pluginId`, `threadId`, `params`. `threadId` is the thread, or the
  CLI-agent session id when opened from an agent-session side panel.
  Listed in + / New Tab. Omit `run` to open immediately; otherwise
  `run({ threadId, openPanel })` may call `openPanel({ title?, params? })`.
  Message actions and the command palette also receive `openPanel`.
- `experimental_newThreadPanelAction` — same registration fields; props
  `pluginId`, `projectId`, `params`.
- `experimental_threadList` — `id`, `title`, `description`, `component`.
  Exclusive replacement of the Agents list. Props: `pluginId`,
  `activeThreadId`, `activeProjectId`, `isCompactViewport`, `onNavigate`,
  `searchQuery`, `experimental_Original`.
- `experimental_threadHeaderAction` — `id`, `title`, `component`. Props:
  `pluginId`, `threadId`, `projectId`, `isCompactViewport`.
- `fileOpener` — `id`, `title`, `extensions`, `component`. Props: `pluginId`,
  `path`, `source`, `lineNumber`, `experimental_Original`.
- `messageDirective` — `id`, `component`. Renders `::name{attr}` leaves.
  Props: `pluginId`, `attributes`, `source`, `message`, `openWorkspaceFile`.
  The host passes a real `openWorkspaceFile(path)` on thread surfaces so a
  card can open a workspace file in the side panel; it is `null` elsewhere.
- `messageAction` — `id`, `title`, `icon`, `run`. Context: `threadId`,
  `message`, `selectedText`, `openPanel`.
- `experimental_agentCardAction` — `id`, `title`, `icon`, `isAvailable`, `run`.
  Context: `sessionId`, `projectId`.
- `experimental_agentsBoardAction` — `id`, `title`, `icon`, `run`. Context:
  `projectId`.
- `experimental_timelineRenderer` — `kind`, `component`. Props: `row`,
  `payload`, `presentation`, `thread`, `Original`.
- `commandPaletteAction` — `id`, `title`, `isAvailable`, `run`. Context:
  `threadId`, `projectId`, `openPanel`, `toPluginPanel`.
- `experimental_projectMenuAction` — `id`, `title`, `icon`, `placement`
  (`project` | `workspace`), `run`. `run` receives `{ projectId }` (`null`
  for `placement: "workspace"`, the Projects header with no project selected)
  and `toProject`.
- `experimental_createProjectAction` — `id`, `title`, `icon`, `component`,
  `run`. `run` receives `pickDirectory()`, `addProject(path)`, `cloneRoot()`,
  `toProject`, and `openDialog({ title?, params? })`. Optional `component`
  mounts in a host modal; dialog props also include `pluginId`, `params`, and
  `close`.
- `experimental_providerIcon` — `providerId`, `icon` (`className` on the
  icon component).

The host React instance is `globalThis.__ZCC_HOST_REACT__`. Plugin UI is not a
security sandbox; registrations apply in reverse registration order when two
plugins claim the same slot id.

Reusable chrome lives in `@zana-ai/zcc-ui` (workspace dependency). For a
pannable status board, import `Kanban` / `KanbanColumn` from
`@zana-ai/zcc-ui/kanban` and inject `@zana-ai/zcc-ui/kanban.css` with the
plugin's own styles (`esbuild` loads `.css` as text). Columns are layout only
— cards are not drag-reordered. Agents and PR Monitor both use this canvas.

Open **Plugin Guide** under Plugins for annotated wireframes of every surface
(Copy for agent). After `plugin install .`, those slots are live. Reload the
backend with `plugin reload <id>`; use optional `plugin dev` to watch UI
edits. In-repo builtins: `ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD=1`.

## Skill channels

Three ways a plugin teaches an agent:

- Manifest `package.json` → `zcc.skills` (directory roots of `SKILL.md`; default
  `["skills"]`; `[]` opts out).
- Runtime `zcc.agents.contributeSkills(rootPaths)`.
- Generated `plugin-commands` from `zcc.cli.register`.

## Closed loop

After install, a **new** thread's catalog includes `plugin-commands` listing
every contributed `zcc <name>`. `zcc hello` (or `zcc plugin run hello-id …`)
runs server-side. Official plugins (`autoInstall: false`) install from the
store on demand (`zcc plugin install tasks`); builtins auto-reconcile.

## Testing a plugin

Unit tests do not need a running ZCC app and do not use `zcc plugin dev`.

Backend: `createFakePluginHost` from `@zana-ai/zcc-plugin-sdk/testing`. Call
`harness.callRpc` and `harness.runCli`. The fake does not reproduce layout,
routing, or crash boundaries. Prefer `storage.kv` — `storage.database()` is an
in-memory stub.

App slots: `loadPluginApp` + `renderSlot` from `@zana-ai/zcc-plugin-sdk/testing/app`.
Pass a thunk (`() => import('./app.tsx')`) so hooks bind after the test runtime
is installed. `renderSlot` mounts with Testing Library; inspect
`slot.inspection.rpcCalls` / `navigateCalls` and unmount with
`slot.lifecycle.unmount()`.

```ts
// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from '@zana-ai/zcc-plugin-sdk/testing/app';

const app = await loadPluginApp(() => import('./app.tsx'));
const slot = renderSlot(app.navPanels[0], { pluginId: 'hello', subPath: '' }, {
  rpc: { list: () => [] }
});
await slot.findByText('No todos yet');
```

Live loop after `zcc plugin install .` (the plugin is already live):

- Backend-only edit → `zcc plugin reload <id>` (`zcc plugin dev` optional)
- UI (`zcc.app`) edit → `zcc plugin dev`, or `zcc plugin build` then `reload`
- Compile check → `zcc plugin build` (no running app)
