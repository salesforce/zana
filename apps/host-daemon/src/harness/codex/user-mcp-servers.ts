import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'smol-toml';
import type { UserMcpEnumeration } from '../launch-provider.js';

/**
 * Names of the MCP servers Codex loads from its own TOML config, for a persona
 * MCP allowlist. Codex has no clear-all switch (`mcp_servers={}` cannot empty
 * the table), so the allowlist disables every unlisted name; this is the
 * enumeration step.
 *
 * Source is a bounded, read-only parse of `$CODEX_HOME/config.toml` (default
 * `~/.codex`) and `<cwd>/.codex/config.toml`, taking table KEYS only. It does
 * not run `codex mcp list --json`: that works (verified) but prints every
 * server's command, env and headers, and a piped child's stdout is not proven
 * complete at the Electron production boundary. The list is read at launch, so
 * a server added to the config afterwards is not disabled (enumeration race).
 */

/** Hard cap on one config file; anything larger is treated as unreadable. */
export const MAX_CODEX_CONFIG_BYTES = 1024 * 1024;

type Read = { kind: 'missing' } | { kind: 'unreadable' } | { kind: 'ok'; names: string[] };

function readServerNames(file: string): Read {
  try {
    if (statSync(file).size > MAX_CODEX_CONFIG_BYTES) return { kind: 'unreadable' };
    const parsed = parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const table = parsed.mcp_servers;
    if (table === undefined) return { kind: 'ok', names: [] };
    if (typeof table !== 'object' || table === null || Array.isArray(table)) return { kind: 'unreadable' };
    return { kind: 'ok', names: Object.keys(table) };
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'unreadable' };
  }
}

export function enumerateCodexUserMcpServers(input: { cwd: string; env: NodeJS.ProcessEnv }): UserMcpEnumeration {
  const home = input.env.CODEX_HOME ? resolve(input.env.CODEX_HOME) : join(homedir(), '.codex');
  const names = new Set<string>();
  let unreadable = false;
  for (const file of [join(home, 'config.toml'), join(resolve(input.cwd), '.codex', 'config.toml')]) {
    const read = readServerNames(file);
    if (read.kind === 'unreadable') unreadable = true;
    else if (read.kind === 'ok') for (const name of read.names) names.add(name);
  }
  return { names: [...names], ...(unreadable ? { unreadable: true } : {}) };
}
