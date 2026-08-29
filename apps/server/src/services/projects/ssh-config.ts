import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, isAbsolute, basename } from 'node:path';
import { homedir } from 'node:os';
import type { SshHostEntry } from '@zana-ai/zcc-domain/product';

/**
 * Generic `~/.ssh/config` parser. Reads the config (recursively following
 * `Include` directives) and returns every concrete, pickable host — its alias,
 * `HostName`, and `User` line. This module has NO knowledge of any specific
 * environment: it does not know what a "workspace" is, does not shell out to any
 * CLI, and does not filter by user. Optional extensions may layer discovery or
 * filtering policies on top of this portable parser.
 *
 * Wildcard hosts (`Host *`) and multi-alias `Host a b c` lines are pattern
 * blocks, not pickable targets, so they're skipped. Caches nothing — the file
 * is small and only read when the user opens the "Add remote project" modal.
 */
export async function parseSshConfig(configPath?: string): Promise<SshHostEntry[]> {
  const root = configPath ?? join(homedir(), '.ssh', 'config');
  const seen = new Set<string>();
  const out: SshHostEntry[] = [];
  await parseFile(root, seen, out);
  return out;
}

async function parseFile(path: string, seen: Set<string>, out: SshHostEntry[]): Promise<void> {
  if (seen.has(path)) return;
  seen.add(path);

  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return;
  }

  const lines = text.split(/\r?\n/);
  let current: { aliases: string[]; hostname?: string; user?: string; proxyJump?: string } | null =
    null;

  const flush = () => {
    if (!current) return;
    for (const alias of current.aliases) {
      if (isWildcard(alias)) continue;
      out.push({
        alias,
        hostname: current.hostname,
        user: current.user,
        proxyJump: current.proxyJump
      });
    }
    current = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/^\s+/, '').replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;

    const m = line.match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();

    if (key === 'host') {
      flush();
      const aliases = value.split(/\s+/).filter(Boolean);
      // A Host line with multiple aliases is a pattern block, not a list of
      // pickable targets — skip the whole block. (Matches the OpenSSH
      // semantics and aisuite's config.go discovery rule.)
      if (aliases.length > 1) {
        current = null;
        continue;
      }
      current = { aliases };
      continue;
    }

    if (key === 'include') {
      flush();
      const patterns = value.split(/\s+/).filter(Boolean);
      for (const pat of patterns) {
        const expanded = expandHome(pat);
        const base = isAbsolute(expanded) ? expanded : join(homedir(), '.ssh', expanded);
        for (const file of await expandGlob(base)) {
          await parseFile(file, seen, out);
        }
      }
      continue;
    }

    if (!current) continue;
    if (key === 'hostname') current.hostname = value;
    else if (key === 'user') current.user = value;
    // `ProxyJump none` explicitly disables an inherited jump — treat it as absent
    // so we never surface the literal "none" as a bastion to thread into `-J`.
    else if (key === 'proxyjump' && value.toLowerCase() !== 'none') current.proxyJump = value;
  }

  flush();
}

function isWildcard(alias: string): boolean {
  return alias.includes('*') || alias.includes('?') || alias.startsWith('!');
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Tiny glob expander. Supports `*` and `?` in the basename only — that's
 * the realistic shape of `Include` directives in ssh_config (e.g.
 * `Include conf.d/*`). If the pattern has no wildcards, returns it as-is.
 */
async function expandGlob(pattern: string): Promise<string[]> {
  if (!pattern.includes('*') && !pattern.includes('?')) return [pattern];
  const dir = dirname(pattern);
  const base = basename(pattern);
  const re = globToRegex(base);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => re.test(name))
    .map((name) => join(dir, name))
    .sort();
}

function globToRegex(pat: string): RegExp {
  let re = '^';
  for (const ch of pat) {
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  re += '$';
  return new RegExp(re);
}
