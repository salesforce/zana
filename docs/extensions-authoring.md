# Plugin authoring

Scaffold with `zcc plugin new <name> [--app]`, then install in place:

```
cd zcc-plugin-<id>
zcc plugin install .
zcc plugin dev
```

Path installs load `./server.ts` from source. Published git/npm/builtin packages
declare their JS entry (often under `dist`).

## package.json

```json
{
  "name": "zcc-plugin-tasks",
  "version": "0.1.0",
  "engines": { "zcc": ">=1.0.0", "zccPluginSdk": ">=0.1.0" },
  "zcc": {
    "name": "Tasks",
    "description": "Task board",
    "branding": { "icon": "ListTodo" },
    "server": "./server.ts",
    "app": "./app.tsx"
  }
}
```

The plugin id is derived from the package name (`zcc-plugin-tasks` → `tasks`).

Skills, MCP, and extra notes live in the same `zcc` block (BB’s `bb.skills` shape):

```json
{
  "zcc": {
    "name": "Docs",
    "description": "Project library",
    "branding": { "icon": "Library" },
    "server": "./server.ts",
    "app": "./app.tsx",
    "skills": ["skills"],
    "mcpServers": {
      "library": {
        "type": "stdio",
        "command": "node",
        "args": ["./dist/mcp-server.mjs"],
        "alwaysOn": true
      }
    },
    "extra": {
      "notes": "Forward-compat keys go here. Do not put tokens in extra."
    }
  }
}
```

- `skills` omitted → default `["skills"]`. `[]` opts out.
- A skill is `skills/<name>/SKILL.md` (directory name is the skill name).
- `mcpServers` is ZCC-only (Claude CLI). Host namespaces keys as `plugin:<id>:<name>`.
- `extra` is an opaque bag. The host does not execute it. Keep `zcc` strict — unknown keys outside `extra` fail install.

## Server factory

```js
/** @typedef {import('@zana-ai/zcc-plugin-sdk/server').ZccPluginApi} ZccPluginApi */
export default function plugin(zcc) {
  zcc.rpc.method('ping', () => ({ ok: true }));
  zcc.onDispose(() => {});
}
```

The factory is time-boxed. A hang or throw marks the plugin `degraded` without
wedging the server. Plugins never receive host-daemon credentials.

## App slots

```js
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'main',
    title: 'Tasks',
    icon: 'ListTodo',
    component: TasksPanel
  });
  app.slots.settingsSection({ id: 'settings', component: TasksSettings });
  app.slots.homepageSection({ id: 'open', title: 'Open tasks', component: OpenTasks });
  app.slots.projectTab({
    id: 'tab',
    label: 'Tasks',
    global: false,
    component: ProjectTasks
  });
  app.slots.sidebarFooterAction({
    id: 'new',
    title: 'New task',
    icon: 'Plus',
    run: () => {}
  });
});
```

Fill the host `.module-panel-slot` (height 100%, own overflow). Shared `gus-*` /
`zana-*` CSS classes live in core `global.css` and cascade into plugin panels.

## Marketplace

Marketplace JSON is **provenance pointers** (`npm:` / `git:` + range), not
file-bundle archives. Refresh never executes code. Install records the exact
npm version or git commit and asks for confirmation.

## Layout

Plugin panels mount in `.module-panel-slot`. Do not set `grid-column` on the
root; fill 100% and put `max-width` only on an inner reading-width wrapper.
