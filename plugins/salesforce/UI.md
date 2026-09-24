# Salesforce workbench and reusable panels

The Salesforce project tab provides Overview, Data, Apex & logs, Deployments, and
Agentforce. Data keeps query drafts when switching views or orgs. Apex and
deployment forms also keep unsent drafts. Recent operation results survive closing
the panel or restarting the plugin; interrupted local work is marked explicitly.

Choose an org in the project header to set that project's target. Inspecting a row
in the org manager does not change the target: use **Use for this project** or
**Set shared default**. **Use shared default** removes a project's selection.
Native panels have their own target selector, which does not change the project.
They inherit the owning thread or CLI agent's project even when opened from the
global Agents view. An explicit resource descriptor can override that context.

## Add native panels to another plugin

Add `@zcc-ext/salesforce` as a source dependency (`workspace:*` in this repository)
and declare the runtime dependency with `zcc.requires: ["salesforce"]`. The source
package is private; this does not imply an npm release. Build the consumer with
ZCC's plugin builder, which supplies the host's React instance.

```tsx
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';
import { registerSalesforcePanels } from '@zcc-ext/salesforce/panels';

export default definePluginApp(app => {
  registerSalesforcePanels(app, {
    panels: ['org', 'soql', 'object', 'record', 'logs', 'deployments', 'operations'],
  });
});
```

The slots belong to the **consumer plugin**. Their ids are `sf-org`, `sf-soql`,
`sf-object`, `sf-record`, `sf-logs`, `sf-deployments`, and `sf-operations`. They use
the native panel picker on Modern threads and CLI agent sessions. Command-palette
actions open them from an active thread. **Inspect in SOQL** seeds selected message
text into the editor; it never runs the query automatically.

Open a record from a consumer action using its normal, consumer-bound navigation:

```ts
context.openPanel({
  actionId: 'sf-record',
  title: 'Account',
  params: {
    version: 1,
    projectId: context.projectId,
    orgAlias: 'dev',
    objectName: 'Account',
    recordId: '001000000000001',
  },
});
```

`SalesforceResource` also accepts `query`, `logId`, `operationId`, and `path`.
Unknown fields are ignored and oversized values/future versions are rejected.
Resources contain identifiers, never credentials or record payloads. The server
resolves registered projects and canonical local roots for every request.

## Embed connected tools

`@zcc-ext/salesforce/panels` exports `OrgContextPanel`, `ObjectPanel`, `RecordPanel`,
`ApexPanel`, `DeploymentsPanel`, and `OperationsPanel`. Pass `pluginId: 'salesforce'`
explicitly, plus a registered `projectId`, an optional pinned `orgAlias`, and a
`threadId` when an approval-capable thread owns the action.

```tsx
import { RecordPanel } from '@zcc-ext/salesforce/panels';

<RecordPanel
  pluginId="salesforce"
  projectId={projectId}
  orgAlias="dev"
  objectName="Account"
  recordId={recordId}
  onAddToPrompt={text => composer.addQuote(text)}
/>
```

Give connected tools a full-height flex container with `min-height: 0` and
`min-width: 0`. They own their scrolling and adapt to narrow side panels.
`onAddToPrompt` stages bounded evidence; it must never send the prompt. Native
wrappers expose insertion only when the active Modern composer belongs to the
same thread, avoiding insertion into an unrelated conversation.

## Compose your own UI

The browser-only `@zcc-ext/salesforce/ui` exports `SalesforcePanelFrame`,
`OrgBadge`, `OrgSwitcher`, `ObjectInspector`, `RecordInspector`, `QueryResults`,
`RunSummary`, `EmptyState`, `ErrorState`, and `LoadingState`. These components
accept public data and callbacks. Use `SalesforcePanelFrame` to inject the scoped
styles and fill the host slot; no core CSS changes are required.

`RunSummary` presents Apex failures and passed methods, compilation/runtime
errors, deployment component failures, and CLI preview groups (conflicts,
deletions, deploy/retrieve changes, ignored components). Explicit report counts
appear above the details; missing counts are not inferred. Each listed result
can be staged separately through `onAddToPrompt`, with the original org and
operation/job id. Stack traces and retained JSON use disclosures. The structured
view is capped at 200 entries, prioritizing failures and conflicts; stored report
evidence is also size limited. Unknown report shapes remain inspectable as JSON.

```tsx
import { SalesforcePanelFrame, RecordInspector } from '@zcc-ext/salesforce/ui';

<SalesforcePanelFrame title="Account context">
  <RecordInspector record={record} org={publicOrg} onAddToPrompt={stageEvidence} />
</SalesforcePanelFrame>
```

For testing or a custom transport, wrap connected components in
`SalesforceUiProvider` with a `SalesforceUiClient` implementing
`call(method, args): Promise<unknown>`. `registerSalesforcePanels` also accepts a
`client`. The default client calls the installed Salesforce plugin explicitly;
it does not read the consumer plugin's settings.

## Execution behavior

- Target precedence is panel/request override → project selection → shared
  default → environment/CLI fallback. Requests snapshot that target; changing an
  org cannot redirect an in-flight query or a delayed approval.
- Saved-query history is separated by project and org. Query/form drafts are
  bounded local UI storage. Recent operations retain up to 100 entries globally,
  with up to 30 shown for a project.
- Deployments use explicit metadata and targeted Apex test classes. Validation
  uses `sf project deploy start --dry-run`. Asynchronous Salesforce job ids are
  retained, and **Refresh report** uses the original org even after a switch.
- Retrieve preview shows tracked changes supported by the CLI. Retrieve requires
  approval because it writes local source. Preview availability depends on the
  project's source-tracking support.
- Standalone schema browsing, SOQL pages, record/log inspection, metadata lists,
  and deployment reports work directly against the selected org, including
  production. They use read-only endpoints and existing page/output caps;
  loading all rows and exporting still have confirmation in the panel.
  Agent tool calls retain their production/unknown-org and unbounded-query
  approval rules. Anonymous Apex and writes retain their server approval rules.
  A project tab never manufactures an agent or a thread approval.
- The portable `/sdk` service remains available for lower-level integrations.
  Pass its explicit alias options when implementing a consumer's own project
  scoping; it does not infer a project from another plugin's renderer.

## Verification

`src/public-ui-build.test.ts` builds a separate package importing only `/ui` and
`/panels`. DOM tests verify consumer-owned slots, request scope, stale-result
protection, keyboard navigation, drafts, and operation flows. The deterministic
`e2e/salesforce-workbench.spec.ts` installs the plugin in built Electron, exercises
real CLI output over 8 KiB, REST results, project targets and native panels, with
no Salesforce credentials or model spend.

Agentforce actions live inside its file explorer. Related implementation tabs
share the script area and preserve the draft plus the resizable conversation.
Apex is syntax-highlighted and read-only. Flow uses Salesforce’s official Metadata
Visualizer with collapsible branches, pan/zoom, element details and raw source.
**Expand Flow** opens a modal canvas without unmounting the agent editor. Escape
or **Close Flow** restores focus to the expand button. Project and named-org
snapshots are explicit. The canvas follows the app theme; its loading state uses
the shared Salesforce illustration. Parser, frame and timeout failures retain
the basic map and Source.
Graph nodes and Ctrl/Cmd-clicking a target line open the same scoped action tab.
