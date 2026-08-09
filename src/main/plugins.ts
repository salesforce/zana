import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { shell } from 'electron';
import type { PluginEntry, PluginSource, Result } from '../shared/types.js';
import {
  getSettingsFile,
  listDirs,
  listFiles,
  listInstalledPlugins,
  readJsonFile,
  statSafe
} from './plugin-fs.js';

async function readSettings(): Promise<Record<string, unknown>> {
  const file = getSettingsFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(await readFile(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  const file = getSettingsFile();
  const tmp = `${file}.tmp.${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(settings, null, 2), 'utf-8');
  await rename(tmp, file);
}

interface ManifestProvides {
  skills?: string[];
  commands?: string[];
  mcpServers?: string[];
}

interface RawManifest {
  name?: string;
  description?: string;
  version?: string;
  commands?: Array<string | { name?: string }> | string[];
  skills?: string[];
}

/**
 * Locate `<root>/.claude-plugin/plugin.json`, falling back to `<root>/plugin.json`.
 * Returns `{ valid, manifest }` so the caller can render a warning when the
 * file is missing or unparseable rather than dropping the plugin entirely.
 */
async function readManifest(installPath: string): Promise<{ valid: boolean; manifest?: RawManifest }> {
  const candidates = [
    join(installPath, '.claude-plugin', 'plugin.json'),
    join(installPath, 'plugin.json')
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const parsed = await readJsonFile<RawManifest>(p);
    if (parsed && typeof parsed === 'object') return { valid: true, manifest: parsed };
    return { valid: false };
  }
  return { valid: false };
}

/**
 * Compute `provides.{skills,commands,mcpServers}` from the on-disk layout —
 * we don't trust the manifest to enumerate everything because most plugins
 * don't bother filling in those keys.
 */
async function computeProvides(installPath: string, manifest?: RawManifest) {
  const skills: string[] = [];
  const commands: string[] = [];
  const mcpServers: string[] = [];

  // Skills: sibling skills/ dir
  const skillsDir = join(installPath, 'skills');
  if (existsSync(skillsDir)) {
    const single = await statSafe(join(skillsDir, 'SKILL.md'));
    if (single?.isFile()) {
      // Single-skill layout: the skill name is the plugin name.
      const name = manifest?.name ?? (basename(installPath) || 'skill');
      skills.push(name);
    } else {
      const subs = await listDirs(skillsDir);
      for (const s of subs) skills.push(s);
    }
  }

  // Commands: commands/*.md or *.json (each file is one command)
  const commandsDir = join(installPath, 'commands');
  if (existsSync(commandsDir)) {
    const files = await listFiles(commandsDir);
    for (const f of files) {
      if (f.endsWith('.md') || f.endsWith('.json')) {
        commands.push(f.replace(/\.(md|json)$/, ''));
      }
    }
  }
  if (Array.isArray(manifest?.commands)) {
    for (const c of manifest!.commands) {
      const name = typeof c === 'string' ? c : c?.name;
      if (name && !commands.includes(name)) commands.push(name);
    }
  }

  // MCP servers: sibling .mcp.json
  const mcpJson = await readJsonFile<{ mcpServers?: Record<string, unknown> }>(
    join(installPath, '.mcp.json')
  );
  if (mcpJson?.mcpServers && typeof mcpJson.mcpServers === 'object') {
    for (const name of Object.keys(mcpJson.mcpServers)) mcpServers.push(name);
  }

  return {
    skills: skills.sort(),
    commands: commands.sort(),
    mcpServers: mcpServers.sort()
  };
}

function readEnabledMap(settings: Record<string, unknown>): Record<string, boolean> {
  const raw = settings.enabledPlugins;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export async function listPlugins(): Promise<PluginEntry[]> {
  const [installed, settings] = await Promise.all([listInstalledPlugins(), readSettings()]);
  const enabledMap = readEnabledMap(settings);
  const out: PluginEntry[] = [];
  for (const inst of installed) {
    const { valid, manifest } = await readManifest(inst.installPath);
    const provides = await computeProvides(inst.installPath, manifest);
    const source: PluginSource = inst.marketplace === 'user' ? 'user' : 'marketplace';
    // Plugins default to enabled unless explicitly disabled in settings.
    const enabled = enabledMap[inst.id] !== false;
    out.push({
      id: inst.id,
      name: manifest?.name?.trim() || inst.name,
      source,
      marketplace: source === 'marketplace' ? inst.marketplace : undefined,
      version: manifest?.version || inst.version,
      description: manifest?.description,
      path: inst.installPath,
      provides,
      enabled,
      manifestValid: valid
    });
  }
  return out;
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<Result<true>> {
  if (!id || !id.includes('@')) {
    return { ok: false, code: 'BAD_ID', message: `Invalid plugin id: ${id}` };
  }
  const settings = await readSettings();
  const existing = settings.enabledPlugins;
  const map: Record<string, boolean> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, boolean>) }
      : {};
  if (enabled) {
    // CLI treats "absent" and "true" as enabled; keep the file tidy by
    // deleting rather than writing `true`.
    delete map[id];
  } else {
    map[id] = false;
  }
  if (Object.keys(map).length === 0) {
    delete settings.enabledPlugins;
  } else {
    settings.enabledPlugins = map;
  }
  try {
    await writeSettings(settings);
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function revealPlugin(id: string): Promise<Result<true>> {
  // Cheap registry lookup — listPlugins() walks every plugin's manifest +
  // skills + commands + .mcp.json, which is wasteful for a path lookup.
  const installed = await listInstalledPlugins();
  const found = installed.find((p) => p.id === id);
  if (!found) {
    return { ok: false, code: 'NOT_FOUND', message: `Plugin not found: ${id}` };
  }
  try {
    await shell.openPath(found.installPath);
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'REVEAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}
