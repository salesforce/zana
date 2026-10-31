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
`sidebarFooterAction`, `projectStatusbarItem`, `pendingInteraction`. Experimental slots include
`experimental_createProjectAction` (Add project menu) and
`experimental_projectMenuAction` (Organize / row overflow). Open **Plugin Guide**
for the full surface map.

Question plugins should use the host's shared question UI instead of custom form controls.
Register `pendingInteraction({ id, questionForm })`, where `questionForm(interaction)`
returns `{ questions, toResponse }`. Each question has `id`, `prompt`, `multiSelect`,
`allowFreeText`, optional `shortLabel`, and `options: [{ value, label, description? }]`.
`toResponse(answers)` maps the answers keyed by question ID (`{ selected, freeText? }`)
to the plugin's JSON response. The host handles styling, question steps, keyboard
shortcuts, retained drafts, submission, and cancellation. Supply either `questionForm`
or a custom `component`, never both.

Plugins can assign a saved project icon after creating or connecting a project:

```ts
await zcc.sdk.projects.setIcon({ projectId, icon: 'Cloud' });
```

Import `PROJECT_ICONS` and `ProjectIcon` from `@zana-ai/zcc-plugin-sdk` for the
supported names. `sdk.projects.list()` includes each project's saved `icon`.
The icon uses the project color, and users can change it from the project menu.
`Circle` restores the ordinary dot; the default project always displays Home.
Set the icon during setup rather than overwriting the user's choice on refresh.

`package.json` `zcc` also declares `skills` (directory roots, default `["skills"]`),
`mcpServers` (Claude CLI map), and `extra` (opaque bag — not executed).

## Testing

The fake host does not reproduce layout, routing, or crash boundaries. Prefer
`storage.kv` in authoring tests — `storage.database()` is an in-memory stub.

```ts
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';

const { zcc, harness } = createFakePluginHost({ pluginId: 'notes' });
export default function plugin(api = zcc) {
  api.rpc.method('ping', () => 'pong');
  api.cli.register({
    name: 'notes',
    summary: 'Notes',
    run(argv) {
      return { exitCode: 0, stdout: argv.join(' ') };
    }
  });
}
await expect(harness.callRpc('ping')).resolves.toBe('pong');
await expect(harness.runCli(['list'])).resolves.toMatchObject({ stdout: 'list' });
```

App slots can be collected without mounting React, or mounted with `renderSlot`:

```ts
import { collectTestPluginApp, loadPluginApp, renderSlot } from '@zana-ai/zcc-plugin-sdk/testing/app';
import definition from './app.js';

const set = collectTestPluginApp(definition, 'notes');
expect(set.navPanels[0]?.title).toBe('Notes');

const app = await loadPluginApp(() => import('./app.tsx'));
const slot = renderSlot(app.navPanels[0]!, { pluginId: 'notes', subPath: '' }, {
  rpc: { list: () => [] }
});
await slot.findByText('No todos');
```

Pass a thunk to `loadPluginApp` so hooks bind after the test runtime is installed.
Unit tests need no running ZCC app and no `zcc plugin dev`.

Day-one host APIs that are implemented (not stubs): `settings.define` (persisted + Settings UI),
`storage.kv` (on disk), `rpc.method` (callable from the app via `callPluginRpc`), `realtime.publish`,
`background.schedule`, `status.needsConfiguration` / `status.configured`, `agents.contributeSkills` / `contributeInstructions`.
`zcc.services.provide` / `zcc.services.use` / `zcc.services.has` is experimental plugin-to-plugin SDK sharing — see `docs/api_to_audit.md`.
`agents.experimental_registerProvider` and `agents.experimental_registerPtyHarness` are experimental — see `docs/api_to_audit.md`.

Provider bridges emit harness-native todo/plan updates as settled `planSteps` items (`item/completed` `{ type: "planSteps", steps: [{ step, status }] }` with `pending` / `active` / `completed`). Use `planStepsPresentation` from `@zana-ai/zcc-plugin-sdk/provider-bridge`. Durable thread plans stay in core — there is no `zcc.plans` plugin SDK.

Product SDK delegation accepts `sdk.threads.spawn({ projectId, prompt, providerId?, harness?, hostId?, environment?, serviceTier?, ... })`.
`harness: 'project-default'` runs the project's effective AI harness (Settings → AI Harness) and rejects when none is usable;
`providerId` wins when set. With neither, the first registered provider is used (legacy).
A `project-default` spawn also applies that harness's Global → Project AI-harness overrides; explicit `model`/`permissionMode` win, and an override a thread cannot apply rejects.
`sdk.threads.search({ query, archived?, limit? })` searches visible saved titles and messages,
including older and archived threads, newest first. Results are capped at 25.
Provider capabilities advertise `supportsServiceTier` for execution pickers.
Environment choices are validated by the server; omit the choice for the project default.
`sdk.providers.models` discovers models on the selected host and reports discovery errors.
`sdk.system.defaultHost`, confined `sdk.files.read` / `write`, and
`sdk.environments.pullRequest` support task attachments and delegated worktrees.
HTTP routes receive request `headers` and bounded `rawBody` (25 MiB maximum),
plus parsed `body` for JSON. Response `body` accepts `Uint8Array` for binary downloads.

Plugins can read a bounded inbox page with `sdk.inbox.search({ projectIds, query, unreadOnly, reportsOnly, limit, before })` and open an attached report with `sdk.inbox.read({ projectIds, entryId, documentIndex })`. Main validates every Project ID; report paths come from the stored inbox entry and are confined to its registered checkout, including symlinks. Reads preserve unread and archive state. Plugins remain responsible for authorizing the destination before sharing returned content.

`sdk.assistant.complete({ instructions, prompt, signal })` provides a bounded text call through the configured Claude CLI and login. It runs outside Project checkouts with tools and ambient MCP servers disabled, a 30-second timeout, a 6,000-character output cap, and at most two concurrent calls. It never launches a Project worker.


### Copied context references

A plugin can opt a read-only surface into compact selection badges:

```tsx
import { copyContextSelection, type ContextReference } from '@zana-ai/zcc-plugin-sdk/app';

<div ref={contentRoot} onCopy={event => {
  if (contentRoot.current) copyContextSelection(event, contentRoot.current, {
    version: 1,
    label: 'Build log (selection)',
    source: { kind: 'plugin', pluginId: 'builds', resourceId: buildId }
  });
}} />
```

The helper writes `text/plain` and `application/x-zcc-context-reference` synchronously.
For an iframe, register the copy handler inside its document. Both selection endpoints
must be in the supplied root; editable widgets keep native copy. Use `writeContextReference`
for selections from editors or other non-DOM models. Keep the exact copied text.

`useComposer().insertContextReference?.(reference)` inserts at the caret of the enclosing
composer. `useZccNavigate().addThreadContext?.(reference)` targets the thread owning a
plugin's panel; it returns false if that composer is unavailable or ambiguous. Neither sends.
A page assistant accepts `openPanelAgent({ draft: { prompt, references: [reference] } })`;
check `navigate.supportsContextReferences` before using that field on older hosts.

References contain an immutable text snapshot, a label and an optional descriptive source.
They never authorize a source read. The host validates packets, renders inspect/remove/convert
controls, preserves metadata in saved prompts, and expands snapshots into ordinary provider
text on send. Limits are 100,000 characters per snapshot, 24 references and 400,000 snapshot
characters per composer. Ordinary clipboard text stays ordinary; paste as plain text bypasses
metadata. Compact display does not reduce model tokens. See `docs/context-references.md`.
