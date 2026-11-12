import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { UserMcpEnumeration } from '../launch-provider.js';

/**
 * Names of the MCP servers OpenCode loads from its own config (global, the
 * user's own `OPENCODE_CONFIG` file, and project), for a persona MCP allowlist.
 * OpenCode has no clear-all (`mcp: null` is rejected), so the allowlist
 * disables every unlisted name through the per-session `OPENCODE_CONFIG` file
 * channel; this is the enumeration step. Read-only, bounded, keys only (no
 * definition or credential is retained). Read at launch, so a server added
 * afterwards is not disabled (enumeration race).
 */

export const MAX_OPENCODE_CONFIG_BYTES = 1024 * 1024;

/** Strip JSONC comments and trailing commas, string-aware. */
export function stripJsonc(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (ch === '\\') out += text[++i] ?? '';
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
    } else {
      out += ch;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

type Read = { kind: 'missing' } | { kind: 'unreadable' } | { kind: 'ok'; names: string[] };

function readServerNames(file: string): Read {
  try {
    if (statSync(file).size > MAX_OPENCODE_CONFIG_BYTES) return { kind: 'unreadable' };
    const parsed: unknown = JSON.parse(stripJsonc(readFileSync(file, 'utf8')));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'unreadable' };
    const mcp = (parsed as Record<string, unknown>).mcp;
    if (mcp === undefined) return { kind: 'ok', names: [] };
    if (typeof mcp !== 'object' || mcp === null || Array.isArray(mcp)) return { kind: 'unreadable' };
    return { kind: 'ok', names: Object.keys(mcp) };
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'unreadable' };
  }
}

export function enumerateOpenCodeUserMcpServers(input: { cwd: string; env: NodeJS.ProcessEnv }): UserMcpEnumeration {
  const configHome = input.env.XDG_CONFIG_HOME ? resolve(input.env.XDG_CONFIG_HOME) : join(homedir(), '.config');
  const globalDir = join(configHome, 'opencode');
  const project = resolve(input.cwd);
  const files = [
    join(globalDir, 'config.json'),
    join(globalDir, 'opencode.json'),
    join(globalDir, 'opencode.jsonc'),
    ...(input.env.OPENCODE_CONFIG ? [resolve(input.env.OPENCODE_CONFIG)] : []),
    join(project, 'opencode.json'),
    join(project, 'opencode.jsonc'),
    join(project, '.opencode', 'opencode.json'),
    join(project, '.opencode', 'opencode.jsonc')
  ];
  const names = new Set<string>();
  let unreadable = false;
  for (const file of files) {
    const read = readServerNames(file);
    if (read.kind === 'unreadable') unreadable = true;
    else if (read.kind === 'ok') for (const name of read.names) names.add(name);
  }
  return { names: [...names], ...(unreadable ? { unreadable: true } : {}) };
}
