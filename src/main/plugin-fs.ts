import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Tests inject a fake home by setting `ZCC_CLAUDE_HOME`. Resolution is lazy
 * (each `get*Dir()` call re-reads the env var), so import order doesn't
 * matter — beforeEach can set the env after the module has loaded.
 */
function claudeHome(): string {
  return process.env.ZCC_CLAUDE_HOME || homedir();
}

export function getClaudeDir(): string {
  return join(claudeHome(), '.claude');
}
export function getPluginsDir(): string {
  return join(getClaudeDir(), 'plugins');
}
export function getInstalledPluginsFile(): string {
  return join(getPluginsDir(), 'installed_plugins.json');
}
export function getSettingsFile(): string {
  return join(getClaudeDir(), 'settings.json');
}

export interface InstalledPlugin {
  /** `<name>@<marketplace>` — matches the `enabledPlugins` key. */
  id: string;
  name: string;
  /** `'user'` for plugins installed directly under `~/.claude/plugins/<name>/`. */
  marketplace: string;
  installPath: string;
  version?: string;
  installedAt?: number;
}

interface PluginDir {
  name: string;
  marketplace: string;
  path: string;
}

/**
 * Walk the plugin filesystem and yield every plugin directory we can find,
 * regardless of whether `installed_plugins.json` knows about it. Used by
 * skills.ts (and forward-compat: future MCP scanning).
 */
export async function enumeratePluginDirs(): Promise<PluginDir[]> {
  const pluginsDir = getPluginsDir();
  if (!existsSync(pluginsDir)) return [];
  const out: PluginDir[] = [];

  const safeListDirs = async (dir: string): Promise<string[]> => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  };

  // Skip well-known internal dirs and stale staging artifacts the CLI leaves
  // behind: marketplaces with `.disabled` suffix, and `temp_*` extraction
  // dirs that occasionally outlive a failed install.
  const isInternalName = (n: string): boolean =>
    n === 'marketplaces' ||
    n === 'cache' ||
    n === 'data' ||
    n.startsWith('temp_') ||
    n.endsWith('.disabled');

  // Direct: ~/.claude/plugins/<plugin>/
  const direct = await safeListDirs(pluginsDir);
  for (const name of direct) {
    if (isInternalName(name)) continue;
    out.push({ name, marketplace: 'user', path: join(pluginsDir, name) });
  }

  // Marketplace: ~/.claude/plugins/marketplaces/<mp>/plugins/<plugin>/
  const marketplacesDir = join(pluginsDir, 'marketplaces');
  if (existsSync(marketplacesDir)) {
    const mps = await safeListDirs(marketplacesDir);
    for (const mp of mps) {
      if (isInternalName(mp)) continue;
      const pluginsSubdir = join(marketplacesDir, mp, 'plugins');
      if (!existsSync(pluginsSubdir)) continue;
      const plugins = await safeListDirs(pluginsSubdir);
      for (const p of plugins) {
        if (isInternalName(p)) continue;
        out.push({ name: p, marketplace: mp, path: join(pluginsSubdir, p) });
      }
    }
  }

  return out;
}

/** ms-since-epoch from a date string or numeric timestamp; 0 on failure. */
function toEpochMs(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

/**
 * Read `~/.claude/plugins/installed_plugins.json`. Three on-disk shapes have
 * been observed across CLI versions:
 *
 *   1. v2 (current Claude CLI):
 *      `{ version: 2, plugins: { "<id>": [ { scope, installPath, version, installedAt, lastUpdated, gitCommitSha } ] } }`
 *   2. v1 flat map: `{ "<id>": { name?, marketplace?, version?, installPath?, installedAt? }, ... }`
 *   3. legacy array: `[{ id, name, marketplace?, ... }, ...]`
 *
 * We pick the most recently updated install per id (v2 stores multiple).
 * On any parse failure we fall back to FS enumeration so the panel isn't
 * empty.
 */
export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  const installedFile = getInstalledPluginsFile();
  const pluginsDir = getPluginsDir();
  if (!existsSync(installedFile)) {
    const dirs = await enumeratePluginDirs();
    return dirs.map((d) => ({
      id: `${d.name}@${d.marketplace}`,
      name: d.name,
      marketplace: d.marketplace,
      installPath: d.path
    }));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(installedFile, 'utf-8'));
  } catch {
    return [];
  }

  const byId = new Map<string, InstalledPlugin>();

  /**
   * Take an `id` ("name@marketplace") and one record (object describing a
   * single install) and merge it into byId, keeping the most recently
   * updated one. Returns silently on shapes that don't carry a useful
   * installPath.
   */
  const upsert = (id: string, rec: Record<string, unknown>) => {
    const at = id.lastIndexOf('@');
    const name = at > 0 ? id.slice(0, at) : id;
    const marketplace = at > 0 ? id.slice(at + 1) : 'user';
    const installPath =
      typeof rec.installPath === 'string' && rec.installPath
        ? rec.installPath
        : marketplace === 'user'
          ? join(pluginsDir, name)
          : join(pluginsDir, 'marketplaces', marketplace, 'plugins', name);
    const version = typeof rec.version === 'string' ? rec.version : undefined;
    const installedAt = Math.max(toEpochMs(rec.lastUpdated), toEpochMs(rec.installedAt));
    const entry: InstalledPlugin = {
      id,
      name,
      marketplace,
      installPath,
      version,
      installedAt: installedAt || undefined
    };
    const existing = byId.get(id);
    if (!existing || (entry.installedAt ?? 0) >= (existing.installedAt ?? 0)) {
      byId.set(id, entry);
    }
  };

  // Shape 1: { version: 2, plugins: { "<id>": [installs...] } }
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    'plugins' in (parsed as Record<string, unknown>) &&
    typeof (parsed as Record<string, unknown>).plugins === 'object'
  ) {
    const plugins = (parsed as { plugins: Record<string, unknown> }).plugins;
    for (const [id, val] of Object.entries(plugins)) {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === 'object') {
            upsert(id, item as Record<string, unknown>);
          }
        }
      } else if (val && typeof val === 'object') {
        upsert(id, val as Record<string, unknown>);
      }
    }
  } else if (Array.isArray(parsed)) {
    // Shape 3: array of records
    for (const item of parsed) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        const idVal = typeof rec.id === 'string' ? rec.id : undefined;
        const nameVal = typeof rec.name === 'string' ? rec.name : undefined;
        const mpVal =
          typeof rec.marketplace === 'string' && rec.marketplace ? rec.marketplace : 'user';
        const id = idVal ?? (nameVal ? `${nameVal}@${mpVal}` : undefined);
        if (id) upsert(id, rec);
      }
    }
  } else if (parsed !== null && typeof parsed === 'object') {
    // Shape 2: flat map
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v && typeof v === 'object') upsert(k, v as Record<string, unknown>);
    }
  }

  // Drop stale entries whose installPath no longer exists on disk.
  const out: InstalledPlugin[] = [];
  for (const e of byId.values()) {
    if (existsSync(e.installPath)) out.push(e);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read a small JSON file, returning undefined on any error. */
export async function readJsonFile<T = unknown>(path: string): Promise<T | undefined> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Best-effort directory listing. */
export async function listDirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Best-effort file listing. */
export async function listFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Best-effort `stat`. */
export async function statSafe(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}
