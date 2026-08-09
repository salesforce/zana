# __EXT_TITLE__

A Zana Command Center extension that talks to an **MCP server** (Model Context
Protocol, stdio JSON-RPC) through Zana's brokered, permission-gated `mcp`
capability.

## ⚠ Wire a real server first

This starter ships a **placeholder** MCP server id
(`REPLACE_WITH_MCP_SERVER_ID`), so it returns nothing until you:

1. set `MCP_SERVER_ID` and `TOOL_NAME` in `dist/main.mjs` to a real, host-known
   server + tool;
2. set the **same** server id in `extension.json` →
   `permissionScopes.mcpAllowlist`;
3. hit **Reload from source** — Zana re-prompts you to approve the new scope.

## What's inside

- `extension.json` — the manifest. Declares `permissions: ["mcp"]` with an
  `mcpAllowlist` naming which server ids the backend may reach.
- `dist/main.mjs` — the main-process module. Calls `ctx.mcp(serverId, tool, args)` and
  degrades to `[]` on any failure. Exposes the `listItems` capability.
- `dist/renderer.js` — the panel UI. Calls `host.call('listItems')`.

## Install from a repo

Push to a git repository, then anyone can install it via **Settings → Extensions
→ Install from repo…**. Zana clones it, shows the permissions it requests, and
installs on your approval.
