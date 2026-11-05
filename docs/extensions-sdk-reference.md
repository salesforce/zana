# Plugin SDK reference

Package: `@zana-ai/zcc-plugin-sdk` (`PLUGIN_SDK_VERSION` / `engines.zccPluginSdk`).

## Server — `ZccPluginApi`

Handed to `export default function plugin(zcc)`.

| Surface | Purpose |
| --- | --- |
| `pluginId` | Derived id |
| `log` | debug/info/warn/error |
| `settings.define` | Declarative settings the host/CLI can render (`string` / `boolean` / `number` / `select` / `project`) |
| `storage.kv` | Per-plugin KV |
| `rpc.method` | Renderer/host RPC |
| `realtime.publish` | Events |
| `background.service` / `schedule` | Long-running work |
| `remoteEnvironment.provide` / `refresh` | Environment variables for sessions on non-primary machines (manifest allowlist `zcc.extra.remoteEnvironment`; held in memory, never stored) |
| `agents.contributeInstructions` / `contributeSkills` / `registerTool` / `configure` | Agent capabilities. `registerTool` takes Zod or JSON Schema `parameters` (parsed on invoke). `configure` sees thread / project / environment / host / provider / `origin` / frozen `pluginMetadata`. For a PTY launch (Claude, Codex, OpenCode) it runs once per session with `surface: 'pty'`, the real `sessionId`, `threadId`, `projectId` and `provider.id`; `instructions` (and `contributeInstructions`) are delivered as Claude `--append-system-prompt`, folded into Codex `developer_instructions`, or listed as a private per-session file in OpenCode's config `instructions`. Each contribution is capped at 4096 characters and the total at 16000; a throwing `configure` is written to the plugin log and other plugins still contribute. Cursor PTYs receive no instructions (see the Cursor notes below the parity matrix). Remote PTYs are not covered; `tools` do not apply to a PTY |
| `ui.requestInput` | Host prompt. `threadId` may be a PTY session id for a session shown in the Agents monitor (see Actor-attributed request input) |
| `ui.registerMentionProvider` | `@` / `#` / `$` / `!` / `~` typeahead source; `search` and `resolve` run in the plugin server, so never trust renderer-supplied context |
| `hooks.on` / `hooks.onToolPolicy` | Dispatch admission and native tool policy handlers, one each per plugin (see Platform hooks) |
| `host.projectCall` | Project-bound host RPC routed to the project's machine (see Platform hooks) |
| `ui.requestToolApproval` / `ui.consumeApproval` | Await main's approval sheet in an active server tool; verify and burn its scoped proof (see `approvals`) |
| `status.needsConfiguration` / `configured` | Mark the plugin "Needs configuration" in the Plugins hub (e.g. until the user signs in), and clear it once set up; both apply live without a reload |
| `sdk.threads` / `sdk.files` / `sdk.environments` / `sdk.providers` | Product SDK: attributed spawn with host, environment and service tier; thread metadata; confined host file read/write; environment PR lookup; provider models discovered on the selected host |
| `sdk.system.defaultHost()` | Primary enrolled host ID, or `null` when none is configured |
| `http.route` | Authenticated plugin HTTP routes; request `headers` and bounded `rawBody` preserve uploaded bytes; response `body` accepts a string or `Uint8Array` |
| `sdk.hosts.list({ signal? })` | Read enrolled machine IDs and names; credentials and connection metadata are excluded. Use an exact ID when machine names are ambiguous. |
| `services.provide` / `services.use` / `services.has` | Experimental plugin-to-plugin SDK (live proxy; `has` after `provide`; `service_unavailable` until provided) |
| `onDispose` | LIFO teardown |

Plugins do not get `ctx.exec` permission tokens. They are full-trust in the
server process and must not be given host-daemon tokens.

`remoteEnvironment.provide(resolve)` lets a plugin contribute environment
variables to sessions that run on other enrolled machines (never the primary
machine). The plugin declares the exact names, or `PREFIX_*` patterns, it may
set in `package.json` under `zcc.extra.remoteEnvironment`; names outside that
list are dropped, and names that redirect how processes are found or loaded (`PATH`, `HOME`,
`LD_*`, `NODE_*`, `ZCC_*`, `GIT_SSH*` and similar) are refused for every plugin. `resolve` must answer quickly
(serve a cached value and refresh in the background); call `refresh()` when the
values change. Entries may share a `group` (applied all or none) and list
`requires` (only applied when those variables exist on the machine). Values live
in the memory of the machine's daemon only: they are never written to disk, the
database, logs or spawn-plan dumps, they are cleared when the daemon disconnects
or the plugin is disposed, and a variable the user already set on the machine is
never overridden.

`sdk.threads.spawn` accepts `hostId`, `serviceTier: "default" | "fast"` and
`environment: { kind: "unmanaged" | "personal" | "worktree" | "reuse", ... }`.
The server validates environment choices and authorizes host/project access.
Omit the environment to use the project's default. Provider model discovery
accepts `hostId` and returns `modelLoadError` when discovery fails.

Harness choice: pass `providerId` for an exact thread provider (an unknown id
rejects), or `harness: "project-default"` to run the project's effective AI
harness, resolved like a new agent launch (Settings → AI Harness global
default, then the project's override). A yolo default also implies
`permissionMode: "full"` unless you pass one. When no usable harness resolves
(disabled, not installed, host offline, provider plugin not loaded) the spawn
rejects with an actionable message; it never falls back. `providerId` wins when
both are set. With neither, the host still uses its first registered provider —
legacy behaviour kept for older plugins; new plugins should opt into
`harness`. `sdk.providers.list()` reports `available: false` for a provider
whose bridge failed or whose harness is not installed and enabled on the host.

AI-harness overrides: a `harness: "project-default"` spawn also applies the
resolved harness's overrides the way a new agent launch does — Settings → AI
Harness, then the project's AI harness overrides — mapped onto the thread's
model, permission mode, ACP session mode or `/plan`. Explicit `model` and
`permissionMode` still win. An override the thread cannot apply rejects with an
actionable message naming it; it is never dropped. Examples: a Codex
sandbox/approval policy other than exactly `workspace-write` + `on-request` or
`danger-full-access` + `never` (a half-set pair included), plan on a provider
with neither a plan mode nor `/plan`, a project Claude Code permission mode, or
PI provider/model/thinking defaults. A `providerId` spawn applies no harness
overrides.

`sdk.files.read` and `sdk.files.write` resolve an omitted `hostId` to the
primary host and retain the host file service's path confinement.
`sdk.environments.pullRequest({ environmentId })` returns `pullRequest` or
`unavailableReason`. Thread summaries include titles and update timestamps,
plus `pinnedAt` (epoch ms, or null when the thread is not pinned).
A host entry's `experimental_paths.threadStorageRoot` is the absolute
thread-storage directory of the daemon it runs on (null when the daemon did not
provide one); the directory may not exist yet, so confine anything beneath it.
Plugin HTTP bodies are capped at 25 MiB; JSON routes also receive parsed
`body`, while attachment routes can consume the exact `rawBody` bytes.

### Plugin services (experimental)

`zcc.services.provide(impl)` is keyed by **this** plugin's id (another plugin
cannot impersonate it). `zcc.services.use(id)` returns a **live proxy** that
always dispatches to the current impl, so a provider reload does not drop
consumers. `zcc.services.has(id)` is true after that plugin has called
`provide`. Missing / disposed providers throw `PluginServiceUnavailableError`
(`code: 'service_unavailable'`). Stay experimental until a second in-tree
consumer exists — see `packages/plugin-sdk/docs/api_to_audit.md`.

The Salesforce plugin publishes `@zcc-ext/salesforce/sdk` (`SalesforceSdk`) as
a **types-only** contract. Consumers `import type` and `use('salesforce')`;
they must not import `ConnectionManager` / `createSalesforceSdk` or receive
org credentials. Reuse + extraction map: [Salesforce SDK contract](https://github.com/grebmann1/zcc-plugin-salesforce/blob/main/SDK.md).

## App — `definePluginApp`

Slots are grouped the same way as the in-app **Plugin Guide** (Plugins hub).
When you add or rename a surface, update `plugins/plugin-guide/src/surfaces.ts`,
this page, and run `node website/scripts/sync-plugin-guide.mjs` (copies the map
into `website/lib/plugin-guide/`; do not hand-edit that folder).

### App shell

- `navPanel` — sidebar entry + full view. `placement: "extensions"` lists under Plugins; `placement: "unlisted"` is a full `/plugins/<id>/<path>` page with no rail row (open via `toPluginPanel`)
- `experimental_projectMenuAction` — project-row overflow, or the Projects Organize menu (`placement: "workspace"` means no project is selected; `projectId` is `null`). `toProject` opens a `projectTab`
- `experimental_createProjectAction` — Add project (+) menu (`openDialog` mounts an optional create wizard; `addProject` registers the folder)
- `sidebarFooterAction` — host-rendered footer icon (`openSettings` / `toPluginPanel`)

### Project shell

- `projectTab` — per-project rail tab (`global: false` hides the sidebar entry). Use `statusbar: 'hidden'` to omit the host project-path/Git footer for this tab; other project views keep their footer. Use `header: 'custom'` when the component supplies its own toolbar; render its `headerActions` prop there to retain the host split-pane controls without an extra title row. Set `detachable: true` to offer **Open in new window** (desktop only): the tab then runs in its own OS window, one per project, and other windows show `detachedPlaceholder` (`PluginDetachedTabProps`: `focusWindow()`, `bringBack()`) or a host card instead of mounting it. Inside that window `useZccContext().surface` is `'plugin-view'` and no thread sits beside it, but the page keeps its side panel (below); `useZccNavigate().openInWindow?(projectId, { tabId, resourceId? })` opens or focuses it. With `resourceId`, each opaque resource has its own window and saved geometry; the main project tab remains usable. `useZccContext().resourceId` identifies the detached resource, or requests its selection after **Show in main window**. Keep the detached resource fixed, while treating main-window resource selection as navigation. Watch `resourceRequestId` alongside `resourceId` so repeated requests select the same resource again. The host bounds resource ids and checks the project/plugin; an id grants no file access, so plugins must still authorize resource reads and writes. `useWindowTitle({ title, detail?, badge?, tone? })` titles that window while the calling component is mounted: `title` replaces the tab label, `detail` follows the project name, and `badge` (tone `neutral`, `warning` or `danger`) shows as a pill and leads the OS title, e.g. `Production · Agentforce · Help — Acme · prod`. It does nothing in the main or a project window, and the host trims and caps each part. `useZccNavigate().toProject(projectId, { tabId, inMainWindow: true })` explicitly opens the main tab instead of focusing its detached window. Persist edits the window must not lose (drafts) and publish cross-window state over `zcc.realtime`.
- **Window close handoff.** `useWindowCloseHandler(handlerOrNull)` registers an async preflight for this plugin’s detached window. The handler receives an `AbortSignal`; on a timeout, restore an editable workspace and stop the handoff when it is aborted. Flush unsaved document updates, release edit ownership and remove live view leases before resolving. Native close, Close Tab and return-to-main all await this handler. Throw or reject to keep the window open with an error. Main bounds the wait and accepts completion only from that window; a crash clears the guard. Handlers are removed on unmount.
- **Resource side-panel scope.** Call `useZccNavigate().setPanelScope?.({ id, view? })` as the active resource changes, or pass `null` to restore the page scope. The host keeps each resource's tools, selected conversation and panel layout independently without remounting the plugin page. `view` supplies the scoped assistant context; use a stable, registered view value. Resource panels reuse their saved state when moved between the main and detached window; plugins should arrange one active owner per resource and persist running work independently of renderer lifetime.
- **Page side panel.** A `navPanel` page or `projectTab` shares the host rail and tabbed side panel across desktop, web and its detached window; `useZccContext().sidePanel` is `true` there (absent or `false` elsewhere, including inside thread-panel tabs). `useZccNavigate().openPanelAgent({ threadId, title? } | { draft: { prompt, projectId?, view? }, title? })` shows a conversation, or prefills a blank composer so the user picks the harness and sends it. `openPanelTool?({ actionId, title?, params? })` opens one of the plugin's own `threadPanelAction` tabs there, provided it lists `'plugin-page'` in `scopes`; an open tab for the action is focused and given the new `params` instead of duplicated. Both return `false` when the page has no side panel or the request does not match, so keep a navigation fallback. Use the host for conversations and page tools instead of adding another chat rail. The panel's New Tab page lists only the page owner's `'plugin-page'` actions, never another plugin's. A tool scoped only to `'plugin-page'` never opens beside a thread, even from a saved tab, and a page's detached window keeps its own side-panel tabs apart from the main window's.
- `experimental_agentsView` — add a layout after Board, List and Flow in the global and project Agents view selectors. See [Adding an Agents view](#adding-an-agents-view).
- `experimental_agentsBoardAction` — toolbar control on the Agents board (`projectId` is `null` on the cross-project Agents nav)
- `experimental_agentCardAction` — right-click item on an Agents board card
- `experimental_threadCardAction` — right-click item on a Modern conversation card. `isAvailable` and `run` receive host-derived `threadId` and `projectId`
- `projectStatusbarItem` — project statusbar chip (`align` left/right; `run` may `toProject` / `toPluginPanel` / `openDialog` / `openMenu`)

### Home

- `homepageSection` — card on the Home compose surface
- `experimental_newThreadPanelAction` — CTA under New Chat compose (can open a compose-time side panel)

### Composer

- **Copied editor selections.** An editor can add `EDITOR_SELECTION_MIME` (`application/x-zcc-editor-selection`, exported by the app SDK) alongside normal `text/plain` on its copy event. The JSON shape is `{ version: 1, path, startLine, endLine, text }`, with one-based inclusive lines and a maximum of 100,000 text characters. The composer validates the metadata against the plain text and inserts an inspectable, removable file-and-line chip. Paste as plain text bypasses it. Sending expands the copied snapshot into ordinary prompt text, including unsaved edits; clipboard paths never grant filesystem access. Missing, malformed, oversized, or mismatched metadata falls back to normal paste.

- `composer` — `composer.customize`: actions, banners, plus-menu items, meta chips, advanced fields, and rich-text effects. Scope to `thread`, `new-thread`, `cli-agent`, `queued-message`, or `side-chat`. `useComposer().experimental_setLaunchPatch` overlays spawn extraArgs / profile / routing

### Thread

- `threadPanelAction` — side-panel tabs. `scopes` default to `["thread"]`; add `"agent-session"` for the CLI-agent inspector and `"plugin-page"` for the side panel beside this plugin's own pages. With `"plugin-page"`, optional `pages` (the `navPanel` / `projectTab` ids) narrows which pages list it. The component's `surface` prop says which panel shows it (absent on older hosts: treat as `"thread"`); `threadId` is empty beside a plugin page. `tabId` names the tab showing it: the same across tab switches, new when a closed tab is opened again, so a component can keep state while switched away and start fresh in a reopened tab. Both this slot and `experimental_newThreadPanelAction` accept an optional `category` label for the New Tab launcher. Omit it to group under the installed plugin’s display name. Categories are collapsible; search matches tool titles and category names across all groups. The optional `icon` is shown beside the tool.
- `pendingInteraction` — custom in-thread prompt UI (`id` must match `zcc.ui.requestInput` `rendererId`)
- `experimental_threadHeaderAction` — action in the thread detail header
- `experimental_threadList` — replace the thread list in the global and project sidebars (exclusive); projects and CLI Agents remain host-owned
- `experimental_timelineRenderer` — custom body for a timeline row kind
- `messageDirective` — render `::name{attr}` leaves in markdown
- `messageAction` — per-message menu item on the timeline
- `fileOpener` — open a previewed file by extension

### Command palette

- `commandPaletteAction` — a row in ⌘P Extensions (`toPluginPanel` / `toProject` / `openPanel`)

### Configure

- `settingsSection` — React settings UI on the plugin’s Plugins hub detail (Configure)

### Platform

Headless (no pixels), plus picker chrome:

- `skills` — `zcc.skills` / `contributeSkills`
- `cli` — `zcc.cli.register`
- `mcp` — `zcc.mcpServers`
- `settings-define` — `zcc.settings.define`
- `background` — `zcc.background.service` / `schedule`
- `desktop-browsers` — `zcc.sdk.experimental_desktopBrowsers` (experimental; first-party Browser Automation)
- `approvals` — stable `zcc.ui.requestToolApproval({ binding, title, summary?, details?, confirmLabel?, tone?, timeoutMs? })` waits for a main-owned sandboxed sheet from an active registered **server tool**. The host derives plugin/thread/invocation identity; supplied scope is only an assertion and mismatches are refused. Wait is a positive integer, at most five minutes (default five minutes). `requestApproval` and `experimental_requestApproval` are aliases with the same active-invocation restriction. Button flows use `requestApproval(pluginId, request)` from `@zana-ai/zcc-plugin-sdk/app`, without tool scope.

### Tool Approval

```ts
async execute(input, ctx) {
  const binding = await rebuildBindingFromServerState(input);
  const approval = await zcc.ui.requestToolApproval({
    binding, title: 'Activate agent', confirmLabel: 'Activate', tone: 'danger'
  });
  if (!approval.approved) throw new Error(`Approval refused: ${approval.reason}`);
  // Re-read state after the wait; a changed target/revision needs new approval.
  const current = await rebuildBindingFromServerState(input);
  if (!(await zcc.ui.consumeApproval({ token: approval.token, binding: current }))) {
    throw new Error('Approval no longer matches');
  }
  return activate(current);
}
```

Main signs an opaque MAC over plugin/thread/invocation and binding (`action`, `target`, `targetLabel`, `subject`, `revision?`, `confirmText?`). Server `consumeApproval` injects the active scope and verifies exactly once before mutation. A proof expires **at** five minutes, not after; replay-cache capacity rejects fresh consumption rather than evicting live entries. `experimental_consumeApproval` is a compatibility alias. Never return tokens in tool results, transcripts, metadata or agent environment.

Thread/project/environment local scope is re-read before requesting, after the wait, and before consumption. Main re-resolves the owning window and running plugin before signing. Archiving, hiding, deleting, moving to a remote host, or ending the invocation invalidates pending approval. Only this authenticated approval control operation extends the normal ten-second control deadline to its bounded approval wait.

Only the authenticated product server can request a tool sheet through main control. Operator/agent control requests and renderer requests for scoped proofs are refused. Missing desktop credential/window, headless/remote/hidden/unresolvable thread, cancellation, timeout, abort and runtime failure never grant approval. Existing provider and local permission checks still apply; this proof does not bypass them. Typed `confirmText` is compared by main. Tests can use `harness.approve(binding)` and an explicit fake-host `requestToolApproval` stub; default fake hosts return `unavailable`.

### Other Platform Hooks
- `contentScripts` — `contentScripts.register`
- `experimental_providerIcon` — picker glyph for a provider id

Registrations replace wholesale per plugin id. Each carries a `generation` used
as the React remount key. Wrap UI in `PluginSlotBoundary`. Live-reload with
`zcc plugin dev`.

## Adding an Agents view

`app.slots.experimental_agentsView` adds a selectable Agents layout. Multiple plugins
can contribute views; the host keeps the built-in Board, List and Flow choices.
Agent City uses this slot for World. A view contribution does not add a sidebar
page; its plugin remains manageable under **Plugins → Installed plugins**.

```tsx
import { definePluginApp, type PluginAgentsViewProps } from '@zana-ai/zcc-plugin-sdk/app';

function WorldView({ projects, members, onInspect }: PluginAgentsViewProps) {
  return (
    <section aria-label="Project agents" style={{ height: '100%', overflow: 'auto' }}>
      {projects.map((project) => (
        <section key={project.id}>
          <h2>{project.name}</h2>
          {members.filter((member) => member.projectId === project.id).map((member) => (
            <button key={member.key} onClick={() => onInspect(member.key)}>
              {member.title} · {member.status}
            </button>
          ))}
        </section>
      ))}
    </section>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_agentsView?.({
    id: 'world',
    title: 'World',
    icon: 'Building2',
    component: WorldView
  });
});
```

The registration is `PluginAgentsViewRegistration`: a plugin-local `id`, selector
`title`, optional icon name, and React `component`. The host namespaces the saved
view choice by plugin id and registration id.

`PluginAgentsViewProps` provides:

| Prop | Meaning |
| --- | --- |
| `projectId` | Current project id, or `null` for the global Agents view. |
| `projects` | Projects in the current scope, with id, name and optional color. |
| `members` | `PluginFleetMember` records for CLI Agents and threads, including live and exited sessions. |
| `schedules` | `PluginFleetSchedule` plans, including enabled state, next run and whether running. |
| `executions` | `PluginFleetExecution` team-run summaries, with state and attention flag. |
| `population` | Optional full scoped `members`, `schedules` and `executions` before search, for stable spatial layouts and live counts. It still respects the calendar toggle. Older hosts omit it. |
| `searchQuery`, `includeScheduled` | Current host search and calendar-toggle values; supplied fleet data already respects these filters. |
| `onInspect(key)` | Opens the host inspector for a supplied member, schedule or execution key, including search-hidden records in `population`. Pass the opaque key unchanged; the host resolves only the current scope. |

Use `member.live` for live population counts. Member statuses are `working`,
`needs-you`, `idle`, `done`, `error` and `unknown`. `done` indicates an ended
session, not proven task success. Schedules and executions are separate from
member counts. The host updates these props; a visualization needs no duplicate
polling, launch permission or server implementation.

Desktop selection persists across reloads. Phones use an independent selection
for their current app session and initially fall back to Board when the desktop
has selected a plugin view. Disabling, removing or failing to load the selected
plugin makes the selector fall back to Board. Reloading a plugin remounts its
view, so components must clean up timers, observers and subscriptions.

This API is experimental and requires the updated host that implements it.
Optional chaining in the example makes registration a no-op on older hosts;
it does not provide the view there. `experimental_threadList` replaces the sidebar's thread list and does not add a
layout to this selector.

## Manifest

`package.json` `zcc` block, parsed by `@zana-ai/zcc-domain` `readPluginManifest`.
Id from `derivePluginId(package.name)`. Reserved sentinel `__builtin__` is
host chrome, not a plugin.

| Field | Meaning |
| --- | --- |
| `skills` | Directory roots. Default `["skills"]`; `[]` opts out. Each child dir with a regular `SKILL.md` is a skill named after the folder. |
| `mcpServers` | Map of Claude CLI MCP servers for PTY / CLI Agent (`--mcp-config`). stdio `command` is basename-only; relative `args` are rewritten to contained paths. Conversation threads do not read this map — they get `zcc.agents.registerTool` via zcc. |
| `extra` | Opaque JSON object (≤32 keys, ≤8 KiB). Displayed on install; never synced as skills/MCP. |
| `requires` | Other plugin ids this plugin consumes via `zcc.services.use`. Host topo-sorts load order. A missing required plugin marks the consumer `needs-configuration`. |

Durable skills belong in `zcc.skills`. `agents.contributeSkills` is a runtime extra. There is no `registerMcpServer`. `registerTool` (`parameters`: Zod or JSON Schema) is the conversation-thread tool path; `zcc.mcpServers` is the Claude CLI / PTY path.

Do not put secrets in `extra`. Env values on `mcpServers` are written to `.mcp.json` only — the hub sees `envKeys`.

Legacy `extension.json` is shimmed for one release via `shimLegacyExtensionManifest`.

## Platform hooks

Generic, provider-agnostic contracts a plugin can use without naming a
specific host, provider, or extension (`@zana-ai/zcc-domain` /
`@zana-ai/zcc-plugin-sdk/server`). Main resolves every id/path to local
authority; a plugin only ever supplies identifiers and bounded JSON.

| Surface | Purpose |
| --- | --- |
| `zcc.host.projectCall({ projectId, hostId?, method, input? })` | Project-bound host RPC. Main resolves `projectId` → host/root before the call reaches the host daemon; a plugin cannot forge a root path or a token. Returns `{ result }`. |
| `zcc.ui.interactions.get/upsert/acknowledge/cancel` | Resumable, correlation-keyed interactions. `upsert({ projectId, correlationId, kind, payload })` is idempotent per correlation id while the row exists. Pending rows count toward per-plugin+project (100) and global (10,000) quotas; exceeding either throws `INTERACTION_CAPACITY_EXCEEDED`. Ack/cancel free capacity. Pending rows expire to `ack-timeout` 30 days after creation; acknowledgement instead starts a new 30-day resolution window (`expiresAt`), after which an unresolved row becomes `cancelled`. Generation-checked acknowledgement/resolution rejects stale or expired writes even between sweeps. Terminal rows retain their correlation key as a tombstone for 7 days after the deadline or explicit resolution/cancellation, then are deleted; the same correlation id may be reused after deletion. Cleanup runs at startup and daily (also opportunistically during service use). |
| `zcc.hooks.on(handler)` | One message-dispatch admission handler per plugin. `handler({ dispatchId, threadId?, sessionId?, projectId, generation, surface, entry, origin })` returns `{ action: 'proceed' }`, `{ action: 'wait', reason, overrideable }`, or `{ action: 'reject', message }`. A `reject` is terminal and cannot be bypassed. A `wait` can only be overridden by an explicit, authenticated human Send-now action in the UI — a plugin, agent, or programmatic caller can never invoke the override itself. `overrideable: false` additionally blocks even the human override (force-flush included). |
| `zcc.sdk.capabilities.forThread({ threadId })` / `forExecution({ executionId })` | Live capability descriptors (`{ id, available, reason? }`) derived from main's own registered host/provider state — never from a caller-supplied provider id, so a spoofed id cannot report a capability as available that main did not actually wire. `forExecution` always reports provider-specific descriptors (native tool hooks) as unavailable, since an execution can span more than one provider slot. |
| `zcc.ui.registerProjectTabAvailability({ tabId, evaluate })` | `evaluate({ projectId })` returns `{ available, reason? }` for a `projectTab` registered by the same plugin. An unavailable tab stays visible, disabled, with the bounded `reason` shown to the user — it never silently disappears. A throwing/erroring `evaluate` degrades to unavailable rather than crashing the tab. |
| `zcc.agents.registerPersonas(personas)` / `registerTeams(teams)` | Namespaced persona/team contributions (`ext:<pluginId>:<slug>` ids), host-stamped provenance. Replaces this plugin's own prior generation wholesale on each call; cannot override a user or built-in record. Cleared automatically on uninstall, disable, or crash. |

#### Project calls on another machine

`zcc.host.projectCall({ projectId, hostId?, method, input? })` runs on
`hostId ?? the project's machine ?? the primary machine`; with several machines
connected there is no ambient default. A project on the primary machine is
confined by the server (`realpath` of its registered path). A project registered
on another machine is sent with its registered path as `daemonConfinedProjectRoot`
(host protocol 51; mutually exclusive with the server-confined `projectRoot`), and
that machine's daemon `realpath`-confines it against its own project catalogue
before the worker sees it: a path outside the catalogued root, a symlink escape,
or a missing root is refused. SSH-backed projects keep server-side confinement.
Known limit: a second checkout added through `POST /projects/:id/sources` is
refused for remote calls unless that machine's own catalogue holds it.

Lifecycle events (`PluginThreadEvent` from `zcc.events.on`) now always carry a
host-generated `id`, a process-local `sequence`, and a `timestamp` — do not
derive identity from event content, and do not expect a durable replay stream;
delivery is best-effort.

#### PTY lifecycle events

PTY sessions Zana's desktop app owns emit the same `thread.*` events as Modern
threads, with `surface: 'pty'` and the PTY's `sessionId`. Modern events carry
`surface: 'modern'`. `projectId` always comes from the app's own session record,
never from anything the session reports.

| Moment | Event |
| --- | --- |
| Session first seen live | `thread.created` |
| A turn starts or resumes (hook callback) | `thread.active` |
| A turn ends (stop hook callback) | `thread.idle` |
| Process exits with a non-zero code, not by signal | `thread.failed` (`error: 'exited with code N'`), then `thread.deleted` |
| Any other exit, including a close the app requested | `thread.deleted` |

A PTY the app has not bound to a thread record has no thread: `threadId` equals
`sessionId`, exactly as in native tool policy requests, and `surface === 'pty'` says
so. Do not look the id up as a thread. Active and idle come from the harness's
turn hooks, so only an interactive Claude or Codex session with a hook base reports
them. A headless session, or one without hooks, delivers `thread.created` and the
exit-derived `thread.failed` / `thread.deleted` only; the capability descriptor
`lifecycle-delivery` says so in its `reason`. Delivery is queued, bounded
(the oldest undelivered events are dropped under sustained overload), ordered, and
never blocks the terminal. A session that reconnects after an app restart reports
`thread.created` again.

### Native tool policy (Claude / Codex only)

A native pre-tool hook is capability-gated per surface and harness, from the
host's own wiring (`zcc.sdk.capabilities.forThread` reports
`tool-before-native` / `tool-after-native` per thread; see the matrix below).
Claude and Codex (PTY and Modern), OpenCode and Cursor (PTY only) can veto; every
other surface reports `tool-before-native` unavailable with a reason, and no
surface delivers `tool-after-native`. The lifecycle for an intercepted invocation
is strictly ordered and exactly-once-terminal:

```
announced -> awaiting-decision -> allowed|denied -> executing -> succeeded|failed|cancelled
```

A `denied` decision blocks the tool's side effect before it starts; a
transport failure or decision timeout fails closed (denied), never open.

Plugins that register `onToolPolicy` must declare `"toolPolicy": true` next
to `zcc.server` in their manifest. An enabled declared policy plugin denies
native tools until its active generation has registered and sealed exactly one
handler. Legacy enabled server plugins without a declaration are conservatively
treated as unknown during startup and degradation, so they also deny until a
successful activation proves that no handler is registered. There is no grace
period or automatic disable: disable or uninstall a failed plugin to release
only that plugin's obligation. A healthy reload keeps its prior sealed handler
authoritative until replacement succeeds.

`allow` means no plugin objected; it is never an approval. The provider's own
permission flow still decides: both PTY hooks stay silent on `allow` instead
of auto-approving (Claude reads a hook `allow` as "skip the permission
prompt", and Codex rejects a bare hook `allow` as invalid output).

A `deny` reason is shown to the agent. A blank or ill-formed reason (empty
after trimming, control characters, unpaired surrogates) is replaced, and
reasons are capped at 1024 characters.

#### The `ask` decision

A handler may answer `{ action: 'ask', prompt, timeoutMs? }`. The host, not the
plugin, opens a human approval card showing `prompt` (plain text, capped at 2000
characters) and a bounded preview of the tool input, in the Agents monitor for a
PTY session or the thread for a Modern thread. Only an explicit human allow lets
the call continue, and the provider's own permission flow still decides after it.
A deny, cancel, timeout, session end, missing UI (headless, web), a transport or
handler error, and any answer that is not from a human all deny. The plugin
cannot answer its own ask: the card's renderer id is host-only. `timeoutMs` is
clamped to 10-120 s and defaults to 60 s. Asks are serialised per thread or
session, and time spent queued behind another ask counts against the budget, so a
held agent can wait the full ceiling; use `ask` sparingly.

Every transport time bound derives from one budget:

| Bound | Value |
| --- | --- |
| Decision phase (all plugin handlers together) | 9 s |
| Approval phase (`ask` only) | 10-120 s, default 60 s |
| Margin the decider keeps | 1 s |
| Main ceiling per call | 10 s without an ask (9 s + 1 s); 20-130 s with one (9 s + approval + 1 s) |
| Relay backstop (relay curl, bridge awaits, product route) | 134 s |
| Claude hook timeout | 140 s |

Every expiry denies; a transport timeout only ever bounds a hung decider.

Each `invocationId` is deduplicated at the server boundary, so a retried
request with the same id replays the same decision rather than re-deciding. If
the policy inventory or active generation changes while an `allow` is in
flight, that invocation becomes denied instead of replaying a stale allow; a
new invocation is needed after recovery.
For PTY sessions the host derives it from the live session plus the
provider's turn id (when it sends one), tool call id, tool name and input: an
identical retry replays its decision, and different content never reuses one.
PTY tool input over 256 KiB (counted in JSON characters of the parsed input,
not wire bytes) is denied with an explicit reason, without calling plugins.
The same holds in a `pnpm dev` build.

`hooks.onToolPolicy` is public and stable. Capability descriptors describe host
wiring, not provider-family guesses. Unknown surfaces fail closed with a reason.
PTY native availability requires recorded hook-base evidence. Local headless
Claude and Codex sessions receive the same fail-closed native-policy hook;
remote headless sessions remain unavailable because remote hook forwarding is
not wired.

Codex hook delivery and trust: the host delivers its lifecycle and native-policy
hooks to Codex PTY sessions as config overrides in Codex's session-flags layer
(no file is written to the user's `~/.codex/config.toml`). Codex discovers hooks
per config layer and appends them, so the user's and project's hooks still run
alongside the host's. A session-injected hook is untrusted by Codex until its
content hash is trusted. For a local Codex binary the host has verified (a
once-per-binary-and-version conformance probe confirms Codex computes the same
hook hashes the host does), it passes one `hooks.state` config override carrying
the trusted hash of exactly the handlers it generates, so user and project hooks
keep their normal trust state. When the probe has not completed, fails, or
mismatches, and for every remote (SSH) Codex launch, the host falls back to the
global `--dangerously-bypass-hook-trust` flag instead; that degraded mode also
skips the trust prompt for any enabled user or project hook in the launched
session. Codex Modern (app-server) sessions pass no such flag.

### Tool settled events

`zcc.events.on('tool.settled', handler)` observes the completion of native tool
calls on Claude and Codex (PTY and Modern). It is observational: it cannot veto,
delay or alter the tool, and the relay is fire-and-forget (a hung main never
delays the tool; the host-side post is bounded by `TOOL_SETTLED_POST_MS`, 1.5 s).

```ts
zcc.events.on('tool.settled', (e) => {
  // e: { invocationId, sessionId?, threadId?, projectId, providerId, toolName,
  //      state: 'succeeded' | 'failed' | 'cancelled', durationMs,
  //      exitCode?, outputBytes?, outputPreview? }
});
```

- `invocationId` is the same id the matching `onToolPolicy` request carried, so
  a plugin can pair a decision with its outcome. PTY events carry `sessionId`,
  Modern events carry `threadId`.
- Subscribing is the opt-in for metadata-only events (everything above except
  `outputPreview`). `outputPreview` is present only when the manifest declares
  `"toolResults": "preview"` next to `zcc.server`; the flag is read at
  activation, so changing it needs a reload and, like other new capabilities,
  does not trigger a re-consent prompt. The preview is redacted for secret-shaped
  spans in core and capped at 4 KiB of UTF-8. Tool results can carry secrets:
  the host never logs or persists them, and a plugin should not either.
- `outputBytes` is the UTF-8 size of the output the provider reported (after the
  bridge's own bound), not the size of anything the tool wrote elsewhere.
  Reports whose output exceeds 4 MiB are dropped rather than truncated.
- Delivery is best effort with no replay: events are lost if the host, a hook or
  the relay is down, and ordering across invocations is not guaranteed. A handler
  that throws is contained and does not affect other plugins or the tool.
- Only calls the host allowed produce an event. On Modern, a settle whose
  allow was not remembered (for example after a server restart) is dropped.
- PTY delivery requires a supervised runtime with hook-base evidence, the same
  condition as native policy; this is not the `tool-after-native` capability,
  which stays unavailable.

Parity: Claude PTY and Modern (PostToolUse / PostToolUseFailure) and Codex PTY
(PostToolUse) and Modern (`item/completed` for command and file-change items)
deliver it. Other harnesses (pi, acp, OpenCode, Cursor) do not.

Scaffolded plugins declare `engines.zccPluginSdk: >=0.1.0`, the public host
compatibility baseline. This range is intentionally independent from the SDK
package version selected for development dependencies.

The matrix below is checked against the host's capability registry. `Headless`
and `Hook base` say which session shape a row covers (`any` covers both; Modern
sessions always have a hook base). Native After is not delivered anywhere.

| Surface | Harness | Headless | Hook base | Admission | Lifecycle | Native Before | Native After | Interactions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| modern | claude-code, codex | no | any | available | available | available | unavailable | available |
| modern | claude-code, codex | yes | any | available | available | available | unavailable | unavailable |
| modern | pi, acp, acp-opencode, acp-cursor | no | any | available | available | unavailable | unavailable | available |
| modern | pi, acp, acp-opencode, acp-cursor | yes | any | available | available | unavailable | unavailable | unavailable |
| pty | claude, codex | no | yes | available | available | available | unavailable | available |
| pty | claude, codex | no | no | available | created and exit only | unavailable | unavailable | available |
| pty | claude, codex | yes | yes | available | created and exit only | available | unavailable | unavailable |
| pty | claude, codex | yes | no | available | created and exit only | unavailable | unavailable | unavailable |
| pty | opencode, cursor | no | yes | available | created and exit only | available | unavailable | available |
| pty | opencode, cursor | no | no | available | created and exit only | unavailable | unavailable | available |
| pty | opencode, cursor | yes | yes | available | created and exit only | available | unavailable | unavailable |
| pty | opencode, cursor | yes | no | available | created and exit only | unavailable | unavailable | unavailable |
| pty | pi, shell | no | any | available | created and exit only | unavailable | unavailable | available |
| pty | pi, shell | yes | any | available | created and exit only | unavailable | unavailable | unavailable |
| pty | unknown | any | any | unavailable | unavailable | unavailable | unavailable | unavailable |

Remote (SSH) PTYs: a remote headless session reports Native Before unavailable
because remote hook forwarding is not wired, and a remote launch carries no
OpenCode or Cursor veto and no plugin instructions. The matrix describes local
sessions. Modern native veto covers the tools the provider raises for approval:
Codex web search and MCP tool calls raise none and stay outside it. Modern
OpenCode in ACP full mode is not gated.

Cursor notes (cursor-agent 2026.08.11 source; the hook loading itself is unverified-live, because no logged-in cursor-agent was available):

- PTY Native Before is the blocking `preToolUse` hook of a per-session `--plugin-dir` directory, `failClosed`, so a crash, timeout or invalid reply denies. A command typed into the TUI, Tab completion edits and remote launches are not gated.
- PTY lifecycle stays "created and exit only": no turn-end hook is wired for Cursor, so it never reports active or idle.
- Not delivered on a Cursor PTY: the `zcc-inbox` MCP server and plugin instructions. Cursor asks for per-server MCP approval and keeps it in its own shared data directory (`mcp-approvals.json`), which Zana does not write for a PTY launch; rules and MCP in the plugin directory are unverified-live, so neither is claimed.
- Modern / acp-cursor Native Before stays unavailable: permission requests Cursor raises over ACP are decided by host policy before any allow (unit-tested with the Cursor dialect), but a tool it runs without raising a request is not gated, and request coverage is unverified against a logged-in cursor-agent.

#### Dispatch admission request

Every admitted dispatch carries `surface` (`'modern' | 'pty'`), `entry`, and `origin`.
`entry` is `initial` (a create or a PTY opening prompt), `reply` (a send to an
existing thread or PTY), `fork`, `squad-member-start`, or `job-team-dispatch`.
`origin` is `user`, `agent`, or `system` (Zana-generated turns such as compaction,
wrap-up, and parent notifications). Names a `threadId` for Modern sends and forks,
and a `sessionId` for a PTY reply; an initial dispatch (a Modern create, a PTY
launch prompt) names neither, because the target does not exist yet. A PTY is not
a thread: do not read `threadId` as a thread when `surface === 'pty'`.

Only a Modern reply can be held: `wait` there is recorded and can be released by
the human Send-now action. Create, fork, and every PTY dispatch cannot be held, so
a `wait` is a refusal (error code `dispatch_waiting` or `DISPATCH_WAITING`) and
nothing is recorded or created. Admission failure or timeout always rejects.

##### Prompt text (opt-in)

By default the request carries no prompt content. A plugin that declares
`zcc.promptAccess: true` in its `zcc` manifest block also receives
`prompt: { text, truncated, attachmentCount }` on dispatches that carry text:
Modern create, Modern send, squad member start, and PTY opening prompts, replies,
and Job Team dispatches. A fork carries no text, so it has no `prompt`.
`text` is redacted first (values of token, secret, password, key, and credential
assignments, bearer tokens, well-known API key shapes, and private key blocks are
replaced with `[REDACTED]`), then cut to 32 KiB of UTF-8; `truncated` is true when
anything was cut. `attachmentCount` counts attachments; their content is never
provided. The field is absent for a plugin without the declaration. The host
reads the declaration when it activates the plugin, so a change on disk applies at
the next activation. Redaction is best-effort pattern matching: do not treat the
text as free of sensitive content. Core does not store prompt text in admission
records and does not log it. The 9 s admission deadline and its timeout and
failure semantics are unchanged.

Admitted: Modern create and send, Modern fork, PTY opening prompts (interactive
launch, CLI Agent spawn, control-plane launch), CLI Agent and inbox/menu-bar
reply, and Job Team dispatch (entry `job-team-dispatch`). Not admitted: raw keystrokes (`term.write`), because
terminal input is not a message; Stop and background-task stop; Zana's own PTY
recovery nudges and agent-to-agent mesh messages. A Modern squad member start is
admitted with entry `squad-member-start`; a refusal releases the member's slot.
Raw `term.write` input and restores of an existing session are not admitted.

A registered agent tool (`agents.registerTool`) is reachable from Modern
Claude/Codex threads; `zcc.mcpServers` is the matching path for Claude/Codex
PTY and CLI Agent sessions. Declare both if a tool must work on every
surface supported above — Threads do not read `zcc.mcpServers`, and
PTY/CLI sessions do not read `agents.registerTool`.

### Actor-attributed request input

`ui.requestInput({ threadId, rendererId, title, payload, timeoutMs?, requireHuman? })`
defaults `requireHuman` to `false`. Submitted results include `actor`:
`human | cli | agent | unknown`; the actor is also persisted in the resolution.
Only `requireHuman: true` rejects unproven/agent answers. Bare HTTP is `unknown`,
never human; session-marked HTTP is `agent`. Invalid, forged, expired, mismatched,
or reused proofs return 403. Responses without the opt-in remain usable by agents.

Desktop responses pass through verified main-window IPC. Main sends a short-lived,
single-use MAC proof directly to the product server, bound to thread, interaction,
response body, actor, window/control source and expiry. Proofs never reach plugin
processes, renderer storage, or agent environment.

`zcc thread interactions <threadId> respond <interactionId> --value '<JSON>'`
uses the desktop control socket. Operator-class callers count as `human`; agent
and orchestrator callers remain `agent` and receive 403 for human-required gates.
Known limit: a same-uid process that reads the shared control token and omits its
session fields is classified `operator`. CLI human proof is best-effort; desktop
UI proof is the strong path. Non-desktop HTTP cannot satisfy human-required gates.

#### Request input on a PTY session

`ui.requestInput` also accepts a PTY session id as `threadId`. The prompt appears
as a banner on the session in the Agents monitor and is answered through the same
verified main-window path, with a proof bound to the session id (a separate
signing domain from thread proofs). The `interactions` capability reports it:
available for a PTY shown in the monitor once its `thread.created` event has been
delivered, unavailable for a headless session, which has nothing to present it.
A timeout, a session that ends (`thread-stopped`) or a server restart resolves `cancelled` with that reason.

### Known limits

Stated plainly so a plugin does not assume more than the host wires:

- Cursor: loading of the per-session `preToolUse` hook and Cursor's ACP permission
  coverage are unverified against a logged-in cursor-agent. A Cursor PTY gets no
  `zcc-inbox` MCP server and no plugin instructions.
- OpenCode in ACP full mode is not gated by native tool policy. The OpenCode and
  Cursor PTY vetoes do not cover a command the user types into the TUI.
- Codex: hook trust is scoped to the generated hooks only for a local binary the
  host has verified; otherwise the launch uses `--dangerously-bypass-hook-trust`
  (see above).
- Remote PTYs receive no plugin instructions, and Native Before is unavailable for
  some harnesses (remote headless, OpenCode, Cursor).
- An unbound PTY is not a thread: `threadId` equals `sessionId`, `GET
  /api/v1/sessions/self` returns 404 for it, and the CLI falls back to its
  environment identity.
- Admission does not cover raw `term.write` input or restored sessions.
- Modern lifecycle events carry no `sessionId`; only PTY events do.
- The menu bar shows `ended` as the reason when a dispatch is refused.
- A second project checkout added through `POST /projects/:id/sources` is refused
  for remote project calls unless catalogued on the target machine. This is an
  open product decision.
