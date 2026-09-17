# Salesforce plugin

Official ZCC plugin (`zcc plugin install salesforce`). It is both the Salesforce
DX inner loop (org picker, doctor, SOQL Explorer, Agentforce playground /
preview) and the **platform SDK** other plugins consume.

Install once and reuse the Salesforce CLI connection. Each project can select its
own target org; native side panels can pin a separate target without changing that
project. A project without a selection inherits the shared default.

## Install

```
zcc plugin install salesforce
```

Requires the Salesforce CLI (`sf`) on PATH. Log in with `sf org login web`, then
pick an org under **Plugins → Salesforce** or on the Salesforce tab (or set
`defaultOrg` / `SF_TARGET_ORG`).

## Using this plugin

| Surface | What it does |
| --- | --- |
| Plugins → Salesforce | CLI-connected org list, default alias, API version, DX root |
| Salesforce tab | Overview, Data, Apex & logs, Deployments, and Agentforce workbench |
| New Project | Salesforce DX project (`sf project generate`) |
| Data / SOQL tab | Schema, queries, saved history, retained drafts, and record inspectors |
| Agent side panels | Org, SOQL, object, record, Apex/logs, deployments, and operation history |
| Agentforce playground | `.agent` editor (script + graph) |
| Agentforce preview | Simulate or live Test against the selected org |
| Agent tools | `sf_soql`, `sf_apex`, `sf_lwc`, `sf_agent` |
| CLI | `zcc sf doctor`, `zcc sf org`, … |

Frontend panels call this plugin’s RPC (`soql.*`, `org`, `agentPreview.*`). They
do not hold tokens. The server SDK owns OAuth refresh and 401 retry.

## Reusable UI and side panels

See [UI.md](./UI.md) for browser-only components, native panel registration, target
resolution, resource descriptors, and a complete consumer example. Both Modern
threads and CLI agent sessions expose these panels from their native panel picker.

## SDK for other plugins

Reuse contract, method table, and how to extract the session kernel into
another repo: **[`SDK.md`](./SDK.md)**.

`zcc.services` is experimental. Declare a dependency and `use` a live proxy —
`import type` from `@zcc-ext/salesforce/sdk`. Do **not** npm-import
`ConnectionManager` or `createSalesforceSdk`.

```json
{
  "zcc": {
    "requires": ["salesforce"]
  }
}
```

```ts
import type { SalesforceSdk } from '@zcc-ext/salesforce/sdk';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';

export default function plugin(zcc: ZccPluginApi) {
  if (!zcc.services.has('salesforce')) {
    zcc.status.needsConfiguration('needs plugin: salesforce');
    return;
  }
  const sf = zcc.services.use<SalesforceSdk>('salesforce');

  zcc.agents.registerTool({
    name: 'gus_query',
    description: 'SOQL against the shared Salesforce session',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    execute: async (input: { query: string }) => {
      const page = await sf.query(input.query);
      return { alias: page.org.alias, records: page.records };
    }
  });
}
```

`connect()` / `request()` / `query()` return `PublicOrgView` only — never `accessToken`.
Prefer `query` / `queryMore` / `describeGlobal` / `describeSObject` / `limits` for REST.
Use `request({ alias })` when you must hit a non-default org. Use `execSf` for CLI
escape hatches (`sf agent …`, `sf project generate`). Mutations go through
`confirm({ kind: 'org.write', … }, threadId)` and fail closed.

```ts
const org = await sf.connect();
const decided = await sf.confirm(
  {
    orgAlias: org.alias,
    orgId: org.orgId,
    orgKind: org.kind,
    kind: 'org.write',
    summary: `PATCH Account ${id}`
  },
  threadId
);
if (!decided.approved) return;
const { response } = await sf.request(`/sobjects/Account/${id}`, {
  method: 'PATCH',
  body: { Name: 'Renamed' }
});

const { sobjects } = await sf.describeGlobal();
sf.onOrgChange((next) => {
  // defaultOrg changed (or connect failed → null) — drop caches, re-query
  void next;
});
```

Frontend org pickers should keep calling `callPluginRpc('salesforce', 'orgs' | 'org' | 'status')`.
Do not share React components across plugin bundles.

Missing / disabled Salesforce throws `service_unavailable`. Start `degraded` or
`needsConfiguration` instead of crashing host `start()`.

## First-party consumers

This plugin is the first consumer of its own SDK:

- **SOQL Explorer** (`SoqlExplorer`) calls `sdk.query` / `sdk.queryMore` /
  `sdk.describeGlobal` / `sdk.describeSObject` / `sdk.limits` (and `sdk.request`
  for explain).
- **Agentforce playground / preview** resolve the selected org with `sdk.connect`
  (`org` RPC) and run live Test / publish / activate through `sdk.request`,
  `sdk.execSf`, and `sdk.confirm`.

A later plugin (GUS, Data Cloud, …) should look like the example above — not
like a second copy of `ConnectionManager`.
