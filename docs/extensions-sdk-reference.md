# Plugin SDK reference

Package: `@zana-ai/zcc-plugin-sdk` (`PLUGIN_SDK_VERSION` / `engines.zccPluginSdk`).

## Server — `ZccPluginApi`

Handed to `export default function plugin(zcc)`.

| Surface | Purpose |
| --- | --- |
| `pluginId` | Derived id |
| `log` | debug/info/warn/error |
| `settings.define` | Declarative settings the host/CLI can render |
| `storage.kv` | Per-plugin KV |
| `rpc.method` | Renderer/host RPC |
| `realtime.publish` | Events |
| `background.service` / `schedule` | Long-running work |
| `agents.contributeInstructions` / `contributeSkills` | Agent capabilities |
| `ui.requestInput` | Host prompt |
| `status.needsConfiguration` | Degraded-until-configured |
| `services.provide` / `services.use` / `services.has` | Experimental plugin-to-plugin SDK (live proxy; `has` after `provide`; `service_unavailable` until provided) |
| `onDispose` | LIFO teardown |

Plugins do not get `ctx.exec` permission tokens. They are full-trust in the
server process and must not be given host-daemon tokens.

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

Slots (also mapped in the in-app Plugin Guide):

- `navPanel` — sidebar entry + full view, or `placement: "extensions"` under Plugins
- `settingsSection` — plugin settings on the Plugins hub detail (Configure)
- `homepageSection` — Home dashboard
- `projectTab` — per-project tab (`global: false` hides the sidebar entry)
- `experimental_projectMenuAction` — project row overflow or workspace organize menu (`toProject` opens a `projectTab`)
- `experimental_createProjectAction` — Add project (+) menu (`openDialog` mounts an optional create wizard; `addProject` registers the folder)
- `sidebarFooterAction` — host-rendered footer icon
- `pendingInteraction` / `threadPanelAction` (thread side-panel tabs; optional
  `scopes` include `"agent-session"` for the CLI-agent inspector) /
  `experimental_newThreadPanelAction` /
  `experimental_threadList` / `experimental_threadHeaderAction` — thread chrome
- `fileOpener` / `messageDirective` / `messageAction` / `experimental_timelineRenderer`
- `experimental_agentCardAction` / `experimental_agentsBoardAction`
- `commandPaletteAction` / `experimental_providerIcon`
- `composer.customize` / `contentScripts.register`

Headless (no pixels): `zcc.skills` / `contributeSkills`, `zcc.cli`, `zcc.mcpServers`,
`zcc.settings.define`, `zcc.background`.

Registrations replace wholesale per plugin id. Each carries a `generation` used
as the React remount key. Wrap UI in `PluginSlotBoundary`. Live-reload with
`zcc plugin dev`.

## Manifest

`package.json` `zcc` block, parsed by `@zana-ai/zcc-domain` `readPluginManifest`.
Id from `derivePluginId(package.name)`. Reserved sentinel `__builtin__` is
host chrome, not a plugin.

| Field | Meaning |
| --- | --- |
| `skills` | Directory roots (BB). Default `["skills"]`; `[]` opts out. Each child dir with a regular `SKILL.md` is a skill named after the folder. |
| `mcpServers` | Map of Claude CLI MCP servers. stdio `command` is basename-only; relative `args` are rewritten to contained paths. |
| `extra` | Opaque JSON object (≤32 keys, ≤8 KiB). Displayed on install; never synced as skills/MCP. |
| `requires` | Other plugin ids this plugin consumes via `zcc.services.use`. Host topo-sorts load order. A missing required plugin marks the consumer `needs-configuration`. |

Durable skills belong in `zcc.skills`. `agents.contributeSkills` is a runtime extra. There is no `registerMcpServer`.

Do not put secrets in `extra`. Env values on `mcpServers` are written to `.mcp.json` only — the hub sees `envKeys`.

Legacy `extension.json` is shimmed for one release via `shimLegacyExtensionManifest`.
