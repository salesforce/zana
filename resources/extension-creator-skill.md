---
name: extension-creator
description: Author a local Zana Command Center plugin — package.json zcc, definePluginApp slots, ZccPluginApi, and the build/reload loop. Use when building or editing a plugin inside the app's Plugin Creator.
---

# Building a local Zana plugin

You are editing the **source** of a local plugin inside its working directory
(under `~/zcc-workspace/extensions/<id>`). The app scaffolded a `package.json`
`zcc` starter here. You edit the source; the **app** installs it through
PluginService — you never write the installed copy directly, and you never
leave this directory.

## The loop

1. Read the scaffolded files: `package.json` (`zcc` block), `server.ts` /
   `app.tsx` (or the generated `server.mjs` / `app.js`), `CLAUDE.md`.
2. Ask the user what the plugin should do.
3. Implement it in the TypeScript sources. Keep `zcc.app` / `zcc.server` /
   `zcc.skills` / `zcc.mcpServers` in sync with what you add.
4. Call the `install_local_extension` tool (server: `zcc-inbox`) to path-install
   and reload — the same effect as **Reload from source** in the Plugins hub, or
   `zcc plugin reload <id>`. It takes no arguments. The first call prompts the
   user to approve it.

From a shell (app running): `zcc plugin dev .` watches, rebuilds, and reloads.
A failed build or reload keeps the last good generation running.

There is **no permission broker** for plugins. After install they run
**in-process on the server** with full trust. Do not request host-daemon tokens.
Never bundle your own React — use `globalThis.__ZCC_HOST_REACT__`.

## Starter kinds

The create dialog offers four plugin-shaped starters. Check `package.json` →
`zcc` to see which you have.

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
