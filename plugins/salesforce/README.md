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
| Salesforce → Data | Schema, SOQL queries, saved history, retained drafts, and record inspectors |
| Agent side panels | Org, SOQL, object, record, Apex/logs, deployments, and operation history |
| Agentforce playground | Build, Rehearse, and Test: `.agent` editor, conversation map, AI customer role-play |
| Agentforce preview | Simulate or live Test against the selected org |
| Agent tools | `sf_soql`, `sf_apex`, `sf_lwc`, `sf_agent` |
| CLI | `zcc sf doctor`, `zcc sf org`, … |

Frontend panels call this plugin’s RPC (`soql.*`, `org`, `agentPreview.*`, `agentLab.*`). They
do not hold tokens. The server SDK owns org authentication.

## Agentforce Studio

Actions declared in an open script appear in the explorer, grouped by subagent.
Select one to inspect its Apex source or Flow map in a related editor tab. The
Project/Org switch distinguishes local source from deployed Apex or an active
Flow version. Inputs & outputs compares parameter names; Used by reveals the
call and its bindings. Rehearse/Test stays open while you inspect implementations.

Open **Salesforce → Agentforce**, or the Agentforce playground beside
a thread. **Build** provides the editor, live diagnostics and a conversation map.
The divider between the editor and Rehearse/Test is draggable. Arrow keys resize
it when focused, and double-click resets it. The width stays set across workflow
changes. Monaco applies semantic syntax colors in both light and dark themes.
The included starters pass the installed language server without diagnostics.

**Rehearse** starts a conversation from an exact snapshot of the current editor,
including unsaved changes. Choose an engine:

- **Salesforce Preview** compiles the draft through Salesforce's Preview API and
  uses the real planner with simulated actions. Requires an Agentforce-enabled
  org and access to the named-user bootstrap/Preview endpoints. Nothing is
  published or activated, and real actions are never enabled in the Studio.
- **AI rehearsal** asks a Salesforce Models API model to interpret the script.
  Actions are imaginary. It is useful for wording, scope and conversational
  exploration; it does not validate compilation or Agentforce runtime behavior.

**Test** runs an AI customer with a persona, goal, opening message, success
criteria and a budget of 1–8 turns against either engine. Choose a preset or edit
the scenario. The customer and evaluator use the selected org's Models API,
which requires the relevant API scopes, model permissions and Einstein request
capacity. The default model is `sfdc_ai__DefaultOpenAIGPT4OmniMini`; expand
**AI model & usage** to use another model API name enabled in your org.

Results include conversation text, response latency, Preview plan IDs, org and
source fingerprint. An AI assessment includes evidence and is always advisory;
it is never activation evidence. API errors, empty replies, evaluator failures,
and stopped conversations cannot produce a passing assessment. **Export run**
downloads the tested source, scenario, transcript and assessment as JSON.

Switching Build/Rehearse/Test preserves the editor and each conversation while
the playground stays open. Editing after a run shows a stale-snapshot notice.
**Stop** cancels in-flight requests and prevents additional turns; closing the
playground also closes its local handles. Draft Preview has no documented remote
DELETE contract: Salesforce owns remote expiry. Server handles expire after
30 minutes of inactivity and do not survive a plugin restart. Export evidence
before leaving; saved scenario suites and cross-run comparison are future work.

The separate **Org preview** panel retains the CLI workflow for saved authoring
bundles and published agents. Published agents always execute live actions and
therefore require the existing live-action confirmation, even when a caller
omits the live flag. The Studio does not share that live-action path.

See [the design and verification notes](./AGENTFORCE_STUDIO.md) for API boundaries,
research sources and test commands.

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
