# ZCC Extension SDK Reference

`@zana-ai/zcc-extension-sdk` is the complete public contract for Zana Command Center
extensions. Import only from these package entry points; extensions must not
import application internals.

Install it from npm with `npm install --save-dev @zana-ai/zcc-extension-sdk`. The
SDK follows SemVer; install a compatible major range rather than `*` in a
published extension.

## Package entry points

| Import | Exports | Intended process |
|---|---|---|
| `@zana-ai/zcc-extension-sdk` | Manifest, permission, registry, API-version types and helpers | Either |
| `@zana-ai/zcc-extension-sdk/renderer` | Renderer entry, host API, events, panels, commands, UI types | Renderer |
| `@zana-ai/zcc-extension-sdk/main` | Main module, brokered context, lifecycle, persona/team types | Main |
| `@zana-ai/zcc-extension-sdk/helpers` | `parseFrontMatter`, `unwrapBareFence` | Either |
| `@zana-ai/zcc-extension-sdk/testing` | `createMockHost`, `createMockMainContext`, `flushMicrotasks` | Tests only |

## Root entry point

`SDK_API_VERSION` is the integer API version the host uses to accept an
extension's `engines.zccApi` range. Set that manifest value; do not calculate
host compatibility from the app release version.

`EXTENSION_PERMISSIONS` is the runtime permission-token list and
`isExtensionPermission(value)` narrows an arbitrary string to a valid token.
The token vocabulary is:

`storage`, `projects:read`, `projects:select`, `session:launch`,
`session:reply`, `external:open`, `inbox:push`, `ssh:hosts`, `exec`, `fs:read`,
`fs:write`, `net`, `mcp`, `llm:invoke`, `stream`, and `agent:contribute`.

Use `defineModule(module)` or `defineMainModule(module)` as typed identity
helpers when declaring a compiled-in renderer or main module. Runtime disk
extensions declare their metadata in `extension.json` and default-export the
corresponding renderer/main entry.

Registry tooling can use these pure helpers:

| Helper | Behavior |
|---|---|
| `checkApiCompat(range, current?)` | Tests integer or major-version compatibility and fails closed for invalid input. |
| `compareVersions(a, b)` | Compares three numeric SemVer components; prerelease/build suffixes are ignored. |
| `pickBestRelease(index, id, current?)` | Returns the highest API-compatible `RegistryRelease` for an id, or `null`. |

`ExtensionManifest` includes `id`, optional `version` and package-generated
`build`, `title`, `icon`, optional `titleLabel`, `entry`, `engines`, optional
`permissions`, optional `permissionScopes`, optional `projectTab`, optional
`agentPreset`, optional `skills`, and optional `mcpServers`. `skills` is an
array of `{ path, slug? }`; `mcpServers` contains `{ name, type, command?,
args?, url?, env?, alwaysOn? }`. Both require `agent:contribute`; skill paths
are confined to the extension directory, and contributed server names are
host-namespaced. `RegistryIndex` is `{ schema: 1, releases }`; each
`RegistryRelease` declares id, version, API range, URL, SHA-256, optional
signature/permissions, and optional marketplace metadata.

## Manifest permissions and scopes

Disk extensions are deny-by-default. Their effective grant is the intersection
of declared and user-consented permissions. A permission requiring a scope is
still denied when the corresponding scope is absent or empty.

| Permission | Surface | Required scope |
|---|---|---|
| `storage` | `host.storage`, `ctx.storage` | None |
| `projects:read` | `host.getActiveProject`, `host.listProjects` | None |
| `projects:select` | `host.selectProject`, `ctx.host.selectProject` | None |
| `session:launch` | `host.launchSession`, `ctx.host.requestLaunch` | None |
| `session:reply` | `host.replyToSession`, `host.writeToSession` | None |
| `external:open` | `host.openExternal` | None |
| `inbox:push` | `host.pushInbox`, `ctx.inbox.push` | None |
| `ssh:hosts` | `ctx.sshHosts` | None |
| `exec` | `ctx.exec` | `execAllowlist` |
| `fs:read` | `ctx.fs.readFile/readdir/stat/exists` | `fsRoots` |
| `fs:write` | `ctx.fs.writeFile/rm` | `fsRoots` |
| `net` | `ctx.fetch` | `egressAllowlist` |
| `mcp` | `ctx.mcp` | `mcpAllowlist` |
| `llm:invoke` | `ctx.llm` | None; the app-wide LLM switch must also be enabled |
| `stream` | `ctx.stream` | `streamAllowlist` |
| `agent:contribute` | Manifest `skills` and `mcpServers` | None |

`execAllowlist` accepts executable basenames, `egressAllowlist` accepts hosts,
`mcpAllowlist` accepts host-registered server ids, and `streamAllowlist` accepts
host-registered endpoint handles. These four lists may be `['*']`; consent makes
that unrestricted scope explicit. `fsRoots` has no wildcard and is realpath
confined. The extension directory is implicitly readable.

## Renderer API

A runtime renderer default-exports `RendererEntry`:

```ts
import type { RendererEntry } from '@zana-ai/zcc-extension-sdk/renderer';

const entry: RendererEntry = {
  activate({ React, host }) {
    return () => React.createElement('div', null, host.moduleId);
  },
};
export default entry;
```

The host supplies its React instance. Do not bundle another React instance.
`activate` returns a panel component or an `ActivateResult` with any of
`panel`, `settingsPanel`, `background`, `commands`, and `navBadge`.

### ModuleHost

| Member | Behavior |
|---|---|
| `moduleId` | Read-only current extension id. |
| `call<T>(capability, ...args)` | Invokes this extension's main capability; rejects on capability/main-child failure. |
| `storage.get/set` | Persistent JSON data. |
| `cache.get/set/delete/refreshBadge` | Synchronous in-memory data that survives panel unmount but not restart. |
| `openExternal(url)` | Opens an http(s) URL; requires `external:open`. |
| `pushInbox({ projectId?, comments?, docs? })` | Appends inbox content; requires `inbox:push`; resolves `{ id }`. |
| `toast(message, kind?)` | Shows an info/error toast. |
| `relaunchSelf()` | Restarts this extension's disk main child; resolves true once ready. |
| `getActiveProject()` | Gets selected `ProjectInfo` or null; requires `projects:read`. |
| `getScopedProjectId()` | Gets the project-tab/scoped-window id or null in the global shell. |
| `listProjects()` | Gets `ProjectInfo[]`; requires `projects:read`. |
| `ensureQuickAgent()` | Gets or creates the scratch project; resolves `ProjectInfo` or null. |
| `selectProject(id)` | Selects a project or clears selection; requires `projects:select`. |
| `launchSession(opts)` | Launches a session using project id, optional persona/args/title/cwd; requires `session:launch`; resolves `{ id }` or null. |
| `listPersonas()` | Gets `PersonaInfo[]` for session launch pickers. |
| `replyToSession(id, text)` | Writes text plus Enter; requires `session:reply`. |
| `writeToSession(id, data)` | Writes raw terminal data without Enter; requires `session:reply`. |
| `on(event, callback)` | Subscribes to a typed host event or extension-private `ext:<topic>` event. |
| `subscribe(subId, onFrame, onDone?)` | Receives frames for a stream opened by main `ctx.stream`. |
| `register(disposable)` | Registers idempotent cleanup at unmount/extension teardown. |
| `confirm`, `quickPick`, `prompt`, `alert`, `withProgress` | Promise-based host-rendered UI. Dismissals resolve false or null; progress supplies an `AbortSignal`. |

`ProjectInfo` is `{ id, name, path, remote? }`; `PersonaInfo` is
`{ id, name, icon?, description? }`; `SessionInfo` is
`{ id, projectId, title, status }`.

`HostEvents` has `project:changed`, `nav:changed`, `session:updated`,
`session:agentStatus`, `session:exit`, `inbox:appended`, `inbox:removed`,
`schedule:changed`, `mcp:changed`, and `skills:changed`. Events are read-only,
payloads are JSON-serializable, and distinct event types have no ordering
guarantee.

Main code calls `ctx.emit(topic, payload)` and panels subscribe through
`host.on('ext:<topic>', callback)`. For a continuous source, main opens
`ctx.stream`, passes its `subId` through an extension capability, and the panel
calls `host.subscribe`. Release both the renderer subscription and main `close()`.

`primeModuleHost(host)`, `getModuleHost()`, and `setModuleHostForTesting(host)`
support non-React code in the same renderer bundle. `getModuleHost()` returns
null until activation primes it; reset the test override to null in teardown.

`ExtensionCommand` supports `id`, `label`, `run`, optional `keywords`, `icon`,
`category`, and host-evaluated `when`. The `when` grammar supports `!`, `&&`,
`||`, parentheses, `==`, and `!=` over `activeNav`, `hasActiveProject`,
`hasActiveTab`, `tabCount`, `activeTabStatus`, `activeTabProfile`,
`workspaceMode`, `platform`, and `panelFocused`. Invalid expressions hide the
command.

## Main API

A runtime main bundle default-exports `MainModule`. `setup(ctx)` returns named
capabilities whose values must be JSON-serializable over IPC. `ModuleCapability`
may be sync or async.

| Main context member | Behavior |
|---|---|
| `storage.get/set`, `log`, `register` | Persistent data, structured logging, and cleanup. Disk `storage.get` may be async. |
| `exec(req)` | No-shell executable call. `ExecRequest` is `{ bin, args?, cwd?, timeoutMs? }`; a nonzero exit resolves `ExecResult`, while spawn/timeout/output failures reject. |
| `fs` | `readFile`, `writeFile`, optional `rm`, `readdir`, `stat`, and `exists`; realpath-confined by scope. `rm` is file-only and missing-safe. |
| `fetch(url, init?)` | Bounded request using `{ method?, headers?, body? }`; returns `{ status, ok, headers, body }`. |
| `mcp(serverId, tool, args?, opts?)` | Calls a persistent host-managed MCP server and resolves parsed result. `opts` may supply a confined `projectPath` or `useGlobal`. |
| `mcpInitWorkspace(opts?)` | Optional, user-initiated initialization for a host-managed MCP workspace; requires the same `mcp` grant and scope as `mcp`. |
| `resolveProjectRoot(opts)` | Optional host service returning confined `{ root, kind: 'project' \| 'global' }`. |
| `personas` / `teams` | Registers host-sanitized, lifecycle-bound metadata. Input ids are host-namespaced. |
| `sshHosts` | Registers this extension as the optional SSH-host provider. Its main capabilities must expose `listSshHosts()` returning structured `{ alias, hostname?, user?, proxyJump? }` rows and may expose `syncSshHosts()` returning `{ hosts: rows, warning?: string }`. Requires `ssh:hosts`. |
| `summarizeSession(id, { scope? })` | Optional host service returning `{ ok, text? }` for an authorized session's last turn. |
| `stream(endpoint, opts?)` | Opens a bounded host-managed feed and returns `{ subId, close }`. |
| `emit(topic, payload)` | Sends a bounded private renderer event. |
| `llm(req)` | Runs a host-selected, bounded micro-call with `{ system, user, model?, maxOutputChars? }`, returning `LlmInvokeResult`. |
| `host` | Requests `toast`, `navigate`, `selectProject`, `requestLaunch`, `confirm`, or `alert` from the shell. |
| `inbox.push(input)` | Appends a durable Inbox entry with `{ projectId, comments?, docs?, target? }`; requires `inbox:push`; resolves `{ id }`. The host stamps `extensionSource` from this extension's authenticated id — unlike `host.alert`, the entry persists and counts toward the Inbox badge. `target: { moduleId }` redirects a click on the resulting notification (native OS alert or the bell drawer row) to this extension's own surface instead of the default Inbox landing — see "Click-navigation targets" below. |

All brokered members are optional. Check availability and handle a missing
service safely. `LlmInvokeResult.code` is `disabled`, `unavailable`,
`rate-limited`, `busy`, `invalid-request`, or `provider-error` when `ok` is
false.

`host.requestLaunch` returns a request id. A disk extension's request is parked
for human confirmation even when it sets `autoLaunch`; the host re-authorizes
the project, cwd, persona, and flags. `host.confirm` fails closed to false and
`host.alert` resolves null when no panel is available.

**Click-navigation targets.** By default, clicking a notification produced from
`ctx.inbox.push` (the native OS alert for a `notify: 'loud'` entry, or a row in
the bell's `NotificationsDrawer`) opens that specific entry in the Inbox. Pass
`target: { moduleId }` to send the click somewhere else instead — your own
project-tab panel or sidebar module — using your OWN extension's module id
(the same id declared in `extension.json`). The host rejects a `target` naming
any other module at push time, and re-checks it again at click time against the
live module registry, falling back to the default Inbox landing if your module
has since been disabled or uninstalled. See "Click-navigation targets" in
`extensions-authoring.md` for a worked example.

`teardown()` releases process resources on disable, uninstall, and hot reload.
`onInstall(ctx)` runs once after a successful setup following explicit install or
reinstall, never normal boot. `onUninstall(ctx)` runs once while the child is
alive before teardown/removal; use it for resources outside the extension
directory. Both are sandboxed and best-effort; the host removes extension storage
after uninstall.

## Testing and helpers

```ts
import {
  createMockHost,
  createMockMainContext,
  flushMicrotasks,
} from '@zana-ai/zcc-extension-sdk/testing';

const host = createMockHost({
  call: async (name) => name === 'load' ? [{ id: 'row-1' }] : undefined,
});
const ctx = createMockMainContext();
await ctx.storage.set('view', 'table');
await flushMicrotasks();
```

The host mock has real in-memory storage/cache and safe UI defaults: confirm is
false, picker/prompt/notification are null, and progress executes the task. The
main mock has storage and no-op filesystem methods; other brokered services are
absent until tests override them. Both mocks expose registered cleanup callbacks
through a non-enumerable `__disposables` property.

`parseFrontMatter(raw)` returns null without a leading `---` metadata block or
returns `{ meta, body }`; recognized metadata is id, title, summary, tags, source,
and numeric createdAt. `unwrapBareFence(text)` unwraps an entire markdown-shaped
response accidentally surrounded by a triple-backtick fence and leaves ordinary
code blocks intact.

## Runnable example

`tools/create-zcc-extension/template` is the maintained executable example.
Create one with:

```sh
npx create-zcc-extension my-extension
cd my-extension
npm install
npm run typecheck
npm run build
```

The renderer demonstrates injected React, a typed main capability call, command,
background host event, cache-backed badge, and Settings panel. The main entry
demonstrates `defineMainModule`, logging, storage, a capability, and `onInstall`.
It intentionally uses only the minimum permissions; add a broker permission and
narrow scope only when the feature needs it.
