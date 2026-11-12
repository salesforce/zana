import { IPC } from '@zana-ai/zcc-desktop-contract';
import { HostMcpCatalogueResultSchema, type HostMcpCatalogueResult } from '@zana-ai/zcc-contracts/host-rpc';
import { buildMcpCatalogueWithNotes } from '@zana-ai/zcc-host-daemon/mcp-catalogue';
import { ctx } from './ctx.js';

export type McpCatalogueIpcResult =
  | { ok: true; value: HostMcpCatalogueResult }
  | { ok: false; code: 'MCP_CATALOGUE_FAILED' | 'MCP_CATALOGUE_INVALID'; message: string };

/**
 * The renderer supplies nothing (no path, name or project id), so there is nothing to
 * authorize: main asks the local host for its catalogue and any renderer-sent arguments are
 * dropped unread. The result is re-parsed against the strict, bounded contract schema, so
 * only `{ key, source, available, reason? }` entries and short notes can reach the renderer.
 */
export function readMcpCatalogue(
  build: () => unknown = () => buildMcpCatalogueWithNotes()
): McpCatalogueIpcResult {
  let raw: unknown;
  try {
    raw = build();
  } catch {
    return { ok: false, code: 'MCP_CATALOGUE_FAILED', message: 'MCP server catalogue is unavailable' };
  }
  const parsed = HostMcpCatalogueResultSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: 'MCP_CATALOGUE_INVALID', message: 'MCP server catalogue was malformed' };
  }
  return { ok: true, value: parsed.data };
}

/** Registered once from `registerIpcFamilies` at app init, never from `createWindow()`. */
export function registerMcpCatalogueIpc(): void {
  ctx.safeHandle(
    IPC.mcp.catalogue,
    () => readMcpCatalogue(),
    (): McpCatalogueIpcResult => ({ ok: false, code: 'MCP_CATALOGUE_FAILED', message: 'MCP server catalogue is unavailable' })
  );
}
