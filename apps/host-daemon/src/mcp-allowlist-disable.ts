import { ALWAYS_ALLOWED_MCP_SERVERS, mcpAllowlistCovers } from '@zana-ai/zcc-domain/product';
import type { UserMcpEnumeration } from './harness/launch-provider.js';

/**
 * Name-disable planning for harnesses with no clear-all MCP switch (Codex,
 * OpenCode; D12 outcomes). Given a persona allowlist and the server names the
 * harness loads from its own config, it returns the names to disable and the
 * launch warnings. It only ever handles names: no definition, env, header or
 * credential is read, retained or emitted, so nothing credential-bearing can
 * reach argv, env or the per-session config (AC-13). Auth for an allowlisted
 * server stays the harness's own concern (D6), so "credentials stripped" cannot
 * occur on this path.
 */

/** Structurally the host-daemon `LaunchWarning`; kept local so this module has no cycle with `pty.ts`. */
export interface McpDisableWarning {
  code: string;
  message: string;
  server?: string;
}

/** Disable-argv growth bound (one `-c` pair, or one config key, per name). */
export const MAX_DISABLED_MCP_SERVERS = 128;

export const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const ALWAYS_ALLOWED = new Set<string>(ALWAYS_ALLOWED_MCP_SERVERS);

function printable(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '?');
  return clean.length > 64 ? `${clean.slice(0, 64)}...` : clean;
}

export interface McpDisablePlan {
  /** Bare-key names to disable, never `zcc-inbox` or a Zana-injected server. */
  disabled: string[];
  warnings: McpDisableWarning[];
}

export function planUserMcpDisable(input: {
  allowlist: readonly string[];
  enumeration: UserMcpEnumeration;
  /** Config keys Zana itself injects this session (never disabled). */
  injectedNames: ReadonlySet<string>;
  /** Allowlist entries a registered plugin/extension server answers to (delivered by Zana). */
  externallyProvided: readonly string[];
}): McpDisablePlan {
  const warnings: McpDisableWarning[] = [];
  const disabled: string[] = [];
  const userNames = [...new Set(input.enumeration.names)];
  let truncated = false;
  for (const name of userNames) {
    if (ALWAYS_ALLOWED.has(name) || input.injectedNames.has(name)) continue;
    if (input.allowlist.some((entry) => mcpAllowlistCovers(entry, { key: name, source: 'user', name }))) continue;
    if (!BARE_KEY.test(name)) {
      warnings.push({
        code: 'mcp-allowlist-not-disabled',
        server: printable(name),
        message: `MCP server "${printable(name)}" is not on the persona allowlist but its name cannot be disabled by this harness; it may still load.`
      });
    } else if (disabled.length >= MAX_DISABLED_MCP_SERVERS) {
      truncated = true;
    } else {
      disabled.push(name);
    }
  }
  if (truncated) {
    warnings.push({
      code: 'mcp-allowlist-truncated',
      message: `More than ${MAX_DISABLED_MCP_SERVERS} configured MCP servers are off the persona allowlist; the rest may still load.`
    });
  }
  if (input.enumeration.unreadable) {
    warnings.push({
      code: 'mcp-allowlist-config-unreadable',
      message: 'A harness MCP config could not be read; servers defined only there were not disabled and may still load.'
    });
  }
  for (const entry of new Set(input.allowlist)) {
    if (ALWAYS_ALLOWED.has(entry) || /^(plugin|ext):/.test(entry) || input.externallyProvided.includes(entry)) continue;
    const found = userNames.some((name) => mcpAllowlistCovers(entry, { key: name, source: 'user', name }));
    if (!found) {
      warnings.push({
        code: 'allowlisted-mcp-not-found',
        server: printable(entry),
        message: `Allowlisted MCP server "${printable(entry)}" was not found in this harness's MCP configuration and is not available in this run.`
      });
    }
  }
  return { disabled, warnings };
}

/** D7: a launch that cannot carry a persona MCP allowlist ignores it and says so; it never blocks. */
export function allowlistIgnoredWarning(reason: string): McpDisableWarning {
  return { code: 'mcp-allowlist-ignored', message: `The persona's MCP server allowlist is ignored: ${reason}.` };
}
