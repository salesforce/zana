import { sanitizePersonaMcpServers, PERSONA_MCP_SERVERS_MAX } from '@zana-ai/zcc-domain/product';

// Kept free of electron imports so launch-path modules (and their tests) can use it without the persona store.

/**
 * Lossless `mcpServers` handling (D1): the field is an allowlist, so absent
 * stays `undefined` (unrestricted) and `[]` stays `[]` (zcc-inbox only). A
 * malformed value never drops the persona: invalid entries are filtered and
 * the list is capped, each with a visible warning; a non-array value is
 * treated as absent. Valid lists go through `sanitizePersonaMcpServers`.
 */
export function sanitizeLegacyMcpServers(value: unknown, personaId?: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const label = typeof personaId === 'string' ? personaId : '?';
  if (!Array.isArray(value)) {
    console.warn(`[persona-store] persona "${label}": ignoring non-array mcpServers`);
    return undefined;
  }
  const strict = sanitizePersonaMcpServers(value);
  if (strict) return strict;
  const valid = value.filter((e) => sanitizePersonaMcpServers([e]) !== null);
  const dropped = value.length - valid.length;
  if (dropped > 0) console.warn(`[persona-store] persona "${label}": dropped ${dropped} invalid mcpServers entr${dropped === 1 ? 'y' : 'ies'}`);
  const list = [...new Set(valid.map((e) => (e as string).trim()))];
  if (list.length > PERSONA_MCP_SERVERS_MAX) {
    console.warn(`[persona-store] persona "${label}": truncated mcpServers to ${PERSONA_MCP_SERVERS_MAX} entries`);
    return list.slice(0, PERSONA_MCP_SERVERS_MAX);
  }
  return list;
}
