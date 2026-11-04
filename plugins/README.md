# First-party plugins (`plugins/`)

This directory holds first-party plugins. They are distinct from the plugin
host (`apps/server/src/plugins/`, `apps/app/src/plugins/`), which discovers
and loads any installed plugin.

## Current

| Package | Role |
| --- | --- |
| `docs/` | Builtin (`autoInstall: true`) — Docs rail, per-project Library, and the library-curator skill. The panel UI is compiled into the renderer (`apps/app/src/views/library`); this package ships the skill + server. Packaged builds copy `plugins/` via electron-builder extraResources. |
| `memory/` | Builtin (`autoInstall: true`) — durable global (shared across projects) and project-scoped memories, injected as a catalog into threads. |
| `plugin-guide/` | Builtin (`autoInstall: true`) — Plugin Guide under Plugins: annotated wireframe map of every SDK surface, Copy for agent, and links into installed plugin hub pages. |
| `posthog-analytics/` | Builtin (`autoInstall: true`) — anonymous usage analytics (agent activity only, never prompts or replies). Auto-installed and on by default; opt out or point it at your own PostHog project in Configure. |


Do not add a runtime plugin to `MAIN_MODULES`. Author it with a `package.json`
`zcc` block under `plugins/<id>` and install it through the plugin workflow.

SDK consumer examples and the extraction map live in
[Salesforce SDK contract](https://github.com/grebmann1/zcc-plugin-salesforce/blob/main/SDK.md).

## Consuming the Salesforce SDK

`zcc.services` is experimental. A consumer plugin declares a dependency and
calls the live proxy — it must not npm-import `ConnectionManager` or read
tokens. Full API table: [Salesforce SDK contract](https://github.com/grebmann1/zcc-plugin-salesforce/blob/main/SDK.md).

```json
{
  "zcc": {
    "requires": ["salesforce"]
  }
}
```

```ts
import type { SalesforceSdk } from '@zcc-ext/salesforce/sdk';

export default function plugin(zcc) {
  const sf = zcc.services.use<SalesforceSdk>('salesforce');
  zcc.agents.registerTool({
    name: 'gus_query',
    description: 'SOQL against GUS',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
    execute: async (input) => {
      const { response } = await sf.request('/query', {
        method: 'GET',
        query: { q: input.query }
      });
      return response.json;
    }
  });
}
```

`connect()` / `request()` return `PublicOrgView` only — never `accessToken`.
Frontend org pickers should keep calling `callPluginRpc('salesforce', 'orgs')`.

Salesforce and Agentforce Studio are distributed independently from [grebmann1/zcc-plugin-salesforce](https://github.com/grebmann1/zcc-plugin-salesforce). Install them from the official Plugins catalog; they are optional on new installations. The public Salesforce service contract remains available to other plugins.
