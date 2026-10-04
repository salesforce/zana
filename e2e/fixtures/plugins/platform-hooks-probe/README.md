# platform-hooks-probe (fixture)

Disposable, test-only plugin. Exercises every platform plugin hook surfaced
to a plugin app/server/host entry so E2E specs and manual passes have one
project tab that proves the whole platform-hooks surface works end to end.
Never ship this under `plugins/` or to the marketplace — see `extra.notes`
in `package.json`.

## Layout

- `package.json` — manifest: `server`/`app`/`host` entries, `skills`,
  `projectTab` (project-tab-only, `global: false`), `mcpServers` (one stdio
  server, `alwaysOn: false`).
- `server.ts` — plugin server: registers the `platform_hooks_probe_marker`
  agent tool, `probe-reviewer` persona + `Probe Pair` team, RPC methods
  backing every panel section, the dispatch-admission hook, and lifecycle
  event listeners.
- `app.tsx` — plugin app: one project-tab panel (`HooksProbePanel`) with a
  `Section` per hook (Project Host RPC, Interactions, Dispatch Policy, Tool
  Policy, Capabilities, Lifecycle, Contributions, Availability), a pending-
  interaction renderer, and the `experimental_projectMenuAction` enable/disable
  toggle.
- `host.ts` — project-host RPC contract (`inspectContext`, `slowProbe`)
  defined via `defineRpcContract`/`experimental_defineHostEntry`.
- `mcp-server.js` — standalone stdio MCP server (plain runnable `.js`, no
  build step) exposing the `platform-hooks-probe` tool. Spawned by the host
  as `node ./mcp-server.js` with its cwd inherited from the Claude CLI
  process, which is the project root.
- `skills/hooks-probe/SKILL.md` — skill contributed into any project where
  this plugin is installed and enabled, documenting the agent tool and
  dispatch-policy surfaces for an operating agent.
- `tsconfig.json` — standalone project config (this fixture is not part of
  the pnpm workspace); maps `@zana-ai/zcc-plugin-sdk*` subpaths directly at
  `packages/plugin-sdk/src/*.ts` source, since the package's bundled
  `.d.ts` types lag newer SDK APIs.

## Tool Policy marker

Both the agent tool (`server.ts`, via `zcc.sdk.files.*Project`, CAS-retried)
and the MCP tool (`mcp-server.js`, via plain `node:fs`, tmp+rename atomic
write) record invocations into the same bounded project file,
`.zcc-hooks-probe/tool-marker.json`. There is no RPC/HTTP callback channel
from a plugin-contributed MCP child back into its own plugin process, so the
shared project file — written independently by each side, confined to a
fixed relative path with no caller-supplied path and no shell — is the only
mechanism that lets the Tool Policy panel observe either kind of invocation.

## Enabling on a project

Install the plugin, open the project, then use the project overflow menu's
"Enable/Disable Hooks Probe" action (`experimental_projectMenuAction`,
`toggle-hooks-probe`). The panel's Availability section reflects the current
enabled state for the scoped project.
