# Salesforce session SDK

Experimental shared CLI + REST session. Other ZCC plugins consume it through
`zcc.services`; they never copy `ConnectionManager` and never see `accessToken`.

This document is the reuse contract and the map for moving the session kernel
to another repo later. Product UI (SOQL tab, Agentforce playground) stays in
this plugin.

## Consume from another plugin

Install this plugin, declare a dependency, import **types only**:

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
  // …
}
```

Do **not**:

- `import { createSalesforceSdk }` or `ConnectionManager` (host factory)
- npm-import this plugin’s `lib/` internals
- share React org pickers across bundles — call `callPluginRpc('salesforce', 'org' | 'orgs')`
- crash host `start()` when Salesforce is missing; use `needsConfiguration`

Missing / disabled Salesforce throws `PluginServiceUnavailableError`
(`code: 'service_unavailable'`).

## API

Every method that talks to an org returns `PublicOrgView` (no `accessToken`).
Pass `alias` to target a non-default CLI org. `signal` aborts the REST call.

| Method | Use |
| --- | --- |
| `connect(opts?)` | Resolve the session org |
| `listOrgs()` / `resolveAlias()` / `doctor()` | Roster and health (no tokens) |
| `query(soql, { tooling?, allRows?, alias?, signal? })` | `/query`, `/queryAll`, or `/tooling/query` |
| `queryMore(nextRecordsUrl, opts?)` | Next page; locator must stay on the org host |
| `describeGlobal(opts?)` / `describeSObject(name, opts?)` | `/sobjects` (+ `tooling: true`) |
| `limits(opts?)` | Daily API requests Max/Remaining |
| `request(path, init?)` | Other REST/Tooling (`PUT`/`PATCH`/`DELETE` included) |
| `execSf(args, opts?)` | CLI escape hatch (`sf agent …`, `sf project generate`) |
| `confirm(envelope, threadId)` | Fail-closed mutation gate |
| `onOrgChange(listener)` | `PublicOrgView \| null` after `defaultOrg` changes |
| `parseApiError(status, json, text)` | REST error helper (SOQL line/column optional) |

```ts
const page = await sf.query('SELECT Id, Name FROM Account LIMIT 20');
const more = await sf.queryMore(page.nextRecordsUrl ?? '');
const { sobjects } = await sf.describeGlobal();
const { describe } = await sf.describeSObject('Account');

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
await sf.request(`/sobjects/Account/${id}`, {
  method: 'PATCH',
  body: { Name: 'Renamed' }
});
```

`org.write` is the generic mutation envelope. Keep DX-specific kinds
(`apex.anonymous`, `soql.export`, `agent.publish`, …) for those tools.
`queryMore` throws `QueryMoreError` with `code: 'host_mismatch'` when the
locator is not on the connected org.

## First-party consumers

This plugin is the first consumer of its own SDK:

- SOQL Explorer → `query` / `queryMore` / `describe*` / `limits`
- Agentforce preview → `connect` / `request` / `execSf` / `confirm`

A GUS or Data Cloud plugin should look like the example above.

## Moving to another repo

The **session kernel** is already free of `@zana-ai/*`. Copy these files as a
package whose public export is today’s `@zcc-ext/salesforce/sdk` (the contract
file). Keep that import path so consumers do not change.

| Kernel file | Role |
| --- | --- |
| `lib/sdk-contract.ts` | Public types + `SalesforceSdk` (package export) |
| `lib/sdk.ts` | `createSalesforceSdk` factory (host-only) |
| `lib/connection.ts` | CLI org display, cache, alias, 401 retry |
| `lib/guardrail.ts` | Fail-closed `confirm()` |
| `lib/org-resolution.ts` | Alias precedence, `publicOrgView` |
| `lib/sf-cli.ts` | `sf` spawn + REST transport |
| `lib/soql-query-more.ts` | Query locator confinement |
| `lib/soql-api-error.ts` | `parseApiError` |
| `lib/dx-project.ts` | `compactError` / path helpers used by the kernel |
| `lib/types.ts` | Shared types (split public vs DX constants when extracting) |
| `lib/node-deps.ts` | Node `SalesforceDeps` (CLI + fetch + fs) |
| `lib/doctor.ts` | `doctor()` — still probes Agentforce; trim or keep |

**Stay in this plugin** (ZCC product): `lib/plugin.ts`, `app.tsx`, playground,
`soql-explorer.ts`, Apex/LWC/Agentforce tools, RPC, skills.

**Tests that travel with the kernel:** `src/sdk.test.ts`, `connection.test.ts`,
`guardrail.test.ts`, `soql-query-more.test.ts`, `sdk-portable.guard.test.ts`.

Host wiring after the move:

1. This plugin (or the new package’s adapter) constructs `ConnectionManager` +
   `Guardrail` + `createSalesforceSdk`.
2. It `zcc.services.provide(sdk)` under plugin id `salesforce`.
3. Consumers still `use<SalesforceSdk>('salesforce')`.

`SalesforceDeps` is the I/O seam (`execSf`, `request`, clocks, contained fs).
Do not bake Electron or `zcc.sdk` into the kernel. Tokens stay in
`ResolvedOrg` inside `ConnectionManager`; strip them with `publicOrgView`
before any return to a plugin.

The portable-kernel guard (`src/sdk-portable.guard.test.ts`) fails if a kernel
file imports `@zana-ai/*`. Keep that green when extracting.
