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
- `zcc.realtime` — `realtime.publish(event, payload)`.
- `zcc.background` — `service(name, start)` and `schedule(cron, job)`
  (today the schedule timer is a 60s interval, not a real cron parser).
- `zcc.cli` — `cli.register({ name, summary, commands?, run(argv, ctx) })`.
  `name` matches `^[a-z0-9-]+$`. Core `zcc` names always win. Combined
  stdout/stderr is capped at 1MiB (`plugin_cli_output_too_large`, never clipped).
- `zcc.agents` — `contributeInstructions(text)`, `contributeSkills(rootPaths)`,
  `registerTool({ name, description, inputSchema?, execute })`,
  `experimental_registerProvider(declaration)`.
- `zcc.events` — `events.on(name, handler)` for thread lifecycle.
  Names: `"thread.created"`, `"thread.active"`, `"thread.idle"`,
  `"thread.failed"`, `"thread.archived"`, `"thread.deleted"`.
  Payload fields: `threadId`, `projectId`.
- `zcc.ui` — `ui.requestInput({ threadId, rendererId, title, payload, timeoutMs? })`.
  Pair with `pendingInteraction` so the thread workbench can render the form.
- `zcc.status` — `status.needsConfiguration(message)`.
- `zcc.sdk` — product SDK. `sdk.threads.spawn({ projectId, prompt, providerId? })`
  attributes the thread to this plugin. Throws when the host has not wired spawn.
- `zcc.host` — optional native bridge. `host.experimental_call(method, input?)`
  is a stub and throws until a real host API exists. Do not use it to extract
  keep-awake or machines.
- `zcc.onDispose(hook)` — cleanup when the plugin unloads.

Branding lives on the manifest (`zcc.name`, `zcc.description`, `zcc.branding`).
Prefer `branding.icon` as a canonical icon name or `./assets/icon.svg` (CSS mask,
`currentColor`). Logo-only marks use `logo.light` / `logo.dark`. There is
**no root logo auto-detection**. Do not duplicate the icon in the panel.

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

`PluginAppBuilder` currently exposes `slots` (no `composer` / `contentScripts`
on this host). `isPluginAppDefinition` is the loader's type guard.

Frontend runtime exports you may import from `@zana-ai/zcc-plugin-sdk/app`:
`definePluginApp`, `isPluginAppDefinition`, `callPluginRpc`,
`getPluginSettings`, `setPluginSettings`.

`PluginAppSlots` (every slot name and its props):

- `navPanel` — registration fields `id`, `title`, `icon`, `path`, `component`.
  Component props: `pluginId`, `subPath`.
- `settingsSection` — `id`, `title`, `description`, `component`. Props: `pluginId`.
- `homepageSection` — `id`, `title`, `component`. Props: `pluginId`, `projectId`.
- `projectTab` — `id`, `label`, `icon`, `order`, `global`, `component`.
  Props: `pluginId`, `projectId`.
- `sidebarFooterAction` — `id`, `title`, `icon`, `run`.
- `pendingInteraction` — `id` must match `rendererId` passed to
  `zcc.ui.requestInput`. Component props: `interaction`, `submit`, `cancel`.

The host React instance is `globalThis.__ZCC_HOST_REACT__`. Plugin UI is not a
security sandbox; registrations apply in reverse registration order when two
plugins claim the same slot id.

## Closed loop

After install, a **new** thread's catalog includes `plugin-commands` listing
every contributed `zcc <name>`. `zcc hello` (or `zcc plugin run hello-id …`)
runs server-side. Official plugins (`autoInstall: false`) install from the
store on demand (`zcc plugin install tasks`); builtins auto-reconcile.
