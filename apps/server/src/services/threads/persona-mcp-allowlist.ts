import { effectiveMcpServers, sanitizePersonaMcpServers, type Persona } from '@zana-ai/zcc-domain/product';

/** `system/operation` name of the persona MCP allowlist launch notice (Modern threads and Squads). */
export const PERSONA_MCP_ALLOWLIST_OPERATION = 'persona_mcp_allowlist';

/**
 * Main-resolved MCP allowlist for a Modern (bridge) launch. `undefined` = unrestricted (the persona
 * sets no list); an array always contains `zcc-inbox` (an empty persona list still yields
 * `['zcc-inbox']`, which restricts). A malformed stored value is treated as unset, matching the
 * persona store sanitizer. Never reads renderer input.
 */
export function resolveModernMcpAllowlist(
  persona: Pick<Persona, 'mcpServers'> | undefined,
  slotRole: 'worker' | 'orchestrator' = 'worker'
): string[] | undefined {
  if (!persona) return undefined;
  const sanitized = sanitizePersonaMcpServers(persona.mcpServers);
  if (sanitized === undefined || sanitized === null) return undefined;
  return effectiveMcpServers(undefined, { mcpServers: sanitized }, slotRole);
}

/**
 * Visible launch notice for a Modern persona MCP allowlist. ACP `session/new.mcpServers` is
 * additive, so outside an isolated Claude session the list can only narrow the servers Zana
 * injects; the agent's own configured servers stay available. The text states that limit
 * instead of implying a full restriction. Contains server names only, never definitions.
 */
export function personaMcpAllowlistNotice(input: {
  /** Canonical thread provider id or harness family (`claude-code`, `claude`, `acp-cursor`, ...). */
  providerId: string;
  /** The session runs against a Zana-generated isolated config (automated, not `useUserConfig`). */
  isolated: boolean;
  allowlist: readonly string[];
  personaLabel?: string;
}): string {
  const who = input.personaLabel ? `Persona "${input.personaLabel}"` : 'The persona';
  const listed = input.allowlist.filter((name) => name !== 'zcc-inbox');
  const names = listed.length === 0 ? 'no extra servers' : listed.join(', ');
  const claude = input.providerId === 'claude-code' || input.providerId === 'claude' || input.providerId === 'claude-yolo';
  if (claude && input.isolated) {
    return `${who} restricts MCP servers to: ${names}. It limits the Zana-injected plugin servers and the Claude user-config servers; project-scope servers are not filtered.`;
  }
  return `${who} restricts MCP servers to: ${names}. On this launch path it limits only the plugin servers Zana injects; the agent's own configured MCP servers stay available because the protocol cannot exclude them.`;
}
