---
name: extension-creator
description: Continue work in an already-open local Zana plugin working directory. Use when editing a plugin under ~/zcc-workspace/extensions/<id> — not to start a new plugin.
---

# Building a local Zana plugin

You are already inside a local plugin working directory
(`~/zcc-workspace/extensions/<id>`). This skill is **not** how to start a plugin
— start from **Plugins → New plugin** (or `zcc plugin new`) in an ordinary
project thread. Stay in this directory; the **app** path-installs the source.

## The loop

1. Read the scaffolded files: `package.json` (`zcc` block), `server.ts` /
   `app.tsx`, `CLAUDE.md`.
2. Ask the user what the plugin should do if that is not already clear.
3. Implement it in the TypeScript sources. Keep `zcc.app` / `zcc.server` /
   `zcc.skills` / `zcc.mcpServers` in sync with what you add.
4. Call the `install_local_extension` tool (server: `zcc-inbox`) to path-install
   and reload — the same effect as **Reload from source** in the Plugins hub, or
   `zcc plugin reload <id>`. It takes no arguments. The first call prompts the
   user to approve it.

From a shell (app running): `zcc plugin install .` then `zcc plugin dev .`
watches, rebuilds, and reloads. A failed build or reload keeps the last good
generation running.

There is **no permission broker** for plugins. After install they run
**in-process on the server** with full trust. Do not request host-daemon tokens.
Never bundle your own React — use `globalThis.__ZCC_HOST_REACT__`.

## Starter kinds

The leftover Creator working dir is one of four plugin-shaped starters. Check
`package.json` → `zcc` to see which you have.

- **`panel`** — app slot only (`definePluginApp` + `app.slots.navPanel`). No
  server factory.
- **`main-panel`** — server factory + panel. Register `zcc.rpc` methods the
  panel can call after a reload.
- **`mcp-consumer`** — declares `zcc.mcpServers`. Replace the placeholder
  server with a real command/url before relying on it.
- **`agent-preset`** — skills / agent instructions, no panel. Edit
  `skills/<id>/SKILL.md` and optional `zcc.rpc`.

### Server factory

```ts
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';

export default function plugin(zcc: ZccPluginApi) {
  zcc.log.info(`${zcc.pluginId} loaded`);
  zcc.rpc.method('ping', () => ({ ok: true, pluginId: zcc.pluginId }));
}
```

### App slot

```ts
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'main',
    title: 'My plugin',
    icon: 'Puzzle',
    component: Panel
  });
});
```

Fill the host panel slot (`height: 100%`). Do not import core renderer internals.

## Tests

Unit-test the factory against `@zana-ai/zcc-plugin-sdk/testing`
(`createFakePluginHost`) without launching the app.

## Controls

Prefer simple buttons and the host React primitives. Do not ship a native
`<select>` that fights the app chrome — use buttons or a custom picker.

Never import core renderer internals.
