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
| `agents.contributeInstructions` / `contributeSkills` / `registerTool` / `configure` | Agent capabilities. `registerTool` takes Zod or JSON Schema `parameters` (parsed on invoke). `configure` sees thread / project / environment / host / provider / `origin` / frozen `pluginMetadata` |
| `ui.requestInput` | Host prompt |
| `status.needsConfiguration` | Degraded-until-configured |
| `sdk.threads` / `sdk.files` / `sdk.environments` / `sdk.providers` | Product SDK: attributed spawn with host, environment and service tier; thread metadata; confined host file read/write; environment PR lookup; provider models discovered on the selected host |
| `sdk.system.defaultHost()` | Primary enrolled host ID, or `null` when none is configured |
| `http.route` | Authenticated plugin HTTP routes; request `headers` and bounded `rawBody` preserve uploaded bytes; response `body` accepts a string or `Uint8Array` |
| `sdk.hosts.list({ signal? })` | Read enrolled machine IDs and names; credentials and connection metadata are excluded. Use an exact ID when machine names are ambiguous. |
| `services.provide` / `services.use` / `services.has` | Experimental plugin-to-plugin SDK (live proxy; `has` after `provide`; `service_unavailable` until provided) |
| `onDispose` | LIFO teardown |

Plugins do not get `ctx.exec` permission tokens. They are full-trust in the
server process and must not be given host-daemon tokens.

`sdk.threads.spawn` accepts `hostId`, `serviceTier: "default" | "fast"` and
`environment: { kind: "unmanaged" | "personal" | "worktree" | "reuse", ... }`.
The server validates environment choices and authorizes host/project access.
Omit the environment to use the project's default. Provider model discovery
accepts `hostId` and returns `modelLoadError` when discovery fails.

`sdk.files.read` and `sdk.files.write` resolve an omitted `hostId` to the
primary host and retain the host file service's path confinement.
`sdk.environments.pullRequest({ environmentId })` returns `pullRequest` or
`unavailableReason`. Thread summaries include titles and update timestamps.
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
org credentials. Reuse + extraction map: `plugins/salesforce/SDK.md`.

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

- `projectTab` — per-project rail tab (`global: false` hides the sidebar entry). Use `header: 'custom'` when the component supplies its own toolbar; render its `headerActions` prop there to retain the host split-pane controls without an extra title row.
- `experimental_agentsBoardAction` — toolbar control on the Agents board (`projectId` is `null` on the cross-project Agents nav)
- `experimental_agentCardAction` — right-click item on an Agents board card
- `experimental_threadCardAction` — right-click item on a Modern conversation card. `isAvailable` and `run` receive host-derived `threadId` and `projectId`
- `projectStatusbarItem` — project statusbar chip (`align` left/right; `run` may `toProject` / `toPluginPanel` / `openDialog` / `openMenu`)

### Home

- `homepageSection` — card on the Home compose surface
- `experimental_newThreadPanelAction` — CTA under New Chat compose (can open a compose-time side panel)

### Composer

- `composer` — `composer.customize`: actions, banners, plus-menu items, meta chips, advanced fields, and rich-text effects. Scope to `thread`, `new-thread`, `cli-agent`, `queued-message`, or `side-chat`. `useComposer().experimental_setLaunchPatch` overlays spawn extraArgs / profile / routing

### Thread

- `threadPanelAction` — thread side-panel tabs; optional `scopes` include `"agent-session"` for the CLI-agent inspector. Both this slot and `experimental_newThreadPanelAction` accept an optional `category` label for the New Tab launcher. Omit it to group under the installed plugin’s display name. Categories are collapsible; search matches tool titles and category names across all groups. The optional `icon` is shown beside the tool.
- `pendingInteraction` — custom in-thread prompt UI (`id` must match `zcc.ui.requestInput` `rendererId`)
- `experimental_threadHeaderAction` — action in the thread detail header
- `experimental_threadList` — replace the Agents list pane (exclusive; last registered wins Appearance pin)
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
- `contentScripts` — `contentScripts.register`
- `experimental_providerIcon` — picker glyph for a provider id

Registrations replace wholesale per plugin id. Each carries a `generation` used
as the React remount key. Wrap UI in `PluginSlotBoundary`. Live-reload with
`zcc plugin dev`.

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
| `zcc.ui.interactions.get/upsert/acknowledge/cancel` | Resumable, correlation-keyed interactions. `upsert({ projectId, correlationId, kind, payload })` is idempotent per correlation id. Bounded per plugin+project (100) and globally (10,000); exceeding the quota throws `INTERACTION_CAPACITY_EXCEEDED`. Ack/cancel free capacity; active rows are never evicted. Unacknowledged rows age out to `ack-timeout` after 30 days and are retained as a terminal tombstone for 7 more days. |
| `zcc.hooks.on(handler)` | One message-dispatch admission handler per plugin. `handler({ dispatchId, threadId, projectId, generation })` returns `{ action: 'proceed' }`, `{ action: 'wait', reason, overrideable }`, or `{ action: 'reject', message }`. A `reject` is terminal and cannot be bypassed. A `wait` can only be overridden by an explicit, authenticated human Send-now action in the UI — a plugin, agent, or programmatic caller can never invoke the override itself. `overrideable: false` additionally blocks even the human override (force-flush included). |
| `zcc.sdk.capabilities.forThread({ threadId })` / `forExecution({ executionId })` | Live capability descriptors (`{ id, available, reason? }`) derived from main's own registered host/provider state — never from a caller-supplied provider id, so a spoofed id cannot report a capability as available that main did not actually wire. `forExecution` always reports provider-specific descriptors (native tool hooks) as unavailable, since an execution can span more than one provider slot. |
| `zcc.ui.registerProjectTabAvailability({ tabId, evaluate })` | `evaluate({ projectId })` returns `{ available, reason? }` for a `projectTab` registered by the same plugin. An unavailable tab stays visible, disabled, with the bounded `reason` shown to the user — it never silently disappears. A throwing/erroring `evaluate` degrades to unavailable rather than crashing the tab. |
| `zcc.agents.registerPersonas(personas)` / `registerTeams(teams)` | Namespaced persona/team contributions (`ext:<pluginId>:<slug>` ids), host-stamped provenance. Replaces this plugin's own prior generation wholesale on each call; cannot override a user or built-in record. Cleared automatically on uninstall, disable, or crash. |

Lifecycle events (`PluginThreadEvent` from `zcc.events.on`) now always carry a
host-generated `id`, a process-local `sequence`, and a `timestamp` — do not
derive identity from event content, and do not expect a durable replay stream;
delivery is best-effort.

### Native tool policy (Claude / Codex only)

A native pre/post tool hook is capability-gated per provider family and only
exists for Claude and Codex today (`zcc.sdk.capabilities.forThread` reports
`tool-before-native` / `tool-after-native` availability per thread). Every
other provider reports those two capabilities unavailable — there is no
native hook to register against. The lifecycle for an intercepted invocation
is strictly ordered and exactly-once-terminal:

```
announced -> awaiting-decision -> allowed|denied -> executing -> succeeded|failed|cancelled
```

A `denied` decision blocks the tool's side effect before it starts; a
transport failure or decision timeout fails closed (denied), never open. Each
`invocationId` is unique per provider turn/tool call and deduplicated at the
server boundary, so a retried request with the same id replays the same
decision rather than re-deciding.

| Provider | Native before/after | Delivery surface |
| --- | --- | --- |
| Claude (Modern) | native | `agents.registerTool` |
| Claude (PTY / CLI Agent) | native | `zcc.mcpServers` |
| Codex (Modern) | native | `agents.registerTool` |
| Codex (PTY / CLI Agent) | native | `zcc.mcpServers` |
| Cursor | unsupported | — |
| OpenCode | unsupported | — |

A registered agent tool (`agents.registerTool`) is reachable from Modern
Claude/Codex threads; `zcc.mcpServers` is the matching path for Claude/Codex
PTY and CLI Agent sessions. Declare both if a tool must work on every
surface listed as native above — Threads do not read `zcc.mcpServers`, and
PTY/CLI sessions do not read `agents.registerTool`.
