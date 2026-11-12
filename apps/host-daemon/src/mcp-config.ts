/**
 * Per-project `.mcp.json` files written to `~/.zcc/mcp/<projectId>.json`.
 *
 * We deliberately do NOT touch the user's project directory. Instead, the
 * agent CLI is launched with `--mcp-config <absolute-path>` pointing at one
 * of these launcher-owned files. The `${ZCC_MCP_URL}` placeholder is left
 * literal — Claude's CLI evaluates it against the env the launcher injects
 * (`pty.ts` sets `ZCC_MCP_URL` to the live MCP server URL with the project
 * id baked in).
 *
 * Writing outside the project tree (rather than a `.mcp.json` inside it) is
 * deliberate — we don't own the project directory.
 *
 * This launcher file is the Claude CLI / PTY path. Codex and OpenCode PTYs
 * receive the same selection through {@link sessionPluginMcpServers}.
 * Conversation threads do not read it: plugin tools there come from
 * `zcc.agents.registerTool` via the zcc DynamicTools MCP. There is no runtime
 * `registerMcpServer`.
 */

import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { mcpAllowlistCovers, type McpServerRef } from '@zana-ai/zcc-domain/product';
import { rewritePluginMcpArgs } from '@zana-ai/zcc-host-workspace';
import { resolveZccDataDir } from './host-config.js';

function mcpConfigDir(): string {
  return join(resolveZccDataDir(), 'mcp');
}

/** Pure helper: returns the absolute path of the per-project `.mcp.json`. */
export function mcpConfigPathForProject(projectId: string): string {
  return join(mcpConfigDir(), `${projectId}.json`);
}

type McpServerDef = { type: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> };

/**
 * Small internal registry of MCP servers personas can reference by name.
 * Unknown names are silently ignored — a persona can request a server that
 * doesn't exist yet, and it simply won't be wired up. Seed entries are the
 * app's own (currently none); `ext:<id>:<name>` entries are populated at
 * runtime by {@link rebuildExtensionServers} from installed extensions'
 * manifests — see docs/extension-agent-capabilities-plan.md.
 */
const MCP_SERVER_SEED: Record<string, McpServerDef> = {
  // Add app-owned servers here as they become useful for personas. Example:
  // 'filesystem': { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] }
};

/**
 * Mutable registry, rebuilt wholesale on every `rebuildExtensionServers` call
 * (declarative replace, never accumulate — mirrors `PersonaTeamRegistry.
 * setPersonas`). Namespaced entries live under a `ext:<id>:<name>` key
 * alongside the immutable seed, so an extension can NEVER shadow or collide
 * with an app-owned or another extension's server name.
 */
let extensionServerRegistry: Record<string, McpServerDef> = {};
let pluginServerRegistry: Record<string, McpServerDef> = {};

/**
 * Extension ids whose `mcpServers` contributions include at least one
 * `alwaysOn: true` entry — those entries are merged into EVERY spawn for a
 * project where that extension is enabled, without requiring a persona to
 * opt in by name. Maps id → the `ext:<id>:<name>` keys to always include.
 */
let alwaysOnServerNamesByExtension: Record<string, string[]> = {};
let alwaysOnServerNamesByPlugin: Record<string, string[]> = {};

function mcpServerRegistry(): Record<string, McpServerDef> {
  return { ...MCP_SERVER_SEED, ...extensionServerRegistry, ...pluginServerRegistry };
}

/**
 * Narrow shape `rebuildExtensionServers` needs from an `ExtensionEntry` —
 * declared standalone (not imported from shared/types.ts) so this module
 * stays a leaf with no dependency on the extension discovery/consent stack.
 */
export interface McpServerContributor {
  id: string;
  enabled: boolean;
  consented: boolean;
  manifest: {
    permissions?: string[];
    mcpServers?: Array<{
      name: string;
      type: string;
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
      alwaysOn?: boolean;
    }>;
  } | null;
}

/**
 * Rebuild the extension-contributed slice of the MCP server registry from
 * the currently-installed extensions. Declarative replace (Rule 5: bounded,
 * `slice`-then-map, never accumulate) — call after every install / uninstall
 * / enable / disable / reload so a disabled/uninstalled extension's servers
 * stop resolving on the very next `configBody` build. Gated the same way any
 * other brokered capability is: only an ENABLED + CONSENTED extension whose
 * declared permissions include `agent:contribute` gets its servers applied —
 * an extension that merely PARSED a `mcpServers` block (e.g. pending consent)
 * contributes nothing until approved (Rule 1: main is the sole authority here,
 * this never trusts a live per-process call). `command` is basename-only —
 * the identical guard `execAllowlist` already enforces — so a malicious
 * manifest can't smuggle a shell string or path traversal into its own server
 * definition. Never throws: a malformed contributor/entry is skipped, never
 * blocks the rebuild for the rest.
 */
export function rebuildExtensionServers(contributors: readonly McpServerContributor[]): void {
  const registry: Record<string, McpServerDef> = {};
  const alwaysOn: Record<string, string[]> = {};
  for (const ext of contributors) {
    try {
      if (!ext.enabled || !ext.consented) continue;
      const perms = ext.manifest?.permissions ?? [];
      if (!perms.includes('agent:contribute')) continue;
      const servers = ext.manifest?.mcpServers ?? [];
      const alwaysOnNames: string[] = [];
      for (const s of servers) {
        if (!s.name || !s.type) continue;
        if (s.type === 'stdio') {
          if (!s.command || s.command !== basename(s.command)) continue; // basename-only guard
        } else if (!s.url) {
          continue;
        }
        const key = `ext:${ext.id}:${s.name}`;
        registry[key] = { type: s.type, command: s.command, args: s.args, url: s.url, env: s.env };
        if (s.alwaysOn) alwaysOnNames.push(key);
      }
      if (alwaysOnNames.length) alwaysOn[ext.id] = alwaysOnNames;
    } catch {
      // one contributor's malformed data must never block the rest.
    }
  }
  extensionServerRegistry = registry;
  alwaysOnServerNamesByExtension = alwaysOn;
}

export interface PluginMcpContributor {
  id: string;
  enabled: boolean;
  rootDir: string;
  mcpServers: Array<{
    name: string;
    type: string;
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    alwaysOn?: boolean;
  }>;
}

/**
 * Plugin-contributed MCP servers (package.json `zcc.mcpServers`). Enabled
 * plugins contribute; there is no consent / agent:contribute gate. Keys are
 * `plugin:<id>:<name>`. Relative args that exist under the plugin root are
 * rewritten to contained realpaths; an escaping arg drops that server.
 */
export function rebuildPluginServers(contributors: readonly PluginMcpContributor[]): void {
  const registry: Record<string, McpServerDef> = {};
  const alwaysOn: Record<string, string[]> = {};
  for (const plugin of contributors) {
    try {
      if (!plugin.enabled) continue;
      const alwaysOnNames: string[] = [];
      for (const s of plugin.mcpServers) {
        if (!s.name || !s.type) continue;
        let args = s.args;
        if (s.type === 'stdio') {
          if (!s.command || s.command !== basename(s.command)) continue;
          const rewritten = rewritePluginMcpArgs(plugin.rootDir, s.args);
          if (rewritten === null) continue;
          args = rewritten;
        } else if (!s.url) {
          continue;
        }
        const key = `plugin:${plugin.id}:${s.name}`;
        registry[key] = { type: s.type, command: s.command, args, url: s.url, env: s.env };
        if (s.alwaysOn) alwaysOnNames.push(key);
      }
      if (alwaysOnNames.length) alwaysOn[plugin.id] = alwaysOnNames;
    } catch {
      /* one contributor's malformed data must never block the rest */
    }
  }
  pluginServerRegistry = registry;
  alwaysOnServerNamesByPlugin = alwaysOn;
}

/** Every currently-registered `ext:<id>:<name>` key with `alwaysOn: true`, across all enabled+consented extensions. */
function allAlwaysOnServerNames(): string[] {
  return [
    ...Object.values(alwaysOnServerNamesByExtension).flat(),
    ...Object.values(alwaysOnServerNamesByPlugin).flat()
  ];
}

/**
 * Matcher view of a registry key. `plugin:<id>:<name>` / `ext:<id>:<name>` keys
 * are pinned sources; seed keys are bare app-owned names.
 */
function serverRef(key: string): McpServerRef {
  const prefix = key.startsWith('plugin:') ? 'plugin' : key.startsWith('ext:') ? 'extension' : null;
  if (!prefix) return { key, source: 'user', name: key };
  const nameStart = key.indexOf(':', key.indexOf(':') + 1) + 1;
  return { key, source: prefix, name: nameStart > 0 ? key.slice(nameStart) : key };
}

/**
 * The one enablement rule for plugin/extension MCP servers on every PTY
 * surface. `undefined` = all mode (persona has no `mcpServers`): every
 * registered `alwaysOn` entry plus any named extras, unchanged from before.
 * An array = allowlist mode: exactly the registered servers a list entry
 * covers via the shared {@link mcpAllowlistCovers}; `[]` selects none and an
 * `alwaysOn` server is NOT exempt (only `zcc-inbox`, which is not in this
 * registry, is always allowed). Registry membership already encodes enabled
 * (and, for extensions, consented) state. Unknown names are ignored.
 */
function selectedServerEntries(extraServerNames?: string[]): Array<[string, McpServerDef]> {
  const registry = mcpServerRegistry();
  const entries: Array<[string, McpServerDef]> = [];
  if (extraServerNames === undefined) {
    const names = new Set(allAlwaysOnServerNames());
    for (const name of names) {
      const def = registry[name];
      if (def) entries.push([name, def]);
    }
    return entries;
  }
  for (const [key, def] of Object.entries(registry)) {
    const ref = serverRef(key);
    if (extraServerNames.some((entry) => mcpAllowlistCovers(entry, ref))) entries.push([key, def]);
  }
  return entries;
}

/**
 * Claude `--allowedTools` wildcards for always-on plugin/extension MCP servers.
 * `.mcp.json` keys are `plugin:<id>:<name>` / `ext:<id>:<name>`; Claude names
 * the server with colons turned into underscores (`mcp__plugin_id_name`).
 * Uses the same selection as the config body: in allowlist mode (an array) only
 * `alwaysOn` servers the list selected are pre-allowed, so the wildcards can
 * never name a server the config omits.
 */
export function alwaysOnPluginMcpAllowlist(extraServerNames?: string[]): string[] {
  const alwaysOn = new Set(allAlwaysOnServerNames());
  const keys = selectedServerEntries(extraServerNames).map(([key]) => key).filter((key) => alwaysOn.has(key));
  return keys.map((key) => `mcp__${key.replace(/:/g, '_')}`);
}

/** A plugin MCP server rendered for a CLI that takes servers as args or config. */
export interface SessionMcpServer {
  /** Registry key made safe as a bare config key (`plugin_<id>_<name>`). */
  name: string;
  type: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

/** Config-key-safe form of a registry key; colons and other punctuation become underscores. */
function sessionServerName(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Servers the session should carry beyond zcc-inbox, selected by the same rule
 * as the Claude `.mcp.json`. Used for Codex and OpenCode launches.
 */
export function sessionPluginMcpServers(extraServerNames?: string[]): SessionMcpServer[] {
  return selectedServerEntries(extraServerNames).map(([key, def]) => ({
    name: sessionServerName(key),
    type: def.type,
    ...(def.command ? { command: def.command } : {}),
    ...(def.args ? { args: [...def.args] } : {}),
    ...(def.url ? { url: def.url } : {}),
    ...(def.env ? { env: { ...def.env } } : {})
  }));
}

/**
 * `.mcp.json` body. The `${ZCC_MCP_URL}` placeholder is intentional —
 * Claude's CLI does env-substitution at spawn against the env we inject
 * in `pty.ts` (`ZCC_MCP_URL=http://127.0.0.1:<port>/mcp/<projectId>`).
 * Additional servers can be merged in via `extraServerNames` (resolved
 * against the combined seed + extension registry); every currently
 * registered `alwaysOn` extension server is merged in unconditionally.
 */
function configBody(extraServerNames?: string[]): string {
  const servers: Record<string, unknown> = {
    'zcc-inbox': {
      type: 'streamable-http',
      url: '${ZCC_MCP_URL}'
    }
  };
  for (const [name, def] of selectedServerEntries(extraServerNames)) {
    servers[name] = def;
  }
  return JSON.stringify({ mcpServers: servers }, null, 2) + '\n';
}

/**
 * Write/overwrite the per-project `.mcp.json` atomically (tmp + rename).
 * Idempotent — if the file already exists with the same content, the
 * rename is still a no-op from the filesystem's POV. Safe to call on
 * every boot for every project.
 * @param extraServerNames Optional server names to merge from the registry.
 */
export async function ensureMcpConfigForProject(
  projectId: string,
  extraServerNames?: string[]
): Promise<string> {
  const target = mcpConfigPathForProject(projectId);
  await mkdir(mcpConfigDir(), { recursive: true });
  // Unique per call (not just per pid+ms) so two concurrent writes for the same
  // project can't collide on the same tmp path before their renames land —
  // mirrors the sync twin below.
  const tmp = `${target}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tmp, configBody(extraServerNames), 'utf-8');
  await rename(tmp, target);
  return target;
}

/**
 * Synchronous twin of `ensureMcpConfigForProject`, called from `pty.create`
 * right before a claude spawn passes `--mcp-config <path>` to this file.
 *
 * The async writers (project-add fire-and-forget, boot backfill loop) run
 * *after* `setMcpBaseUrl`, so there's a window where the base URL is known but
 * the file isn't on disk yet — or a prior write silently failed. Launching
 * claude with `--mcp-config` pointing at a missing file means the zcc-inbox
 * server never loads. Writing it synchronously at the spawn site closes that
 * race for good: idempotent, cheap, and independent of boot ordering.
 *
 * Best-effort: a failure here must not block the terminal from opening, so the
 * caller treats a thrown error as "skip MCP injection for this spawn".
 * @param extraServerNames Optional server names to merge from the registry.
 */
export function ensureMcpConfigForProjectSync(
  projectId: string,
  extraServerNames?: string[]
): string {
  const target = mcpConfigPathForProject(projectId);
  mkdirSync(mcpConfigDir(), { recursive: true });
  // Unique per call (not just per pid) so two concurrent spawns for the same
  // project can't race on the same tmp path before their renames land.
  const tmp = `${target}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, configBody(extraServerNames), 'utf-8');
  renameSync(tmp, target);
  return target;
}

const SESSION_FILE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Path of the per-session allowlist-mode `.mcp.json`; ids are validated (never path-joined raw). */
export function sessionMcpConfigPath(projectId: string, sessionId: string): string {
  if (!SESSION_FILE_ID_RE.test(projectId) || !SESSION_FILE_ID_RE.test(sessionId)) {
    throw new Error('invalid projectId or sessionId for MCP session config');
  }
  return join(mcpConfigDir(), 'sessions', `${projectId}.${sessionId}.json`);
}

/**
 * Allowlist-mode writer: a private (0600) per-session `.mcp.json` so two
 * sessions of one project with different allowlists never overwrite each
 * other. Atomic (tmp + uniquely-suffixed rename). Used only when a persona
 * carries an `mcpServers` list; unset personas keep the shared per-project file.
 */
export function ensureSessionMcpConfigSync(projectId: string, sessionId: string, allowlist: string[]): string {
  const target = sessionMcpConfigPath(projectId, sessionId);
  mkdirSync(join(mcpConfigDir(), 'sessions'), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(tmp, configBody(allowlist), { encoding: 'utf-8', mode: 0o600 });
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return target;
}

/** Remove a session's config on its shutdown path. Best-effort; never throws. */
export function removeSessionMcpConfig(projectId: string, sessionId: string): void {
  try {
    rmSync(sessionMcpConfigPath(projectId, sessionId), { force: true });
  } catch {
    /* already gone or invalid ids */
  }
}
