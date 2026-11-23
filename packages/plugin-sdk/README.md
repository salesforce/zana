# `@zana-ai/zcc-plugin-sdk`

Public contract for Zana Command Center plugins. A plugin is a TypeScript
package whose `package.json` carries a `zcc` block. After install it is
**full-trust in-process code on the server**. It never receives host-daemon
tokens.

### Foreground SSH connection preparation

An integration that manages SSH aliases can register one `zcc.sshConnections`
provider per plugin generation. The server chooses it by calling `owns(remote,
signal)` with a validated SSH identity. Ownership must be read-only, use local
state, and finish within five seconds. It must never open authentication.

For explicit bootstrap or machine repair, the selected provider's
`prepare(remote, signal)` runs before SSH installation. It returns
`{ status: 'ready' }` or `{ status: 'blocked', message: 'Public recovery advice' }`.
Only this explicit public message is displayed; thrown exception text is hidden.
Preparation has a six-minute deadline, is serialized per plugin, and is cancelled
when the request closes or the plugin generation ends. Honor the signal and stop
child processes on cancellation. Do not enroll a machine or call bootstrap/repair
recursively from this callback. Background host recovery never calls preparation;
already-connected bootstrap requests reuse their connection without sign-in.
Multiple matching providers fail before authentication. Plugins supporting older
hosts should feature-detect this API and retain their foreground Connect flow.

`createFakePluginHost().harness.sshConnections` exposes the registered provider
and its generation signal for tests.

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

V1 slots: `navPanel`, `settingsSection`, `notificationSoundProvider`, `homepageSection`, `projectTab`,
`sidebarFooterAction`, `projectStatusbarItem`, `pendingInteraction`. Experimental slots include
`experimental_createProjectAction` (Add project menu) and
`experimental_projectMenuAction` (Organize / row overflow). Open **Plugin Guide**
for the full surface map.

Background content scripts can observe generic agent activity without a page
being open. Feature-detect the optional
`context.experimental_observeAgents(listener)` and
`context.experimental_onSignal(channel, listener)` methods. The first delivers
an initial snapshot and changes from the main shell's existing stores, capped
at 1,000 visible agents: ID, thread/CLI kind, and
working/idle/needs-you/unknown state. It carries no prompts or output, and idle
does not claim success. Treat `ready: false` as unavailable and reset any
transition baseline; scoped windows remain unready. The second receives only
this plugin's realtime channel. Both return an unsubscribe function and are
also released on the script's abort signal. Return your own disposer for timers,
audio and other resources, and coordinate across windows for effects that
should happen only once. Older hosts omit these APIs.

Users can select their own MP3, WAV, or OGG directly in Settings → Notifications,
without installing or building a plugin. Sound Studio (`plugins/agent-sounds/`)
is an optional forkable example for audio collections and custom playback rules. Users choose one notificationSoundProvider in
Settings → Notifications; the host master gates that provider and built-in
chimes. Legacy independent content scripts must migrate to participate. See the public
[background activity and sound-plugin guide](../../docs/extensions-sdk-reference.md#background-activity-and-sound-plugins)
for the contract and lifecycle.

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
For scheduled output that is already computed, `sdk.threads.postMessage({ threadId, text })` appends a durable chat message without starting a model turn. The thread must be unarchived and belong to the calling plugin. Messages accept up to 8,000 characters. Check for the method when supporting older hosts.
When a message comes from something other than the user, such as a bot reply, pass `source: { kind, label, color?, threadId?, detail? }` to `sdk.threads.send` or `sdk.threads.spawn`. `kind` is `bot`, `thread`, `user`, `routine` or `job`. The chat then shows the sender's name and kind instead of a plain user prompt. The host stamps the calling plugin's id and rejects labels with control or bidirectional characters. `agentContext` (up to 500 characters) goes to the model as a hidden header, for example `[Reply from bot Scout]`, and is never shown. Check `sdk.threads.messageSources` before passing either on older hosts. Use `mode: 'steer-if-active'` so a reply joins the running turn instead of waiting in the Next-turn queue.
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

### Browser toolbar actions

Register `app.slots.experimental_browserToolbarAction({ id, title, component })` to mount a control in each thread browser toolbar. The component receives `PluginBrowserToolbarActionProps`: a desktop-only `page` (`evaluate`, `onMessage`) and a thread-scoped `composer` (`insert`, `update`, `onSubmitted`, `focus`). Page expressions can use `bridge.postMessage(data)`; messages are untrusted and must be schema-validated by the plugin. Evaluation defaults to an isolated world, with an explicit main-world option for framework inspection. Main confines operations to an existing tab owned by the sender window and thread and refuses active control leases. Keep a reference's plugin source id equal to the supplied `pluginId`; update/remove uses that plugin's resource id. See `docs/thread-annotations.md` for lifecycle and limits.

Sound plugins register app.slots.notificationSoundProvider({ id, title, component, mount }).
Controls appear in Settings → Notifications; only the selected provider mounts
while the host master is on. Provider changes leave playback off. Configure
links inspect settings without enabling audio. Return a disposer and honor
signal abort; do not duplicate the player in general contentScripts. Ordinary
settingsSection appears under Settings → Plugins → [plugin name]. See the SDK reference
for migration, missing-provider behavior and cross-window playback ownership.


### Provider usage

Provider plugins can declare `usage(hostId)` on their provider registration. The
host-scoped callback returns `PluginProviderUsageResult`; credentials stay on the
execution host. Other plugins read it with
`zcc.sdk.providers.usage({ providerId, hostId })`. Providers without a callback
return `{ supported: false }`.
