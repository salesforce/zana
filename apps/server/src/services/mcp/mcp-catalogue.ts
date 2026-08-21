import { existsSync } from 'node:fs';
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { shell } from 'electron';
import type {
  McpServerEntry,
  McpSource,
  McpTransport,
  Project,
  Result
} from '@zana-ai/zcc-domain/product';
import { getSettingsFile, listInstalledPlugins, readJsonFile } from '../extensions/plugin-fs.js';

function getUserConfigFile(): string {
  // Tests inject ZCC_CLAUDE_HOME; production uses the real homedir.
  return join(process.env.ZCC_CLAUDE_HOME || homedir(), '.claude.json');
}

interface RawServer {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  headers?: unknown;
  type?: unknown;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out.length > 0 ? out : undefined;
}

function asStringKeys(v: unknown): string[] | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const keys = Object.entries(v as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string')
    .map(([key]) => key);
  return keys.length > 0 ? keys : undefined;
}

function transportFor(raw: RawServer): McpTransport {
  if (asString(raw.command)) return 'stdio';
  if (asString(raw.url)) return 'http';
  const t = asString(raw.type);
  if (t === 'stdio' || t === 'http') return t;
  return 'unknown';
}

function buildEntry(
  source: McpSource,
  name: string,
  raw: RawServer,
  enabled: boolean,
  extras: {
    /** Display name (e.g., "zana") for the row label. */
    pluginName?: string;
    /**
     * Marketplace-qualified plugin id ("zana@core") used in row id to avoid
     * collisions when two marketplaces ship plugins with the same name.
     */
    pluginId?: string;
    projectId?: string;
    projectPath?: string;
  }
): McpServerEntry {
  const transport = transportFor(raw);
  return {
    id:
      source === 'plugin'
        ? `plugin:${extras.pluginId ?? extras.pluginName ?? 'unknown'}:${name}`
        : source === 'project'
          ? `project:${extras.projectId ?? 'unknown'}:${name}`
          : `user:${name}`,
    name,
    source,
    pluginName: extras.pluginName,
    projectId: extras.projectId,
    projectPath: extras.projectPath,
    transport,
    command: asString(raw.command),
    args: asStringArray(raw.args),
    envKeys: asStringKeys(raw.env),
    url: asString(raw.url),
    headerKeys: asStringKeys(raw.headers),
    enabled,
    enabledLockedBy: source === 'plugin' ? 'plugin' : undefined
  };
}

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

function readDisabledUserMcp(settings: Record<string, unknown>): Set<string> {
  const raw = settings.disabledMcpServers;
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((x): x is string => typeof x === 'string'));
}

async function readProjectDisabledSet(projectPath: string): Promise<Set<string>> {
  const out = new Set<string>();
  const localPath = join(projectPath, '.claude', 'settings.local.json');
  const local = await readJsonFile<Record<string, unknown>>(localPath);
  if (!local || typeof local !== 'object') return out;
  const servers = local.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return out;
  for (const [name, cfg] of Object.entries(servers as Record<string, unknown>)) {
    if (cfg && typeof cfg === 'object' && (cfg as Record<string, unknown>).disabled === true) {
      out.add(name);
    }
  }
  return out;
}

function readPluginEnabledMap(settings: Record<string, unknown>): Record<string, boolean> {
  const raw = settings.enabledPlugins;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/**
 * List MCP servers across all three sources. Project-scope rows depend on the
 * caller passing the current project list (the renderer-side store has them
 * already; we don't re-scan the FS here).
 */
export async function listMcpServersAll(projects: Project[]): Promise<McpServerEntry[]> {
  const [userJson, settings] = await Promise.all([
    readJsonFile<Record<string, unknown>>(getUserConfigFile()),
    readSettings()
  ]);
  const out: McpServerEntry[] = [];
  const disabledUser = readDisabledUserMcp(settings);

  // 1. User-scope
  if (userJson?.mcpServers && typeof userJson.mcpServers === 'object') {
    for (const [name, raw] of Object.entries(userJson.mcpServers as Record<string, RawServer>)) {
      out.push(buildEntry('user', name, raw, !disabledUser.has(name), {}));
    }
  }

  // 2. Plugin-scope: each installed plugin's sibling .mcp.json. Plugin's
  //    enabled-state cascades onto its servers — disabling the plugin
  //    disables its servers in the UI.
  const installed = await listInstalledPlugins();
  const pluginEnabled = readPluginEnabledMap(settings);
  for (const inst of installed) {
    const isPluginEnabled = pluginEnabled[inst.id] !== false;
    const pluginMcp = await readJsonFile<{ mcpServers?: Record<string, RawServer> }>(
      join(inst.installPath, '.mcp.json')
    );
    if (!pluginMcp?.mcpServers) continue;
    for (const [name, raw] of Object.entries(pluginMcp.mcpServers)) {
      out.push(
        buildEntry('plugin', name, raw, isPluginEnabled, {
          pluginName: inst.name,
          pluginId: inst.id
        })
      );
    }
  }

  // 3. Per-project: <proj>/.mcp.json + <proj>/.claude/settings.local.json disabled flags
  for (const project of projects) {
    const projectMcp = await readJsonFile<{ mcpServers?: Record<string, RawServer> }>(
      join(project.path, '.mcp.json')
    );
    if (!projectMcp?.mcpServers) continue;
    const disabled = await readProjectDisabledSet(project.path);
    for (const [name, raw] of Object.entries(projectMcp.mcpServers)) {
      out.push(
        buildEntry('project', name, raw, !disabled.has(name), {
          projectId: project.id,
          projectPath: project.path
        })
      );
    }
  }

  return out.sort((a, b) => {
    if (a.source !== b.source) {
      const order: Record<McpSource, number> = { user: 0, plugin: 1, project: 2 };
      return order[a.source] - order[b.source];
    }
    return a.name.localeCompare(b.name);
  });
}

interface ParsedId {
  source: McpSource;
  name: string;
  /** Marketplace-qualified plugin id ("zana@core") for plugin-source rows. */
  pluginId?: string;
  projectId?: string;
}

function parseId(id: string): ParsedId | null {
  // Formats:
  //   user:<name>
  //   plugin:<pluginId>:<name>          where pluginId is "<pluginName>@<marketplace>"
  //   project:<projectId>:<name>        projectId is uuid-style (no colons)
  const i = id.indexOf(':');
  if (i === -1) return null;
  const source = id.slice(0, i) as McpSource;
  const rest = id.slice(i + 1);
  if (source === 'user') return { source, name: rest };
  const j = rest.indexOf(':');
  if (j === -1) return null;
  const head = rest.slice(0, j);
  const name = rest.slice(j + 1);
  if (source === 'plugin') return { source, name, pluginId: head };
  if (source === 'project') return { source, name, projectId: head };
  return null;
}

async function setProjectMcpDisabled(
  projectPath: string,
  name: string,
  disabled: boolean
): Promise<void> {
  const dir = join(projectPath, '.claude');
  const target = join(dir, 'settings.local.json');
  await mkdir(dir, { recursive: true });

  // Read existing JSON, distinguishing "missing file" (start fresh) from
  // "malformed JSON" (refuse to clobber). The CLI treats settings.local.json
  // as load-bearing — silently overwriting bad JSON would lose work.
  let existing: Record<string, unknown> = {};
  try {
    const text = await readFile(target, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      const e = new Error(
        `Refusing to overwrite malformed JSON in ${target}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      // Tag with a code the IPC handler can surface as Result.code.
      (e as Error & { code?: string }).code = 'BAD_JSON';
      throw e;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      // Fresh file — keep `existing = {}`.
    } else {
      throw err;
    }
  }

  const servers: Record<string, unknown> =
    existing.mcpServers && typeof existing.mcpServers === 'object' && !Array.isArray(existing.mcpServers)
      ? { ...(existing.mcpServers as Record<string, unknown>) }
      : {};

  const entry: Record<string, unknown> =
    servers[name] && typeof servers[name] === 'object' && !Array.isArray(servers[name])
      ? { ...(servers[name] as Record<string, unknown>) }
      : {};

  if (disabled) entry.disabled = true;
  else delete entry.disabled;

  if (Object.keys(entry).length === 0) delete servers[name];
  else servers[name] = entry;

  if (Object.keys(servers).length === 0) delete existing.mcpServers;
  else existing.mcpServers = servers;

  const tmp = `${target}.tmp.${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
  await rename(tmp, target);
}

/**
 * Toggle an MCP server. Plugin-source servers can't be toggled directly —
 * the user must disable the plugin instead. We surface that constraint as
 * `LOCKED_BY_PLUGIN` rather than silently no-oping.
 */
export async function setMcpServerEnabledById(
  id: string,
  enabled: boolean,
  projects: Project[]
): Promise<Result<true>> {
  const parsed = parseId(id);
  if (!parsed) return { ok: false, code: 'BAD_ID', message: `Invalid id: ${id}` };

  if (parsed.source === 'plugin') {
    return {
      ok: false,
      code: 'LOCKED_BY_PLUGIN',
      message: `Toggle the plugin "${parsed.pluginId ?? 'unknown'}" instead`
    };
  }

  if (parsed.source === 'user') {
    const settings = await readSettings();
    const list = Array.isArray(settings.disabledMcpServers)
      ? [...(settings.disabledMcpServers as string[])]
      : [];
    const idx = list.indexOf(parsed.name);
    if (enabled) {
      if (idx !== -1) list.splice(idx, 1);
    } else if (idx === -1) {
      list.push(parsed.name);
    }
    if (list.length === 0) delete settings.disabledMcpServers;
    else settings.disabledMcpServers = list;
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

  // project-scope
  const project = projects.find((p) => p.id === parsed.projectId);
  if (!project) {
    return { ok: false, code: 'PROJECT_NOT_FOUND', message: `No project: ${parsed.projectId}` };
  }
  try {
    await setProjectMcpDisabled(project.path, parsed.name, !enabled);
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function revealMcpServer(
  id: string,
  projects: Project[]
): Promise<Result<true>> {
  const parsed = parseId(id);
  if (!parsed) return { ok: false, code: 'BAD_ID', message: `Invalid id: ${id}` };
  let target = '';
  if (parsed.source === 'user') {
    target = getUserConfigFile();
  } else if (parsed.source === 'plugin') {
    const installed = await listInstalledPlugins();
    const inst = installed.find((p) => p.id === parsed.pluginId);
    if (!inst) {
      return { ok: false, code: 'NOT_FOUND', message: `Plugin: ${parsed.pluginId}` };
    }
    target = join(inst.installPath, '.mcp.json');
  } else if (parsed.source === 'project') {
    const project = projects.find((p) => p.id === parsed.projectId);
    if (!project) {
      return { ok: false, code: 'PROJECT_NOT_FOUND', message: `No project: ${parsed.projectId}` };
    }
    target = join(project.path, '.mcp.json');
  }
  if (!target || !existsSync(target)) {
    return { ok: false, code: 'NOT_FOUND', message: `Not on disk: ${target}` };
  }
  try {
    shell.showItemInFolder(target);
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'REVEAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}
