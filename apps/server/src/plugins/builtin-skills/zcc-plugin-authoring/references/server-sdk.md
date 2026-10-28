# Server SDK

Server factory:

```ts
export default function plugin(zcc) {
  zcc.log.info(`${zcc.pluginId} loaded`);
}
```

`zcc` is `ZccPluginApi`. Use `zcc.pluginId`, `zcc.log`, `zcc.settings`, `zcc.storage`, `zcc.http`, `zcc.rpc`, `zcc.realtime`, `zcc.background`, `zcc.cli`, `zcc.agents`, `zcc.events`, `zcc.ui`, `zcc.status`, `zcc.sdk`, `zcc.host`, `zcc.services`, and `zcc.onDispose`.

Settings descriptors use `type: "string"`, `type: "boolean"`, `type: "number"`, `type: "select"`, or `type: "project"`. `zcc.storage.kv` supplies `get`, `set`, `delete`, and `list`; `storage.database()` is per-plugin SQLite. `zcc.http.route` serves under `/api/v1/plugins/<id>/http<path>`. `zcc.rpc.method` and `rpc.register` expose renderer RPC. `zcc.background.service` and `schedule` run durable work. `zcc.cli.register` adds command; core `zcc` names win and output overflow raises `plugin_cli_output_too_large`.

`zcc.agents.contributeInstructions`, `contributeSkills`, `registerTool`, `experimental_registerProvider`, `experimental_registerPtyHarness`, and `configure` shape agent sessions. CLI Agent/PTy sessions need `zcc.mcpServers`, not conversation-only tools. Thread events are `"thread.created"`, `"thread.active"`, `"thread.idle"`, `"thread.failed"`, `"thread.archived"`, and `"thread.deleted"`; payload exposes `name`, `threadId`, `projectId`, `thread`, `lastAssistantText`, and `error`.

Use `zcc.sdk.threads.spawn` with optional `pluginMetadata`, plus `output`, `stop`, `archive`, `fork`, `unarchive`, `getPluginMetadata`, and `updatePluginMetadata` for thread work. Metadata is namespaced, atomically patched, capped, and omitted from ordinary thread GET. Use `zcc.sdk.files.read/write` only through host-confined workspace roots. `zcc.sdk.projects.list/setIcon`, `sdk.system.defaultHost`, `sdk.environments`, `sdk.providers.models`, and `sdk.inbox.push` retain host authorization.

`zcc.services.provide/use/has` is live plugin-to-plugin API. Declare `zcc.requires` and import types from provider SDK; do not import provider internals or expose tokens. `zcc.host.experimental_call` and `experimental_client` require configured host entry. Register `zcc.onDispose` cleanup.
