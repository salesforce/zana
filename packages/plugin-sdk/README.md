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
`sidebarFooterAction`, `pendingInteraction`.

`package.json` `zcc` also declares `skills` (directory roots, default `["skills"]`),
`mcpServers` (Claude CLI map), and `extra` (opaque bag — not executed).

## Testing

```ts
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';

const { zcc, harness } = createFakePluginHost({ pluginId: 'notes' });
export default function plugin(api = zcc) {
  api.rpc.method('ping', () => 'pong');
}
await expect(harness.callRpc('ping')).resolves.toBe('pong');
```

App slots can be unit-tested without mounting React:

```ts
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import definition from './app.js';

const set = collectTestPluginApp(definition, 'notes');
expect(set.navPanels[0]?.title).toBe('Notes');
```

Day-one host APIs that are implemented (not stubs): `settings.define` (persisted + Settings UI),
`storage.kv` (on disk), `rpc.method` (callable from the app via `callPluginRpc`), `realtime.publish`,
`background.schedule`, `status.needsConfiguration`, `agents.contributeSkills` / `contributeInstructions`.
`agents.experimental_registerProvider` is experimental — see `docs/api_to_audit.md`.
