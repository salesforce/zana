# `@zana-ai/zcc-plugin-sdk`

Public contract for Zana Command Center plugins. A plugin is a TypeScript
package whose `package.json` carries a `zcc` block. After install it is
**full-trust in-process code on the server**. It never receives host-daemon
tokens.

```ts
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';

export default function plugin(zcc: ZccPluginApi) {
  zcc.rpc.method('ping', () => 'pong');
}

export default definePluginApp((app) => {
  app.slots.navPanel({ id: 'main', title: 'Tasks', icon: 'ListTodo', component: Panel });
});
```

V1 slots: `navPanel`, `settingsSection`, `homepageSection`, `projectTab`,
`sidebarFooterAction`, `projectStatusbarItem`, `pendingInteraction`. Experimental slots include
`experimental_createProjectAction` (Add project menu) and
`experimental_projectMenuAction` (Organize / row overflow). Open **Plugin Guide**
for the full surface map.

`package.json` `zcc` also declares `skills` (directory roots, default `["skills"]`),
`mcpServers` (Claude CLI map), and `extra` (opaque bag — not executed).

## Testing

The fake host does not reproduce layout, routing, or crash boundaries. Prefer
`storage.kv` in authoring tests — `storage.database()` is an in-memory stub.

```ts
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';

const { zcc, harness } = createFakePluginHost({ pluginId: 'notes' });
export default function plugin(api = zcc) {
  api.rpc.method('ping', () => 'pong');
  api.cli.register({
    name: 'notes',
    summary: 'Notes',
    run(argv) {
      return { exitCode: 0, stdout: argv.join(' ') };
    }
  });
}
await expect(harness.callRpc('ping')).resolves.toBe('pong');
await expect(harness.runCli(['list'])).resolves.toMatchObject({ stdout: 'list' });
```

App slots can be collected without mounting React, or mounted with `renderSlot`:

```ts
import { collectTestPluginApp, loadPluginApp, renderSlot } from '@zana-ai/zcc-plugin-sdk/testing/app';
import definition from './app.js';

const set = collectTestPluginApp(definition, 'notes');
expect(set.navPanels[0]?.title).toBe('Notes');

const app = await loadPluginApp(() => import('./app.tsx'));
const slot = renderSlot(app.navPanels[0]!, { pluginId: 'notes', subPath: '' }, {
  rpc: { list: () => [] }
});
await slot.findByText('No todos');
```

Pass a thunk to `loadPluginApp` so hooks bind after the test runtime is installed.
Unit tests need no running ZCC app and no `zcc plugin dev`.

Day-one host APIs that are implemented (not stubs): `settings.define` (persisted + Settings UI),
`storage.kv` (on disk), `rpc.method` (callable from the app via `callPluginRpc`), `realtime.publish`,
`background.schedule`, `status.needsConfiguration`, `agents.contributeSkills` / `contributeInstructions`.
`zcc.services.provide` / `zcc.services.use` / `zcc.services.has` is experimental plugin-to-plugin SDK sharing — see `docs/api_to_audit.md`.
`agents.experimental_registerProvider` and `agents.experimental_registerPtyHarness` are experimental — see `docs/api_to_audit.md`.

Provider bridges emit harness-native todo/plan updates as settled `planSteps` items (`item/completed` `{ type: "planSteps", steps: [{ step, status }] }` with `pending` / `active` / `completed`). Use `planStepsPresentation` from `@zana-ai/zcc-plugin-sdk/provider-bridge`. Durable thread plans stay in core — there is no `zcc.plans` plugin SDK.
