/**
 * MCP server configuration helpers for the Settings panel.
 *
 * Reads from three sources:
 *   1. User-scope:   ~/.claude.json           → mcpServers
 *   2. Project-scope: <projectPath>/.mcp.json → mcpServers
 *   3. Disabled flags: <projectPath>/.claude/settings.local.json → mcpServers.<name>.disabled
 *
 * `setMcpServerEnabled` does an atomic (tmp + rename) update of the
 * settings.local.json disabled flag, preserving all other keys.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@zana-ai/zcc-domain/product';

/**
 * Per-file write mutex for `setMcpServerEnabled` (Rule 4). The atomic tmp+rename
 * only prevents a torn file; it does NOT serialize the read-modify-write across
 * concurrent callers. Two rapid toggles of *different* servers would each read
 * the same pre-existing settings, each flip their own flag, then the second
 * rename would clobber the first's change (a lost update). Chaining every write
 * for a given target path through one promise serializes the whole RMW so each
 * call reads the previous call's committed result.
 */
const writeChains = new Map<string, Promise<void>>();

function withFileLock(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeChains.get(key) ?? Promise.resolve();
  // Swallow the predecessor's rejection so one failed write can't reject every
  // queued follow-up; each caller still sees its OWN result via `run`.
  const run = prev.catch(() => {}).then(fn);
  writeChains.set(key, run);
  // Drop the chain entry once it drains to the tail we just set, so the map
  // doesn't accumulate one entry per project path for the app's lifetime.
  run.finally(() => {
    if (writeChains.get(key) === run) writeChains.delete(key);
  }).catch(() => {});
  return run;
}

/** Safely parse JSON; returns undefined on any error. */
async function readJson(filePath: string): Promise<unknown> {
  try {
    const text = await readFile(filePath, 'utf-8');
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Extract a `command` string from a raw server entry for display. */
function resolveCommand(entry: unknown): string {
  if (entry === null || typeof entry !== 'object') return '';
  const e = entry as Record<string, unknown>;
  // stdio-type servers have a `command` key
  if (typeof e.command === 'string' && e.command) return e.command;
  // http/streamable-http servers have a `url` key
  if (typeof e.url === 'string' && e.url) return e.url;
  return '';
}

function resolveArgs(entry: unknown): string[] | undefined {
  if (entry === null || typeof entry !== 'object') return undefined;
  const e = entry as Record<string, unknown>;
  if (Array.isArray(e.args) && e.args.every((a) => typeof a === 'string')) {
    return e.args as string[];
  }
  return undefined;
}

function resolveEnvKeys(entry: unknown): string[] | undefined {
  if (entry === null || typeof entry !== 'object') return undefined;
  const e = entry as Record<string, unknown>;
  if (e.env !== null && typeof e.env === 'object' && !Array.isArray(e.env)) {
    const env = e.env as Record<string, unknown>;
    const keys = Object.entries(env)
      .filter(([, value]) => typeof value === 'string')
      .map(([key]) => key);
    return keys.length > 0 ? keys : undefined;
  }
  return undefined;
}

/**
 * List all MCP servers visible to a given project, merging user-scope
 * (`~/.claude.json`) and project-scope (`<projectPath>/.mcp.json`).
 * Enabled status is derived from `<projectPath>/.claude/settings.local.json`.
 */
export async function listMcpServers(projectPath: string): Promise<McpServer[]> {
  const userConfigPath = join(homedir(), '.claude.json');
  const projectConfigPath = join(projectPath, '.mcp.json');
  const localSettingsPath = join(projectPath, '.claude', 'settings.local.json');

  const [userJson, projectJson, localJson] = await Promise.all([
    readJson(userConfigPath),
    readJson(projectConfigPath),
    readJson(localSettingsPath)
  ]);

  // Build disabled-name set from settings.local.json
  const disabledMap: Record<string, boolean> = {};
  if (localJson !== null && typeof localJson === 'object') {
    const local = localJson as Record<string, unknown>;
    if (local.mcpServers !== null && typeof local.mcpServers === 'object' && !Array.isArray(local.mcpServers)) {
      const servers = local.mcpServers as Record<string, unknown>;
      for (const [name, cfg] of Object.entries(servers)) {
        if (cfg !== null && typeof cfg === 'object') {
          const c = cfg as Record<string, unknown>;
          if (c.disabled === true) disabledMap[name] = true;
        }
      }
    }
  }

  const servers: McpServer[] = [];

  // User-scope servers
  if (userJson !== null && typeof userJson === 'object') {
    const user = userJson as Record<string, unknown>;
    if (user.mcpServers !== null && typeof user.mcpServers === 'object' && !Array.isArray(user.mcpServers)) {
      const mcpServers = user.mcpServers as Record<string, unknown>;
      for (const [name, entry] of Object.entries(mcpServers)) {
        servers.push({
          name,
          scope: 'user',
          command: resolveCommand(entry),
          args: resolveArgs(entry),
          envKeys: resolveEnvKeys(entry),
          enabled: !disabledMap[name]
        });
      }
    }
  }

  // Project-scope servers
  if (projectJson !== null && typeof projectJson === 'object') {
    const project = projectJson as Record<string, unknown>;
    if (project.mcpServers !== null && typeof project.mcpServers === 'object' && !Array.isArray(project.mcpServers)) {
      const mcpServers = project.mcpServers as Record<string, unknown>;
      for (const [name, entry] of Object.entries(mcpServers)) {
        servers.push({
          name,
          scope: 'project',
          command: resolveCommand(entry),
          args: resolveArgs(entry),
          envKeys: resolveEnvKeys(entry),
          enabled: !disabledMap[name]
        });
      }
    }
  }

  return servers;
}

/**
 * Atomically update `<projectPath>/.claude/settings.local.json` to set or
 * clear the `mcpServers.<name>.disabled` flag. Preserves all other keys.
 * Creates the file and directory if missing.
 */
export async function setMcpServerEnabled(
  projectPath: string,
  name: string,
  enabled: boolean
): Promise<void> {
  const dir = join(projectPath, '.claude');
  const target = join(dir, 'settings.local.json');
  // Serialize the whole read-modify-write for this file so concurrent toggles
  // of different servers don't lost-update each other (Rule 4).
  return withFileLock(target, async () => {
    await writeMcpDisabledFlag(dir, target, name, enabled);
  });
}

async function writeMcpDisabledFlag(
  dir: string,
  target: string,
  name: string,
  enabled: boolean
): Promise<void> {
  await mkdir(dir, { recursive: true });

  // Read existing content, defaulting to empty object on any error.
  let existing: Record<string, unknown> = {};
  try {
    const text = await readFile(target, 'utf-8');
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // file doesn't exist or is malformed — start fresh
  }

  // Ensure mcpServers key is an object
  let mcpServers: Record<string, unknown> = {};
  if (
    existing.mcpServers !== null &&
    typeof existing.mcpServers === 'object' &&
    !Array.isArray(existing.mcpServers)
  ) {
    mcpServers = { ...(existing.mcpServers as Record<string, unknown>) };
  }

  // Update the specific server's disabled flag
  const serverEntry: Record<string, unknown> =
    mcpServers[name] !== null && typeof mcpServers[name] === 'object' && !Array.isArray(mcpServers[name])
      ? { ...(mcpServers[name] as Record<string, unknown>) }
      : {};

  if (enabled) {
    // Remove disabled flag (or set to false) — prefer deletion to keep JSON clean
    delete serverEntry.disabled;
  } else {
    serverEntry.disabled = true;
  }

  // If the entry is now empty, remove it entirely
  if (Object.keys(serverEntry).length === 0) {
    delete mcpServers[name];
  } else {
    mcpServers[name] = serverEntry;
  }

  const updated: Record<string, unknown> = {
    ...existing,
    mcpServers
  };

  // If mcpServers is now empty, remove the key to keep the file tidy
  if (Object.keys(mcpServers).length === 0) {
    delete updated.mcpServers;
  }

  const json = JSON.stringify(updated, null, 2) + '\n';
  const tmp = `${target}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tmp, json, 'utf-8');
  await rename(tmp, target);
}
