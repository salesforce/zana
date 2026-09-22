# Plugins

Give Zana new views, new tools, and new workflows. A plugin is a TypeScript
package that can contribute interface elements, server logic, and agent
capabilities independently. A task board might add a project tab, background
sync, and tools that let an agent update tasks from a Thread.

[![Zana plugin flow: choose and install a package; declare server, app, skills, and MCP contributions in package.json; run trusted server logic and React UI connected by RPC and events; extend agents with skills, Thread tools, and CLI MCP servers; develop with rebuild and reload.](https://raw.githubusercontent.com/salesforce/zana/main/docs/assets/zana-plugins.svg)](https://github.com/salesforce/zana/blob/main/docs/assets/zana-plugins.svg)

[Download the PNG](https://raw.githubusercontent.com/salesforce/zana/main/docs/assets/zana-plugins.png) ·
[Editable artwork and implementation references](https://github.com/salesforce/zana/blob/main/docs/assets/README.md#plugin-explainer-scope)

## What lives in a plugin

The `zcc` block in `package.json` declares what Zana should load. Include the
contributions your plugin needs; a plugin does not have to provide a panel.

| Contribution | Declaration | What it does |
| :--- | :--- | :--- |
| **Server logic** | `zcc.server` | Loads a factory inside the product server. `ZccPluginApi` provides RPC methods, storage, settings, CLI commands, agent tools, and background work. |
| **Interface** | `zcc.app` | Loads a UI bundle. `definePluginApp` registers panels, project tabs, settings, composer actions, and other slots in Zana’s React interface. |
| **Skills** | `zcc.skills` | Lists skill directory roots. Each `skills/<name>/SKILL.md` supplies reusable agent instructions. The default is `["skills"]`; `[]` opts out. |
| **CLI MCP servers** | `zcc.mcpServers` | Declares MCP integrations for supported CLI / PTY sessions. The host namespaces each server as `plugin:<id>:<name>`. |

Conversation **Threads** receive tools registered by server code with
`zcc.agents.registerTool`; they do not read the `zcc.mcpServers` map. A plugin
supporting both surfaces can provide both. Server code can also add session
instructions with `agents.contributeInstructions` and extra skill roots with
`agents.contributeSkills`.

## How the pieces communicate

When you click a button in a plugin panel, the UI can call a server method
through `callPluginRpc`. The server handles the method registered with
`zcc.rpc.method`, performs the operation, and returns a result. It can publish
realtime events to refresh subscribed views. The interface remains a client;
trusted services validate requests and confine paths.

Plugins can also share services. A consumer declares `zcc.requires`, and the
host loads its dependencies first. The experimental `zcc.services` API lets
the consumer call a service another plugin provides. See the
[service contract](extensions-sdk-reference.md#plugin-services-experimental)
before building a dependency between plugins.

## Installation and trust

Install from **Plugins → Browse**, a marketplace entry, or a `path:`, `git:`,
`npm:`, or `builtin:` source. Marketplace entries point to packages; browsing
or refreshing the catalog does not execute plugin code. Install records the
resolved npm version or Git commit, while a local path stays connected to its
working directory.

PluginService validates the manifest and compatible engine versions, then
loads the enabled contributions. **Install and enable are trust decisions:**
plugin server code runs full-trust, in-process on `apps/server`. It is not a
sandboxed Electron guest. The host does not pass daemon tokens or signing keys
through the plugin API.

The installer uses `npm --ignore-scripts` for npm packages and rejects native
addons. UI error boundaries contain rendering failures. These controls do not
turn server plugins into a sandbox. The `zcc.extra` field holds opaque metadata;
the host does not execute it. There is no runtime `registerMcpServer` API.

## Development and lifecycle

Use `zcc plugin dev` for the local edit → build → reload loop. It watches
source changes, rebuilds the app bundle, and reloads the installed plugin.
Path installs load their server entry from source; published packages declare
their built entry points.

| Action | What happens |
| :--- | :--- |
| **Enable** | Loads the server factory and makes the plugin’s declared contributions available. |
| **Reload** | Loads a fresh server generation and refreshes the UI bundle. After a successful replacement, the old instance is disposed. |
| **Disable** | Disposes the live instance and removes its active contributions; the package remains installed. |
| **Needs configuration** | Keeps configuration UI available so you can finish setup. A missing required plugin can also cause this status. |

Register cleanup with `zcc.onDispose` for timers, subscriptions, and resources
your plugin owns. The SDK invokes those hooks when it disposes the instance.

## Docs

- Authoring: [`extensions-authoring.md`](./extensions-authoring.md)
- Quickstart: [`extensions-quickstart.md`](./extensions-quickstart.md)
- SDK: [`extensions-sdk-reference.md`](./extensions-sdk-reference.md)

## Plugin Guide

Open **Plugin Guide** from the **Plugins** hub. It auto-installs on first
launch. The guide is an annotated wireframe map of every surface a plugin can
own — sidebar, project tab, composer, thread chrome, settings, skills, CLI, and
more — with Copy for agent text and links into installed plugin pages. Use it
while authoring; the matching APIs are in the
[SDK reference](./extensions-sdk-reference.md).

## First-party plugins

Ids live in `apps/server/src/plugins/builtin-registry.ts`. Core must not hardcode
them elsewhere.

**Auto-install builtins** (`autoInstall: true`):

| Package | Role |
| --- | --- |
| `plugins/docs` | Docs rail, Library, library-curator skill |
| `provider-claude-code` | Claude Code thread provider |
| `provider-codex` | Codex thread provider |
| `provider-pi` | Pi thread provider |
| `provider-acp` | ACP thread provider (Cursor and OpenCode) |
| `custom-instructions` | Project custom instructions |
| `memory` | Durable global and project memory |
| `ask-user-question` | Agent questions that surface in the Inbox |
| `plugin-guide` | Plugin Guide — annotated SDK surface map under Plugins |

**Official store plugins** (`autoInstall: false` — install from Plugins → Browse
or `zcc plugin install <name>`):

| Package | Role |
| --- | --- |
| `tasks` | Workflow / task board |
| `github` | GitHub developer tools |
| `salesforce` | Salesforce DX inner loop and platform SDK for other plugins |
| `automations` | Automations |
| `workflows` | Workflows |
| `side-chat` | Side chat |
| `inline-vis` | Inline visualizations |
| `provider-retry` | Provider retry |
| `monaco-editor` | Thread code editor (does not replace Explorer) |
| `pdf-preview` | Thread PDF viewer |
| `keep-awake` | Host keep-awake |
| `browser-automation` | Opt-in DevBrowser desktop and local headless sessions |
| `secrets` | Host secrets |
| `connect` | Host connect |

Packages that live under repo `plugins/` today include `docs`, `memory`,
`plugin-guide`, and `salesforce`; other official plugins may ship from the
catalog without a tree copy.

## Official marketplace

First-party Browse listings are authored under repo-root
[`marketplace/entries/`](../marketplace/entries/) (one JSON file per plugin).
`node marketplace/scripts/build.mjs` writes the pointer feed the website serves
at `/marketplace/v1/marketplace.json`. The desktop app seeds that public feed
automatically at start (Official, not removable). Override or disable with
`ZCC_OFFICIAL_MARKETPLACE_URL` (`off` / `0` skips it). See
[`marketplace/README.md`](../marketplace/README.md).

## Internal marketplace (Salesforce)

Salesforce-internal plugins are seeded automatically from git.soma at app
start, beside the public official catalog. The catalog is Official (not
removable). Clone requires VPN/SSO git access; if the repo is unreachable the
seed is skipped and Browse does not show an error.

```bash
zcc marketplace install <plugin-id>@internal
```

Authoring and PR flow live in that repo's README. Override or disable the seed
with `ZCC_INTERNAL_MARKETPLACE_SOURCE` (`off` / `0` skips it).

## CLI

```
zcc plugin new hello --app
cd zcc-plugin-hello
zcc plugin install .
zcc plugin dev
zcc plugin ls
zcc plugin enable <id>
zcc plugin reload <id>
zcc marketplace add https://<PUBLIC_BASE_URL>/marketplace/v1/marketplace.json
zcc marketplace install tasks@official
```

A one-release shim still reads legacy `extension.json` directories.
