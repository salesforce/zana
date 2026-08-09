// Discover Claude Code *slash commands* (the `.claude/commands/**/*.md` files
// `claude` itself reads) so the app can surface them in the command palette and
// launch them directly into a tab.
//
// Three scopes, mirroring Claude's own resolution:
//   - user    — ~/.claude/commands/**/*.md
//   - project — <projectPath>/.claude/commands/**/*.md
//   - plugin  — <enabled plugin installPath>/commands/**/*.md
//
// Crucially, plugin commands are enumerated ONLY from the install paths of
// *enabled* plugins (via listPlugins()), never by walking ~/.claude/plugins
// directly — that tree carries thousands of versioned `cache/*` duplicates that
// would flood the palette. Naming follows Claude's convention: a nested file
// `git/commit.md` becomes `/git:commit`; a plugin command is `/<plugin>:<name>`.
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { SlashCommand } from '../shared/types.js';
import { listPlugins } from './plugins.js';
import { getClaudeDir } from './plugin-fs.js';

// Lazy (honors ZCC_CLAUDE_HOME in tests; resolved per-call, not at import).
function userCommandsDir(): string {
  return join(getClaudeDir(), 'commands');
}

interface CommandFrontmatter {
  description?: string;
  argumentHint?: string;
}

/**
 * Minimal frontmatter parse for the two keys we surface (`description`,
 * `argument-hint`). Same lightweight approach as skills.ts — no YAML dep.
 */
function parseCommandFrontmatter(raw: string): CommandFrontmatter {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: CommandFrontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const value = unquote(kv[2].trim());
    if (key === 'description') out.description = value;
    else if (key === 'argument-hint' || key === 'argumentHint') out.argumentHint = value;
  }
  return out;
}

function unquote(s: string): string {
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return s.slice(1, -1);
  }
  return s;
}

/** First non-frontmatter, non-blank line — a fallback description when no
 *  frontmatter `description` is present (matches how the eq.md files read). */
function firstBodyLine(raw: string): string | undefined {
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith('#')) return t.length > 120 ? `${t.slice(0, 117)}…` : t;
  }
  return undefined;
}

/** Recursively collect `*.md` files under `dir`, returning paths relative to it. */
async function walkMarkdown(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const visit = async (current: string) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(current, e.name);
      if (e.isDirectory()) await visit(full);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(relative(dir, full));
    }
  };
  await visit(dir);
  return out;
}

/**
 * Turn a relative `.md` path into a command name with Claude's `:` namespacing.
 * `eq.md` → `eq`; `git/commit.md` → `git:commit`. An optional `prefix` (the
 * plugin slug) is prepended as the leading namespace segment.
 */
function commandName(relPath: string, prefix?: string): string {
  const noExt = relPath.replace(/\.md$/, '');
  const segments = noExt.split(sep);
  const joined = segments.join(':');
  return prefix ? `${prefix}:${joined}` : joined;
}

async function buildCommand(
  scope: SlashCommand['scope'],
  baseDir: string,
  relPath: string,
  opts: { prefix?: string; pluginName?: string; projectId?: string }
): Promise<SlashCommand> {
  const name = commandName(relPath, opts.prefix);
  let fm: CommandFrontmatter = {};
  let bodyFallback: string | undefined;
  try {
    const raw = await readFile(join(baseDir, relPath), 'utf-8');
    fm = parseCommandFrontmatter(raw);
    if (!fm.description) bodyFallback = firstBodyLine(raw);
  } catch {
    /* unreadable command file — surface it with just its name */
  }
  return {
    id: `${scope}:${name}`,
    name,
    invocation: `/${name}`,
    scope,
    pluginName: opts.pluginName,
    projectId: opts.projectId,
    path: join(baseDir, relPath),
    description: fm.description ?? bodyFallback,
    argumentHint: fm.argumentHint
  };
}

async function listScoped(
  scope: SlashCommand['scope'],
  baseDir: string,
  opts: { prefix?: string; pluginName?: string; projectId?: string } = {}
): Promise<SlashCommand[]> {
  const rels = await walkMarkdown(baseDir);
  return Promise.all(rels.map((rel) => buildCommand(scope, baseDir, rel, opts)));
}

export interface ListCommandsOptions {
  projectPath?: string;
  projectId?: string;
}

/**
 * Discover all slash commands visible from the given project context: user +
 * enabled-plugin + (optionally) project. De-duplicated by `id`; on a name
 * collision the first scope wins in the order user → plugin → project, matching
 * the listing order. Best-effort throughout — a failure in one scope never
 * aborts the others.
 */
export async function listCommands(options: ListCommandsOptions = {}): Promise<SlashCommand[]> {
  const out: SlashCommand[] = [];

  out.push(...(await listScoped('user', userCommandsDir())));

  try {
    const plugins = await listPlugins();
    for (const p of plugins) {
      if (!p.enabled) continue;
      const dir = join(p.path, 'commands');
      out.push(...(await listScoped('plugin', dir, { prefix: p.name, pluginName: p.name })));
    }
  } catch {
    /* plugin enumeration failed — user/project commands still returned */
  }

  if (options.projectPath && options.projectId) {
    const dir = join(options.projectPath, '.claude', 'commands');
    out.push(...(await listScoped('project', dir, { projectId: options.projectId })));
  }

  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}
