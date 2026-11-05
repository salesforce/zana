import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { removeTreeWithoutFollowingLinksAsync } from '@zana-ai/zcc-agent-process-utils';

/**
 * Plugin-contributed skills for PTY harnesses that read `~/.agents/skills`
 * (Codex, OpenCode, Pi, Cursor). Entries are Zana-owned, namespaced
 * `plugin-<id>-<skill>` directories carrying a marker file. Reconcile is a
 * full sweep: it writes the desired set and removes every OWNED entry that is
 * not desired (plugin disabled, uninstalled, skill dropped, or left over from
 * a previous run). A directory without the marker, a symlink, or a file is
 * never touched, whatever its name.
 */

export const PLUGIN_SKILL_MARKER = '.zana-plugin-skill';
const MARKER_MAGIC = 'zana-plugin-skill/v1';
export const PLUGIN_SKILLS_PER_PLUGIN_MAX = 20;

export interface PluginAgentsSkillEntry {
  pluginId: string;
  skillName: string;
  content: string;
}

function slugify(raw: string, fallback: string): string {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base || fallback;
}

export function pluginAgentsSkillDirName(pluginId: string, skillName: string): string {
  return `plugin-${slugify(pluginId, 'plugin')}-${slugify(skillName, 'skill')}`;
}

export function pluginAgentsSkillsRoot(homeDir: string = homedir()): string {
  return join(homeDir, '.agents', 'skills');
}

let chain: Promise<unknown> = Promise.resolve();

/** One in-process mutex for every read-modify-write of the shared skills root. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function isOwnedEntry(dir: string): Promise<boolean> {
  try {
    const dirStat = await lstat(dir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return false;
    const marker = join(dir, PLUGIN_SKILL_MARKER);
    const markerStat = await lstat(marker);
    if (!markerStat.isFile() || markerStat.isSymbolicLink()) return false;
    return (await readFile(marker, 'utf8')).startsWith(MARKER_MAGIC);
  } catch {
    return false;
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

export interface ReconcileResult {
  written: string[];
  removed: string[];
}

export function reconcilePluginAgentsSkills(args: {
  entries: readonly PluginAgentsSkillEntry[];
  homeDir?: string;
  log?: (context: string, err: unknown) => void;
}): Promise<ReconcileResult> {
  return serialized(async () => {
    const root = pluginAgentsSkillsRoot(args.homeDir);
    const result: ReconcileResult = { written: [], removed: [] };
    const desired = new Map<string, PluginAgentsSkillEntry>();
    const perPlugin = new Map<string, number>();
    for (const entry of args.entries) {
      const count = perPlugin.get(entry.pluginId) ?? 0;
      if (count >= PLUGIN_SKILLS_PER_PLUGIN_MAX) continue;
      const name = pluginAgentsSkillDirName(entry.pluginId, entry.skillName);
      if (desired.has(name)) continue;
      perPlugin.set(entry.pluginId, count + 1);
      desired.set(name, entry);
    }

    let existing: string[] = [];
    try {
      existing = await readdir(root);
    } catch {
      existing = [];
    }
    for (const name of existing) {
      if (desired.has(name)) continue;
      const dir = join(root, name);
      if (!(await isOwnedEntry(dir))) continue;
      try {
        await removeTreeWithoutFollowingLinksAsync(dir);
        result.removed.push(name);
      } catch (err) {
        args.log?.(`reconcilePluginAgentsSkills:remove:${name}`, err);
      }
    }

    for (const [name, entry] of desired) {
      const dir = join(root, name);
      try {
        const present = existing.includes(name);
        if (present && !(await isOwnedEntry(dir))) {
          args.log?.(`reconcilePluginAgentsSkills:${entry.pluginId}`, new Error(`refusing to overwrite non-Zana entry ${name}`));
          continue;
        }
        await mkdir(dir, { recursive: true });
        const marker = `${MARKER_MAGIC}\n${entry.pluginId}\n`;
        if ((await readOrNull(join(dir, PLUGIN_SKILL_MARKER))) !== marker) {
          await atomicWrite(join(dir, PLUGIN_SKILL_MARKER), marker);
        }
        if ((await readOrNull(join(dir, 'SKILL.md'))) !== entry.content) {
          await atomicWrite(join(dir, 'SKILL.md'), entry.content);
          result.written.push(name);
        }
      } catch (err) {
        args.log?.(`reconcilePluginAgentsSkills:${entry.pluginId}`, err);
      }
    }
    return result;
  });
}
