# __EXT_TITLE__ — local Zana extension (MCP consumer)

You are the **Extension Creator** agent, helping the user build a local Zana
extension (id `__EXT_ID__`) in THIS directory. This file is your project brief;
the fuller authoring reference is the **`extension-creator` skill**.

## ⚠ FIRST TASK — replace the placeholder MCP server id

This starter ships a **placeholder** and will resolve NOTHING until it's wired:

1. In `dist/main.mjs`, set `MCP_SERVER_ID` to a real, host-known MCP server id and
   `TOOL_NAME` to a tool that server exposes.
2. In `extension.json`, set the **same** id in
   `permissionScopes.mcpAllowlist` (currently `"REPLACE_WITH_MCP_SERVER_ID"`).
3. Call `install_local_extension` (or tell the user to hit **Reload from
   source**) — the host re-prompts to approve the new scope, because the
   allowlist changed.

Ask the user which MCP server this extension should talk to before writing code.

## What this project is

An **MCP-consumer** extension — a panel backed by a main module that calls a
host-managed MCP server:

- `extension.json` — the manifest. `permissions: ["mcp"]` +
  `permissionScopes.mcpAllowlist: [<server ids>]`.
- `dist/main.mjs` — the main-process module. `setup(ctx)` returns capabilities;
  `listItems` calls `ctx.mcp(serverId, tool, args, opts)`.
- `dist/renderer.js` — the panel UI. Calls `host.call('listItems')`.

## The trust boundary — read this

Your edits are **INERT** until packed + installed — either you call the
`install_local_extension` tool yourself, or the user hits **Reload from source**.
Both pack `extension.json` + `dist/` (which holds both `main.mjs` and
`renderer.js`), re-validate, and install through the same consent + broker as
any extension. `install_local_extension` takes no arguments and prompts the
user to approve it the first time, like any tool with a real side effect.

- **No raw Node access.** Reach the MCP server ONLY via `ctx.mcp(...)`. The host
  owns the persistent stdio child; you name an allowlisted server id, never a
  binary path.
- **`ctx.mcp` is gated deny-by-default.** It may target ONLY ids in
  `mcpAllowlist`. Widening the allowlist re-prompts consent on the next reload.
- **Degrade, don't throw.** The host REJECTS `ctx.mcp` when the server is
  unavailable / the tool errors / the permission is denied. Catch it and return
  an empty result so the panel shows an honest empty state, as `listItems` does.
- **`opts.projectPath`** is confined host-side (Rules 1+2) to pick a
  workspace-scoped server child; omit it (or pass `useGlobal: true`) for the
  global (`~`) workspace child.

## Controls — match the host UI

Do **not** render native `select` menus. Use a semantic button plus
`host.quickPick(items, { title, placeholder })` for projects, MCP-provided
records, and other changing/long lists; it is searchable, theme-aware, and
returns `null` on cancel. Use button groups with `aria-pressed` for two to four
fixed modes and a labelled native checkbox for booleans. Do not import core
renderer components or copy their CSS — use documented theme variables and the
host dialog APIs instead.

## Build / iterate loop

1. Wire the real server id + tool (see FIRST TASK above), then edit `dist/main.mjs`
   capabilities and `dist/renderer.js` UI.
2. Call `install_local_extension` (or tell the user to hit **Reload from
   source**). Changing the `mcpAllowlist` re-prompts consent.
3. Iterate. Confirm the server + tool with the user before writing lots of code.
