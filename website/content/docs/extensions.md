# Plugins

Zana Command Center plugins are **full-trust TypeScript packages**, not sandboxed
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

## Docs

- Authoring: [`extensions-authoring.md`](./extensions-authoring.md)
- Quickstart: [`extensions-quickstart.md`](./extensions-quickstart.md)
- SDK: [`extensions-sdk-reference.md`](./extensions-sdk-reference.md)

## First-party plugins

| Package | Role |
| --- | --- |
| `plugins/docs` | Builtin (`autoInstall: true`) — Docs rail, Library, library-curator skill |

Core must not hardcode those ids outside `apps/server/src/plugins/builtin-registry.ts`.

## CLI

```
zcc plugin new hello --app
cd zcc-plugin-hello
zcc plugin install .
zcc plugin dev
zcc plugin ls
zcc plugin enable <id>
zcc plugin reload <id>
zcc marketplace add https://example/index.json
zcc marketplace install tasks@official
```

A one-release shim still reads legacy `extension.json` directories.
