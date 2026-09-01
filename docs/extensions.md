# Plugins

Zana plugins are **full-trust TypeScript packages**, not sandboxed
Electron guests.

- Manifest: `package.json` → `zcc` (not `extension.json`)
- Skills: `zcc.skills` directory roots (`skills/<name>/SKILL.md`), default `["skills"]`
- MCP: `zcc.mcpServers` map (Claude CLI); host namespaces `plugin:<id>:<name>`
- Extra: `zcc.extra` opaque bag (not executed)
- Server: `zcc.server` loads **in-process** on `apps/server` via `ZccPluginApi`
- App: `zcc.app` registers **slots** with `definePluginApp`
- Install sources: `path:` / `git:` / `npm:` / `builtin:` / marketplace pointers
- Trust control is **install/enable**, exact version pinning, `engines.zcc`,
  `npm --ignore-scripts`, native-addon rejection, UI error boundaries

Host-daemon tokens and signing keys never reach a plugin. Renderer input stays
untrusted; the server still confines paths.

The in-app **Plugins** hub (Installed + Browse) is ZCC's catalogue. It is not
Claude Code's `~/.claude/plugins` folder — that remains a Claude Code
compatibility surface and is not a competing Settings destination.

## Docs

- Authoring: [`extensions-authoring.md`](./extensions-authoring.md)
- Quickstart: [`extensions-quickstart.md`](./extensions-quickstart.md)
- SDK: [`extensions-sdk-reference.md`](./extensions-sdk-reference.md)

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
| `provider-acp` | ACP thread provider (Cursor and other ACP harnesses) |
| `custom-instructions` | Project custom instructions |
| `ask-user-question` | Agent questions that surface in the Inbox |

**Official store plugins** (`autoInstall: false` — install from Plugins → Browse
or `zcc plugin install <name>`):

| Package | Role |
| --- | --- |
| `tasks` | Workflow / task board |
| `github` | GitHub developer tools |
| `salesforce` | Salesforce DX inner loop |
| `automations` | Automations |
| `workflows` | Workflows |
| `side-chat` | Side chat |
| `inline-vis` | Inline visualizations |
| `provider-retry` | Provider retry |
| `memory` | Durable memory |
| `keep-awake` | Host keep-awake |
| `secrets` | Host secrets |
| `connect` | Host connect |

Packages that live under repo `plugins/` today include `docs` and `salesforce`;
other official plugins may ship from the catalog without a tree copy.

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
