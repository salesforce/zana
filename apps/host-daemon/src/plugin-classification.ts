/**
 * Skill inventory + plugin classification for a Claude CLI spawn.
 *
 * Runs on the machine that hosts the agent: `scanLocalSkillInventory` reads the
 * local filesystem, `scanRemoteSkillInventory` runs ONE read-only script over the
 * project's ssh transport (two round trips) and parses the same record shape.
 * A plugin is `skills-only` unless it contributes hooks, MCP servers, agents or
 * LSP servers (commands do not count). Anything unreadable or truncated is
 * `mixed`, so the caller keeps it enabled instead of over-restricting.
 */
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProjectRemote } from '@zana-ai/zcc-domain/product';
import { execRemote, shellQuote } from './remote-fs.js';

export type PluginClass = 'skills-only' | 'mixed';

export interface InstalledPlugin {
  /** Settings key for `enabledPlugins`, e.g. `name@marketplace`. */
  id: string;
  /** Skill-name prefix Claude shows (`<name>:<skill>`). */
  name: string;
  skills: string[];
  kind: PluginClass;
}

export interface ClaudeSkillInventory {
  /** User and project skills (plain names, no plugin prefix). */
  userSkills: string[];
  plugins: InstalledPlugin[];
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,255}$/;
const MAX_ITEMS = 2_000;
const MANIFEST_MIXED_KEYS = /"(hooks|mcpServers|agents|lspServers)"/;

/** Pure: contribution flags -> class. Unknown (`undefined`) flags count as mixed. */
export function classifyPlugin(flags: { hooks?: boolean; mcp?: boolean; agents?: boolean; lsp?: boolean; manifest?: boolean } | undefined): PluginClass {
  if (!flags) return 'mixed';
  return flags.hooks || flags.mcp || flags.agents || flags.lsp || flags.manifest ? 'mixed' : 'skills-only';
}

export function pluginNameOf(id: string): string {
  const at = id.indexOf('@');
  return at > 0 ? id.slice(0, at) : id;
}

/** Plugin installPaths from `installed_plugins.json` (v1 and v2 shapes). Malformed -> []. */
export function parseInstalledPlugins(raw: string): Array<{ id: string; installPath: string }> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const plugins = (parsed as { plugins?: unknown })?.plugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return [];
  const out: Array<{ id: string; installPath: string }> = [];
  for (const [id, value] of Object.entries(plugins as Record<string, unknown>)) {
    if (!SAFE_PLUGIN_ID.test(id)) continue;
    const entries = Array.isArray(value) ? value : [value];
    const installPath = entries.map((e) => (e as { installPath?: unknown })?.installPath).find((p) => typeof p === 'string');
    if (typeof installPath === 'string' && installPath.startsWith('/') && !/[\0\n\r]/.test(installPath)) out.push({ id, installPath });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function safeNames(names: Iterable<string>): string[] {
  return [...new Set([...names].filter((n) => SAFE_NAME.test(n)))].sort().slice(0, MAX_ITEMS);
}

/** Thrown when the local inventory cannot be trusted (unreadable dir, cap or timeout). */
export class SkillInventoryUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SkillInventoryUnavailableError';
  }
}

const SCAN_TIMEOUT_MS = 5_000;
const MAX_SCAN_ENTRIES = 2_000;

interface ScanBudget { used: number; max: number; aborted: boolean }

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function spend(budget: ScanBudget, n: number): void {
  if (budget.aborted) throw new SkillInventoryUnavailableError('skill inventory scan timed out');
  budget.used += n;
  if (budget.used > budget.max) throw new SkillInventoryUnavailableError(`skill inventory exceeds ${budget.max} entries`);
}

/** Missing dir -> []; any other read failure -> unavailable. */
async function readDirEntries(root: string, budget: ScanBudget) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    spend(budget, entries.length);
    return entries;
  } catch (err) {
    if (err instanceof SkillInventoryUnavailableError) throw err;
    if (isMissing(err)) return [];
    throw new SkillInventoryUnavailableError(`cannot read ${root}: ${(err as NodeJS.ErrnoException).code ?? 'error'}`);
  }
}

async function isDir(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function listSkillDirs(root: string, budget: ScanBudget): Promise<string[]> {
  const entries = await readDirEntries(root, budget);
  const out: string[] = [];
  for (const e of entries) {
    if (e.isDirectory() || (e.isSymbolicLink() && await isDir(join(root, e.name)))) out.push(e.name);
  }
  return out;
}

async function listCommandFiles(root: string, budget: ScanBudget): Promise<string[]> {
  const entries = await readDirEntries(root, budget);
  return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name.slice(0, -3));
}

async function classifyLocalPlugin(installPath: string): Promise<PluginClass> {
  try {
    let manifest = false;
    const manifestPath = join(installPath, '.claude-plugin', 'plugin.json');
    if (await exists(manifestPath)) manifest = MANIFEST_MIXED_KEYS.test(await readFile(manifestPath, 'utf8'));
    const [hooks, mcp, agents, lsp] = await Promise.all([
      exists(join(installPath, 'hooks')),
      exists(join(installPath, '.mcp.json')),
      exists(join(installPath, 'agents')),
      exists(join(installPath, '.lsp.json'))
    ]);
    return classifyPlugin({ hooks, mcp, agents, lsp, manifest });
  } catch { return 'mixed'; }
}

async function scanLocal(home: string, cwd: string | undefined, budget: ScanBudget): Promise<ClaudeSkillInventory> {
  const user = await listSkillDirs(join(home, '.claude', 'skills'), budget);
  if (cwd) user.push(...await listSkillDirs(join(cwd, '.claude', 'skills'), budget));
  // User/project slash commands are listed to the model as skills too.
  user.push(...await listCommandFiles(join(home, '.claude', 'commands'), budget));
  if (cwd) user.push(...await listCommandFiles(join(cwd, '.claude', 'commands'), budget));
  let installed: Array<{ id: string; installPath: string }> = [];
  try {
    installed = parseInstalledPlugins(await readFile(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
  } catch (err) {
    if (!isMissing(err)) throw new SkillInventoryUnavailableError(`cannot read installed_plugins.json: ${(err as NodeJS.ErrnoException).code ?? 'error'}`);
  }
  spend(budget, installed.length);
  const plugins: InstalledPlugin[] = [];
  for (const { id, installPath } of installed) {
    const skills = [
      ...await listSkillDirs(join(installPath, 'skills'), budget),
      ...await listCommandFiles(join(installPath, 'commands'), budget)
    ];
    plugins.push({ id, name: pluginNameOf(id), skills: safeNames(skills), kind: await classifyLocalPlugin(installPath) });
  }
  return { userSkills: safeNames(user), plugins };
}

/**
 * Local inventory: `~/.claude/{skills,commands}`, `<cwd>/.claude/{skills,commands}` and installed plugins.
 * Async and bounded (entry cap + overall timeout). A directory that exists but cannot
 * be read, or a tripped cap/timeout, rejects with {@link SkillInventoryUnavailableError}
 * so "unreadable" is never mistaken for "nothing installed".
 */
export async function scanLocalSkillInventory(
  opts: { home?: string; cwd?: string; timeoutMs?: number; maxEntries?: number } = {}
): Promise<ClaudeSkillInventory> {
  const budget: ScanBudget = { used: 0, max: opts.maxEntries ?? MAX_SCAN_ENTRIES, aborted: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      budget.aborted = true;
      reject(new SkillInventoryUnavailableError('skill inventory scan timed out'));
    }, opts.timeoutMs ?? SCAN_TIMEOUT_MS);
  });
  const scan = scanLocal(opts.home ?? homedir(), opts.cwd, budget);
  scan.catch(() => undefined); // a late rejection after the timeout won the race is not unhandled
  try {
    return await Promise.race([scan, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// --- Remote ------------------------------------------------------------------

/** Script A: user/project skill dirs, a `J` separator, then installed_plugins.json. */
export function remoteInventoryScriptA(cwd?: string): string {
  const project = cwd
    ? `for d in ${shellQuote(cwd)}/.claude/skills/*/; do [ -d "$d" ] && printf 'U\\t%s\\n' "$(basename "$d")"; done; ` +
      `for c in ${shellQuote(cwd)}/.claude/commands/*.md; do [ -f "$c" ] && printf 'U\\t%s\\n' "$(basename "$c" .md)"; done; `
    : '';
  return `for d in "$HOME"/.claude/skills/*/; do [ -d "$d" ] && printf 'U\\t%s\\n' "$(basename "$d")"; done; ` +
    `for c in "$HOME"/.claude/commands/*.md; do [ -f "$c" ] && printf 'U\\t%s\\n' "$(basename "$c" .md)"; done; ` +
    project +
    `printf 'J\\n'; cat "$HOME/.claude/plugins/installed_plugins.json" 2>/dev/null; true`;
}

/** Script B: per-plugin skill names and mixed-class markers. Paths must live under the plugins dir. */
export function remoteInventoryScriptB(installPaths: readonly string[]): string {
  return installPaths.map((p) => {
    const q = shellQuote(p);
    return `p=${q}; case "$p" in "$HOME"/.claude/plugins/*) ;; *) p=;; esac; if [ -n "$p" ]; then ` +
      `printf 'P\\t%s\\n' "$p"; ` +
      `for s in "$p"/skills/*/; do [ -d "$s" ] && printf 'S\\t%s\\n' "$(basename "$s")"; done; ` +
      `for c in "$p"/commands/*.md; do [ -f "$c" ] && printf 'S\\t%s\\n' "$(basename "$c" .md)"; done; ` +
      `{ [ -e "$p/hooks" ] || [ -e "$p/.mcp.json" ] || [ -e "$p/agents" ] || [ -e "$p/.lsp.json" ] || ` +
      `{ [ -f "$p/.claude-plugin/plugin.json" ] && grep -Eq '"(hooks|mcpServers|agents|lspServers)"' "$p/.claude-plugin/plugin.json"; }; } && printf 'X\\n'; ` +
      `printf 'E\\n'; fi`;
  }).join('\n');
}

/** Pure parser for script A output. */
export function parseRemoteInventoryA(stdout: string): { userSkills: string[]; installed: Array<{ id: string; installPath: string }> } {
  const lines = stdout.split('\n');
  const split = lines.indexOf('J');
  const head = split < 0 ? lines : lines.slice(0, split);
  const user = head.filter((l) => l.startsWith('U\t')).map((l) => l.slice(2));
  const installed = split < 0 ? [] : parseInstalledPlugins(lines.slice(split + 1).join('\n'));
  return { userSkills: safeNames(user), installed };
}

/** Pure parser for script B output. A record without its `E` terminator is `mixed`. */
export function parseRemoteInventoryB(stdout: string, installed: ReadonlyArray<{ id: string; installPath: string }>): InstalledPlugin[] {
  const records = new Map<string, { skills: string[]; mixed: boolean; ended: boolean }>();
  let current: { skills: string[]; mixed: boolean; ended: boolean } | undefined;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('P\t')) { current = { skills: [], mixed: false, ended: false }; records.set(line.slice(2), current); }
    else if (!current) continue;
    else if (line.startsWith('S\t')) current.skills.push(line.slice(2));
    else if (line === 'X') current.mixed = true;
    else if (line === 'E') current.ended = true;
  }
  return installed.map(({ id, installPath }) => {
    const rec = records.get(installPath);
    return {
      id,
      name: pluginNameOf(id),
      skills: rec ? safeNames(rec.skills) : [],
      kind: !rec || !rec.ended || rec.mixed ? 'mixed' : 'skills-only'
    };
  });
}

/** Remote inventory over the project's ssh transport. `undefined` when the host is unreachable. */
export async function scanRemoteSkillInventory(
  remote: ProjectRemote,
  cwd?: string,
  exec: typeof execRemote = execRemote
): Promise<ClaudeSkillInventory | undefined> {
  const a = await exec(remote, '/', remoteInventoryScriptA(cwd), { timeoutMs: 20_000 });
  if (!a.ok || a.code !== 0) return undefined;
  const { userSkills, installed } = parseRemoteInventoryA(a.stdout ?? '');
  if (installed.length === 0) return { userSkills, plugins: [] };
  const b = await exec(remote, '/', remoteInventoryScriptB(installed.map((p) => p.installPath)), { timeoutMs: 20_000 });
  // Plugins that could not be inspected stay enabled (mixed, no skills known).
  return { userSkills, plugins: parseRemoteInventoryB(b.ok ? (b.stdout ?? '') : '', installed) };
}
