import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const SKILLS_PER_PLUGIN_MAX = 20;

/**
 * Resolve a plugin-relative path if it stays inside rootDir. Returns null when
 * the path is missing or escapes (BB: a missing skills root is "no skills").
 */
export function tryResolveContainedPath(rootDir: string, relative: string): string | null {
  if (!relative || relative.includes('\0')) return null;
  try {
    const root = realpathSync(rootDir);
    const candidate = resolve(root, relative);
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null;
    if (!existsSync(candidate)) return null;
    const real = realpathSync(candidate);
    if (real !== root && !real.startsWith(`${root}${sep}`)) return null;
    return real;
  } catch {
    return null;
  }
}

/**
 * BB skill discovery: each `skillsRootPaths` entry is a directory of skill
 * folders. A skill is an immediate child directory that contains a regular
 * `SKILL.md` (lstat — a symlinked SKILL.md is ignored). Name = directory name.
 */
export function discoverPluginSkillNames(rootDir: string, skillsRootPaths: string[]): string[] {
  const names = new Set<string>();
  for (const rel of skillsRootPaths) {
    const rootPath = tryResolveContainedPath(rootDir, rel.replace(/\/\*$/, ''));
    if (!rootPath) continue;
    let entries;
    try {
      entries = readdirSync(rootPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const skillFile = lstatSync(join(rootPath, entry.name, 'SKILL.md'));
        if (!skillFile.isFile() || skillFile.isSymbolicLink()) continue;
      } catch {
        continue;
      }
      names.add(entry.name);
      if (names.size >= SKILLS_PER_PLUGIN_MAX) return [...names].sort();
    }
  }
  return [...names].sort();
}

/**
 * Rewrite relative MCP args that exist under the plugin root to contained
 * realpaths. Returns null when any path-looking arg escapes the root (caller
 * must drop that server).
 */
export function rewritePluginMcpArgs(rootDir: string, args: string[] | undefined): string[] | null {
  if (!args) return [];
  const out: string[] = [];
  for (const arg of args) {
    const looksLikePath =
      arg.startsWith('.') ||
      arg.includes('/') ||
      arg.includes('\\');
    if (!looksLikePath || arg.startsWith('-')) {
      out.push(arg);
      continue;
    }
    const resolved = tryResolveContainedPath(rootDir, arg);
    if (!resolved) return null;
    out.push(resolved);
  }
  return out;
}
