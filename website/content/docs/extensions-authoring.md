# Plugin authoring

Scaffold with `zcc plugin new <name> [--app]`, then install in place:

```
cd zcc-plugin-<id>
zcc plugin install .
zcc plugin dev
```

Path installs load `./server.ts` from source. Published git/npm/builtin packages
declare their JS entry (often under `dist`).

## Verify in running ZCC

New scaffolds include `AGENTS.md`, `CLAUDE.md`, and `LIVE_TEST.md` so each agent
has the same build and verification instructions. For a single agent-driven
iteration, use `zcc plugin dev --once` from the installed source directory.
It rebuilds the UI, reloads the plugin, and returns nonzero if compilation or
the resulting backend health fails. `plugin reload <id>` checks backend health
too, including a rejected replacement that left the previous generation running.

The CLI resolves `plugin install .` from your current directory and compiles
the frontend before installing it. Its packaged build includes the build engine
and SDK app facade. Third-party plugin dependencies and unit-test dependencies
still need `npm install --include=dev`.

Open the plugin in ZCC and exercise its primary action. For the todo starter,
add and toggle an item, then confirm it with `zcc plugin run <id> list`. Edit
the panel, reload, and verify the open panel updates while saved data survives.
Agents can use their available computer-use tool to do this directly. A successful
command does not prove the UI rendered; report any UI checks that could not run.

Keep `ZCC_SERVER_URL` and `ZCC_DATA_DIR` on the same running instance: normally
port 8780 and `~/.zcc`; dev uses port 8781 and `~/.zcc-dev`. Diagnose backend
failures with `zcc plugin logs <id> -n 50`.

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
    },
    "requires": ["salesforce"]
  }
}
```

- `skills` omitted → default `["skills"]`. `[]` opts out.
- A skill is `skills/<name>/SKILL.md` (directory name is the skill name).
- `mcpServers` is ZCC-only (Claude CLI / PTY via `~/.zcc/mcp/<projectId>.json`). Host namespaces keys as `plugin:<id>:<name>`. Conversation threads do not read this map — use `zcc.agents.registerTool` (`parameters`: Zod or JSON Schema). A plugin that must work on both surfaces declares both. There is no runtime `registerMcpServer`.
- `extra` is an opaque bag. The host does not execute it. Keep `zcc` strict — unknown keys outside `extra` fail install.
- `requires` lists other plugin ids this plugin consumes via `zcc.services.use`. The host loads those plugins first. A cycle marks both `degraded`. A required plugin that is not running marks the consumer `needs-configuration` (`needs plugin: <id>`).

## Server factory

```js
/** @typedef {import('@zana-ai/zcc-plugin-sdk/server').ZccPluginApi} ZccPluginApi */
export default function plugin(zcc) {
  zcc.rpc.method('ping', () => ({ ok: true }));
  zcc.onDispose(() => {});
}
```

To consume another plugin's SDK, declare `zcc.requires` and call
`zcc.services.use(id)` (live proxy; throws `service_unavailable` until that
plugin has `provide`d). Probe with `zcc.services.has(id)` before calling.
Import **types** from that plugin's published SDK, not its internals. Example:
`import type { SalesforceSdk } from '@zcc-ext/salesforce/sdk'`.

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
    run: ({ toPluginPanel }) => {
      toPluginPanel('main');
    }
  });
  app.slots.projectStatusbarItem({
    id: 'orgs',
    align: 'right',
    icon: 'Cloud',
    label: 'orgs',
    run: (ctx) => {
      ctx.openMenu([
        { id: 'prod', label: 'Production', run: () => ctx.openDialog({ title: 'Switch org' }) },
        { id: 'soql', label: 'Open SOQL', run: () => ctx.toProject(ctx.projectId, { tabId: 'soql' }) }
      ]);
    }
  });
  app.slots.experimental_createProjectAction({
    id: 'notes-project',
    title: 'Notes project',
    icon: 'Notebook',
    run: (ctx) => {
      ctx.openDialog();
    }
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
