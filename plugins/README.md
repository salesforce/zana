# First-party plugins (`plugins/`)

This directory holds first-party plugins. They are distinct from the plugin
host (`apps/server/src/plugins/`, `apps/app/src/plugins/`), which discovers
and loads any installed plugin.

## Current

| Package | Role |
| --- | --- |
| `docs/` | Builtin (`autoInstall: true`) — Docs rail, per-project Library, and the library-curator skill. The panel UI is compiled into the renderer (`apps/app/src/views/library`); this package ships the skill + server. Packaged builds copy `plugins/` via electron-builder extraResources. |
| `plugin-guide/` | Builtin (`autoInstall: true`) — Plugin Guide under Plugins: annotated wireframe map of every SDK surface, Copy for agent, and links into installed plugin hub pages. |
| `salesforce/` | Official (`autoInstall: false`) — Salesforce DX inner loop **and** the platform SDK (`@zcc-ext/salesforce/sdk`) other plugins consume via `zcc.services.use('salesforce')`. Org doctor, SOQL/Apex/LWC/Agentforce family tools, and fail-closed mutation confirms. |
| `posthog-analytics/` | Builtin (`autoInstall: true`) — usage analytics: agent lifecycle events plus optional content-free UI-click ids. **Auto-installed and on by default** for every user, no setup required; opt out or point it at your own PostHog project in the plugin's Configure page. Never sends prompt/response content, labels, or input values. |


Do not add a runtime plugin to `MAIN_MODULES`. Author it with a `package.json`
`zcc` block under `plugins/<id>` and install it through the plugin workflow.

SDK consumer examples and the extraction map live in
[`salesforce/SDK.md`](./salesforce/SDK.md).

## Consuming the Salesforce SDK

`zcc.services` is experimental. A consumer plugin declares a dependency and
calls the live proxy — it must not npm-import `ConnectionManager` or read
tokens. Full API table: [`salesforce/SDK.md`](./salesforce/SDK.md).

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
