import { statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { HostMcpCatalogueEntry, HostMcpCatalogueResult } from '@zana-ai/zcc-contracts/host-rpc';
import {
  MAX_GLOBAL_CONFIG_BYTES,
  hasStrippedCredentialFields,
  isReservedMcpName,
  sanitizeMcpServers,
  sourceGlobalConfig
} from './harness/claude/automated-isolation.js';
import { registeredMcpServerKeys } from './mcp-config.js';
import { homedir } from 'node:os';

/**
 * Host-side MCP server catalogue for the Persona picker and name resolution.
 *
 * Names, source and availability only. Commands, args, env, headers, oauth,
 * auth and urls never leave this module (Rule 1). User and project servers are
 * read from the same files and through the same sanitizer as the isolated
 * Claude seed (`CLAUDE_CONFIG_DIR`-aware); plugin and extension servers come
 * from the registry in `mcp-config.ts`. It resolves on the machine that runs
 * the agent, so a remote host reports its own state.
 */

export type { HostMcpCatalogueEntry, HostMcpCatalogueResult };

/** Total entries returned; user and project groups are each capped lower. */
export const MAX_CATALOGUE_ENTRIES = 256;
const MAX_SOURCE_ENTRIES = 64;
const MAX_NOTES = 64;
const MAX_NOTE_NAME_LENGTH = 64;

export interface BuildMcpCatalogueOptions {
  env?: NodeJS.ProcessEnv;
  /**
   * Main-authorized project root whose `.mcp.json` contributes project-scope
   * servers. Never renderer-supplied: callers resolve it from a registered
   * project (Rules 1, 2). Omitted for the global (project-less) Persona editor.
   */
  projectRoot?: string;
}

type ReadOutcome = { kind: 'missing' } | { kind: 'unreadable' } | { kind: 'ok'; value: Record<string, unknown> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bounded JSON object read that distinguishes "absent" from "present but unusable". */
function readBoundedJson(file: string): ReadOutcome {
  try {
    const size = statSync(file).size;
    if (size > MAX_GLOBAL_CONFIG_BYTES) return { kind: 'unreadable' };
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isPlainObject(parsed) ? { kind: 'ok', value: parsed } : { kind: 'unreadable' };
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'unreadable' };
  }
}

function safeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '?');
  return clean.length > MAX_NOTE_NAME_LENGTH ? `${clean.slice(0, MAX_NOTE_NAME_LENGTH)}...` : clean;
}

interface ScopeResult {
  entries: HostMcpCatalogueEntry[];
  notes: string[];
}

/** One scope's `mcpServers` map reduced to catalogue entries. Pure over the parsed config. */
function scopeEntries(
  source: 'user' | 'project',
  rawServers: unknown,
  label: string
): ScopeResult {
  const entries: HostMcpCatalogueEntry[] = [];
  const notes: string[] = [];
  if (rawServers === undefined) return { entries, notes };
  if (!isPlainObject(rawServers)) {
    notes.push(`${label} mcpServers is not an object; ignored`);
    return { entries, notes };
  }
  // Own-property enumeration into a Map: a `__proto__` name stays plain data.
  const raw = new Map(Object.entries(rawServers));
  const carried = sanitizeMcpServers(rawServers);
  const carriedNames = new Set(carried ? Object.keys(carried) : []);
  for (const [name, entry] of raw) {
    if (entries.length >= MAX_SOURCE_ENTRIES) {
      notes.push(`${label} servers beyond ${MAX_SOURCE_ENTRIES} omitted`);
      break;
    }
    if (name.length === 0 || name.length > 128) continue;
    if (isReservedMcpName(name)) {
      notes.push(`${label} server "${safeName(name)}" ignored: plugin:/ext: names are reserved`);
      continue;
    }
    if (!carriedNames.has(name)) {
      entries.push({ key: name, source, available: false, reason: 'not-carried' });
    } else if (hasStrippedCredentialFields(entry)) {
      entries.push({ key: name, source, available: false, reason: 'credentials-stripped' });
    } else {
      entries.push({ key: name, source, available: true });
    }
  }
  return { entries, notes };
}

/**
 * Build the catalogue plus any notes. Registry entries always win a key
 * collision: a user or project server whose key equals a registry key is
 * dropped (with a note), so a spoofed user entry never shadows a registered one.
 */
export function buildMcpCatalogueWithNotes(options: BuildMcpCatalogueOptions = {}): HostMcpCatalogueResult {
  const env = options.env ?? process.env;
  const notes: string[] = [];

  const registry: HostMcpCatalogueEntry[] = registeredMcpServerKeys().map((key) => ({
    key,
    source: key.startsWith('plugin:') ? 'plugin' : key.startsWith('ext:') ? 'extension' : 'user',
    available: true
  }));
  const registryKeys = new Set(registry.map((entry) => entry.key));

  const claudeDir = env.CLAUDE_CONFIG_DIR ? resolve(env.CLAUDE_CONFIG_DIR) : join(homedir(), '.claude');
  const userRead = readBoundedJson(sourceGlobalConfig(claudeDir, env, false));
  const scoped: HostMcpCatalogueEntry[] = [];
  if (userRead.kind === 'unreadable') {
    notes.push('user config is unreadable, malformed or oversized; user servers unavailable');
  } else if (userRead.kind === 'ok') {
    const user = scopeEntries('user', userRead.value.mcpServers, 'user');
    scoped.push(...user.entries);
    notes.push(...user.notes);
  }

  if (options.projectRoot) {
    const projectRead = readBoundedJson(join(resolve(options.projectRoot), '.mcp.json'));
    if (projectRead.kind === 'unreadable') {
      notes.push('project .mcp.json is unreadable, malformed or oversized; project servers unavailable');
    } else if (projectRead.kind === 'ok') {
      const project = scopeEntries('project', projectRead.value.mcpServers, 'project');
      scoped.push(...project.entries);
      notes.push(...project.notes);
    }
  }

  const seen = new Set<string>(registryKeys);
  const entries: HostMcpCatalogueEntry[] = [...registry];
  for (const entry of scoped) {
    if (registryKeys.has(entry.key)) {
      notes.push(`${entry.source} server "${safeName(entry.key)}" ignored: key is registered by a plugin or extension`);
      continue;
    }
    // A name defined in both user and project scope is listed once (user first).
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    entries.push(entry);
  }

  return {
    entries: entries.slice(0, MAX_CATALOGUE_ENTRIES),
    notes: notes.slice(0, MAX_NOTES)
  };
}

/** The catalogue entries only (`{ key, source, available, reason? }[]`). */
export function buildMcpCatalogue(options: BuildMcpCatalogueOptions = {}): HostMcpCatalogueEntry[] {
  return buildMcpCatalogueWithNotes(options).entries;
}
