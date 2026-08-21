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
`sidebarFooterAction`.

`package.json` `zcc` also declares `skills` (directory roots, default `["skills"]`),
`mcpServers` (Claude CLI map), and `extra` (opaque bag — not executed).
