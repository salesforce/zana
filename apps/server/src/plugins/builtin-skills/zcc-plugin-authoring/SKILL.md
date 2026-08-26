---
name: zcc-plugin-authoring
description: Extend Zana Command Center itself by writing a plugin — panel, CLI command, skills, settings, storage, HTTP, and SDK surfaces. Use when the user asks to add a capability ZCC does not have yet, or to create/install/reload a plugin with `zcc plugin new`, `install`, `dev`, and `types`.
---

# zcc-plugin-authoring

ZCC grows by plugins. Core is the runtime (threads, hosts, auth, confinement).
A new user-facing capability is a plugin unless it cannot be granted even scoped.

Any thread can extend ZCC. The Creator dialog is convenience UX, not the only
path. `zcc plugin new` + path install from an ordinary project thread is
first-class.

A plugin that adds a verb also teaches the next agent: CLI contributions rewrite
the generated `plugin-commands` skill, and plugin + generated skills are
runtime-injected for every provider (not only copies into `~/.claude/skills`).

## Scaffold, install, iterate

```bash
zcc plugin new hello --dir ./hello-plugin --app
zcc plugin types ./hello-plugin
zcc plugin install ./hello-plugin
zcc plugin dev ./hello-plugin
```

- `zcc plugin new <name>` — TypeScript scaffold (`package.json` `zcc` block).
- `zcc plugin types [dir]` — sync bundled SDK `.d.ts` (`--check` for CI).
- `zcc plugin install <source>` — `path:` | `git:` | `npm:` | `builtin:<name>`.
- `zcc plugin dev [dir]` — watch, rebuild, reload (`--once` skips watch).
- `zcc plugin run <pluginId> <args…>` — explicit equivalent of a contributed command.

Keep `extension-creator` for the short in-app Creator working-dir loop. This
skill is the full SDK contract.

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
  `database().runScript(sql)`, `prepare(sql)`, `migrate(statements)`.
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
- `zcc.agents` — `contributeInstructions(text)`, `contributeSkills(rootPaths)`,
  `registerTool({ name, description, inputSchema?, execute })`,
  `experimental_registerProvider(declaration)`,
  `configure(provider)` (returns optional `{ tools, skills, instructions }`
  folded into the generated plugin-instructions skill).
- `zcc.events` — `events.on(name, handler)` for thread lifecycle.
  Names: `"thread.created"`, `"thread.active"`, `"thread.idle"`,
  `"thread.failed"`, `"thread.archived"`, `"thread.deleted"`.
  Payload fields: `threadId`, `projectId`.
- `zcc.ui` — `ui.requestInput({ threadId, rendererId, title, payload, timeoutMs? })`.
  Pair with `pendingInteraction` so the thread workbench can render the form.
  `ui.registerMentionProvider({ id, trigger?, search(query) })` feeds `@`
  typeahead (`id`, `label`, optional `insertText`).
- `zcc.status` — `status.needsConfiguration(message)`.
- `zcc.sdk` — product SDK. `sdk.threads.spawn({ projectId, prompt, providerId? })`
  attributes the thread to this plugin. Throws when the host has not wired spawn.
- `zcc.host` — optional native bridge. `host.experimental_call(method, input?)`
  and `host.experimental_client()` (`call(method, input, { hostId? })`) dispatch
  to a `zcc.host` worker loaded via `experimental_defineHostEntry`. Throws
  `not available` until that entry (or a test `hostCall`) is wired.
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

Frontend runtime exports you may import from `@zana-ai/zcc-plugin-sdk/app`:
`definePluginApp`, `isPluginAppDefinition`, `callPluginRpc`,
`getPluginSettings`, `setPluginSettings`, `collectPluginApp`,
`emptyRegistrationSet`, `useRpc`, `useRealtime`,
`useRealtimeConnectionState`, `useSettings`, `useZccContext`,
`useZccNavigate`, `useComposer`, `useComposerView`,
`experimental_useSidebarThreads`, `experimental_useSidebarThreadActions`,
`experimental_useSidebarThreadPullRequest`,
`experimental_useSidebarThreadSplit`, `ThreadChat`, `Markdown`,
`experimental_NewThreadComposer`.

`composer.customize({ id, scopes?, actions?, banners?, plusMenu?, richText? })`
adds chrome on the shared prompt box. `contentScripts.register({ id, mount })`
runs a headless same-origin script with an `AbortSignal` on unload.

`PluginAppSlots` (every slot name and its props):

- `navPanel` — registration fields `id`, `title`, `icon`, `path`, `component`,
  `headerContent`, `experimental_sidebarAccessory`.
  Component props: `pluginId`, `subPath`.
- `settingsSection` — `id`, `title`, `description`, `component`. Props: `pluginId`.
- `homepageSection` — `id`, `title`, `component`. Props: `pluginId`, `projectId`.
- `projectTab` — `id`, `label`, `icon`, `order`, `global`, `component`.
  Props: `pluginId`, `projectId`.
- `sidebarFooterAction` — `id`, `title`, `icon`, `run`. `run` receives
  `{ openSettings() }`.
- `pendingInteraction` — `id` must match `rendererId` passed to
  `zcc.ui.requestInput`. Component props: `interaction`, `submit`, `cancel`.
- `threadPanelAction` — `id`, `title`, `icon`, `component`, `layout`
  (`padded` | `flush`), `run`. Props: `pluginId`, `threadId`, `params`.
- `experimental_newThreadPanelAction` — same registration fields; props
  `pluginId`, `projectId`, `params`.
- `experimental_threadList` — `id`, `title`, `description`, `component`.
  Exclusive replacement of the Agents list. Props: `pluginId`,
  `activeThreadId`, `activeProjectId`, `isCompactViewport`, `onNavigate`,
  `searchQuery`, `experimental_Original`.
- `experimental_threadHeaderAction` — `id`, `title`, `component`. Props:
  `pluginId`, `threadId`, `projectId`, `isCompactViewport`.
- `fileOpener` — `id`, `title`, `extensions`, `component`. Props: `pluginId`,
  `path`, `source`, `experimental_Original`.
- `messageDirective` — `id`, `component`. Renders `::name{attr}` leaves.
  Props: `pluginId`, `attributes`, `source`, `message`, `openWorkspaceFile`.
- `messageAction` — `id`, `title`, `icon`, `run`. Context: `threadId`,
  `message`, `selectedText`, `openPanel`.
- `experimental_providerIcon` — `providerId`, `icon` (`className` on the
  icon component).

The host React instance is `globalThis.__ZCC_HOST_REACT__`. Plugin UI is not a
security sandbox; registrations apply in reverse registration order when two
plugins claim the same slot id.

## Closed loop

After install, a **new** thread's catalog includes `plugin-commands` listing
every contributed `zcc <name>`. `zcc hello` (or `zcc plugin run hello-id …`)
runs server-side. Official plugins (`autoInstall: false`) install from the
store on demand (`zcc plugin install tasks`); builtins auto-reconcile.
