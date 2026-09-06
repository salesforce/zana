import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { AgentRuntimeSkillRoot } from '@zana-ai/zcc-agent-runtime';

export const CURSOR_NATIVE_SKILL_ROOTS = {
  user: ['.cursor/skills', '.agents/skills', '.claude/skills', '.codex/skills'],
  project: ['.cursor/skills', '.agents/skills', '.claude/skills', '.codex/skills']
} as const;

export const OPENCODE_NATIVE_SKILL_ROOTS = {
  user: ['.claude/skills', '.agents/skills'],
  project: ['.opencode/skills', '.claude/skills', '.agents/skills']
} as const;

export const PI_NATIVE_SKILL_ROOTS = {
  user: ['.pi/agent/skills', '.agents/skills'],
  project: ['.pi/skills', '.agents/skills']
} as const;

export interface NativeSkillDiscoveryArgs {
  homeDir?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

function resolveHomePath(homeDir: string, value: string): string {
  if (value === '~') return homeDir;
  if (value.startsWith('~/')) return join(homeDir, value.slice(2));
  return value;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function skillPathsFromManifest(pluginRoot: string, manifest: Record<string, unknown>): string[] {
  const raw = manifest.skills;
  const listed = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  if (listed.length > 0) {
    return listed.map((entry) => {
      const resolved = resolve(pluginRoot, entry);
      return resolved.endsWith('SKILL.md') ? dirname(resolved) : resolved;
    });
  }
  return [join(pluginRoot, 'skills')];
}

function readCursorPluginManifest(pluginRoot: string): Record<string, unknown> | null {
  for (const relative of [join('.cursor-plugin', 'plugin.json'), 'plugin.json']) {
    const parsed = readJsonObject(join(pluginRoot, relative));
    if (parsed && typeof parsed.name === 'string' && parsed.name.length > 0) {
      return parsed;
    }
  }
  return null;
}

function listDirectories(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => join(path, entry.name));
  } catch {
    return [];
  }
}

export function resolveCursorVendorSkillRoots(homeDir: string): string[] {
  const roots: string[] = [];
  const localPlugins = join(homeDir, '.cursor', 'plugins', 'local');
  for (const pluginRoot of listDirectories(localPlugins)) {
    const manifest = readCursorPluginManifest(pluginRoot);
    if (!manifest) continue;
    roots.push(...skillPathsFromManifest(pluginRoot, manifest));
  }

  const cachePath = join(homeDir, '.cursor', 'plugins', 'cache');
  for (const marketplace of listDirectories(cachePath)) {
    for (const plugin of listDirectories(marketplace)) {
      let latest: { path: string; completedAtMs: number } | undefined;
      for (const version of listDirectories(plugin)) {
        try {
          const completion = lstatSync(join(version, '.cache-complete'));
          if (!completion.isFile()) continue;
          if (!latest || completion.mtimeMs > latest.completedAtMs) {
            latest = { path: version, completedAtMs: completion.mtimeMs };
          }
        } catch {
          /* incomplete cache entries are skipped */
        }
      }
      if (!latest) continue;
      const manifest = readCursorPluginManifest(latest.path);
      if (!manifest) continue;
      roots.push(...skillPathsFromManifest(latest.path, manifest));
    }
  }

  const unique = new Set<string>();
  for (const root of roots) {
    unique.add(resolve(root));
  }
  return [...unique].filter(isDirectory);
}

export function resolveOpenCodeConfigDir(
  homeDir: string,
  env: Readonly<Record<string, string | undefined>>
): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return xdg
    ? join(resolveHomePath(homeDir, xdg), 'opencode')
    : join(homeDir, '.config', 'opencode');
}

export function resolveOpenCodeConfigSkillRoots(
  homeDir: string,
  env: Readonly<Record<string, string | undefined>>
): string[] {
  const roots = [join(resolveOpenCodeConfigDir(homeDir, env), 'skills')];
  const customDir = env.OPENCODE_CONFIG_DIR?.trim();
  if (customDir) {
    roots.push(join(resolveHomePath(homeDir, customDir), 'skills'));
  }
  return [...new Set(roots.map((root) => resolve(root)))].filter(isDirectory);
}

function isPlainSkillSource(value: string): boolean {
  return !/^(?:npm:|git:|https?:\/\/|git@)/u.test(value);
}

export function resolvePiAgentDir(
  homeDir: string,
  env: Readonly<Record<string, string | undefined>>
): string {
  const configured = env.PI_CODING_AGENT_DIR?.trim();
  return configured ? resolveHomePath(homeDir, configured) : join(homeDir, '.pi', 'agent');
}

export function resolvePiNativeSkillRoots(
  homeDir: string,
  env: Readonly<Record<string, string | undefined>>
): string[] {
  const agentDir = resolvePiAgentDir(homeDir, env);
  const roots = new Set<string>([
    join(homeDir, '.pi', 'agent', 'skills'),
    join(homeDir, '.agents', 'skills'),
    join(homeDir, '.pi', 'skills')
  ]);
  if (resolve(agentDir) !== resolve(join(homeDir, '.pi', 'agent'))) {
    roots.add(join(agentDir, 'skills'));
  }
  const settings = readJsonObject(join(agentDir, 'settings.json'));
  const listed = settings && Array.isArray(settings.skills) ? settings.skills : [];
  for (const raw of listed) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value.length === 0 || value.startsWith('!') || !isPlainSkillSource(value)) continue;
    if (value.toLowerCase().endsWith('.md')) continue;
    roots.add(resolve(value.startsWith('/') || value.startsWith('~') ? resolveHomePath(homeDir, value) : resolve(agentDir, value)));
  }
  return [...roots].filter(isDirectory);
}

export const CLAUDE_NATIVE_SKILL_ROOTS = {
  user: ['.claude/skills', '.claude/commands'],
  project: ['.claude/skills', '.claude/commands']
} as const;

export const CODEX_NATIVE_SKILL_ROOTS = {
  user: ['.codex/skills', '.agents/skills'],
  project: ['.codex/skills', '.agents/skills']
} as const;

export const OMP_NATIVE_SKILL_ROOTS = {
  user: ['.omp/skills', '.agents/skills'],
  project: ['.omp/skills', '.agents/skills']
} as const;

export const GROK_NATIVE_SKILL_ROOTS = {
  user: ['.grok/skills', '.agents/skills'],
  project: ['.grok/skills', '.agents/skills']
} as const;

export const HERMES_NATIVE_SKILL_ROOTS = {
  user: ['.hermes/skills', '.agents/skills'],
  project: ['.hermes/skills', '.agents/skills']
} as const;

function uniqueExistingDirs(paths: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const root of paths) unique.add(resolve(root));
  return [...unique].filter(isDirectory);
}

export function resolveClaudeConfigDir(
  homeDir: string,
  env: Readonly<Record<string, string | undefined>>
): string {
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  if (!configured) return join(homeDir, '.claude');
  return configured.startsWith('/') || configured.startsWith('~')
    ? resolveHomePath(homeDir, configured)
    : join(homeDir, configured);
}

export function resolveClaudeNativeSkillRoots(
  homeDir: string,
  env: Readonly<Record<string, string | undefined>>
): string[] {
  const claudeDir = resolveClaudeConfigDir(homeDir, env);
  const roots = [join(claudeDir, 'skills'), join(claudeDir, 'commands')];
  const registry = readJsonObject(join(claudeDir, 'plugins', 'installed_plugins.json'));
  const plugins = registry && registry.plugins && typeof registry.plugins === 'object' && !Array.isArray(registry.plugins)
    ? registry.plugins as Record<string, unknown>
    : {};
  for (const entries of Object.values(plugins)) {
    const listed = Array.isArray(entries) ? entries : [];
    for (const entry of listed) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const installPath = (entry as { installPath?: unknown }).installPath;
      if (typeof installPath !== 'string' || installPath.trim().length === 0) continue;
      const pluginRoot = resolveHomePath(homeDir, installPath);
      roots.push(...skillPathsFromManifest(pluginRoot, readJsonObject(join(pluginRoot, '.claude-plugin', 'plugin.json')) ?? {}));
    }
  }
  return uniqueExistingDirs(roots);
}

function decodeTomlBasicString(value: string): string {
  let decoded = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\' || index === value.length - 1) {
      decoded += character;
      continue;
    }
    index += 1;
    const escaped = value[index];
    if (escaped === 'n') decoded += '\n';
    else if (escaped === 'r') decoded += '\r';
    else if (escaped === 't') decoded += '\t';
    else decoded += escaped;
  }
  return decoded;
}

export function readCodexEnabledPluginSettingsFromToml(content: string): ReadonlyMap<string, boolean> {
  const enabledPlugins = new Map<string, boolean>();
  let currentPluginId: string | null = null;
  for (const line of content.split(/\r?\n/u)) {
    const sectionMatch = line.match(/^\s*\[plugins\.(?:"((?:\\.|[^"\\])*)"|([^\]\s]+))\]\s*(?:#.*)?$/u);
    if (sectionMatch) {
      currentPluginId = sectionMatch[1] !== undefined
        ? decodeTomlBasicString(sectionMatch[1])
        : (sectionMatch[2] ?? null);
      continue;
    }
    if (/^\s*\[/u.test(line)) {
      currentPluginId = null;
      continue;
    }
    if (currentPluginId === null) continue;
    const enabledMatch = line.match(/^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/u);
    if (enabledMatch) enabledPlugins.set(currentPluginId, enabledMatch[1] === 'true');
  }
  return enabledPlugins;
}

export function resolveCodexHome(
  homeDir: string,
  env: Readonly<Record<string, string | undefined>>
): string {
  const configured = env.CODEX_HOME?.trim();
  return configured ? resolveHomePath(homeDir, configured) : join(homeDir, '.codex');
}

export function resolveCodexNativeSkillRoots(
  homeDir: string,
  env: Readonly<Record<string, string | undefined>>
): string[] {
  const codexHome = resolveCodexHome(homeDir, env);
  const roots = [
    join(codexHome, 'skills'),
    join(codexHome, 'skills', '.system'),
    join(homeDir, '.agents', 'skills')
  ];
  let enabled = new Map<string, boolean>();
  try {
    enabled = new Map(readCodexEnabledPluginSettingsFromToml(readFileSync(join(codexHome, 'config.toml'), 'utf8')));
  } catch {
    enabled = new Map();
  }
  const cacheRoot = join(codexHome, 'plugins', 'cache');
  for (const marketplace of listDirectories(cacheRoot)) {
    for (const plugin of listDirectories(marketplace)) {
      const pluginId = `${plugin.slice(marketplace.length + 1)}@${marketplace.slice(cacheRoot.length + 1)}`;
      if (enabled.get(pluginId) === false) continue;
      let latest: { path: string; mtimeMs: number } | undefined;
      for (const version of listDirectories(plugin)) {
        const manifest = join(version, '.codex-plugin', 'plugin.json');
        try {
          const stat = lstatSync(manifest);
          if (!stat.isFile()) continue;
          if (!latest || stat.mtimeMs > latest.mtimeMs) latest = { path: version, mtimeMs: stat.mtimeMs };
        } catch {
          /* skip incomplete cache entries */
        }
      }
      if (!latest) continue;
      roots.push(...skillPathsFromManifest(latest.path, readJsonObject(join(latest.path, '.codex-plugin', 'plugin.json')) ?? {}));
    }
  }
  return uniqueExistingDirs(roots);
}

function homeSkillDirs(homeDir: string, relative: readonly string[]): string[] {
  return uniqueExistingDirs(relative.map((entry) => join(homeDir, entry)));
}

function acpRoot(id: string, path: string): AgentRuntimeSkillRoot {
  return {
    id,
    providerId: 'acp',
    skillDirectoryRootPath: path,
    skills: []
  };
}

function piRoot(id: string, path: string): AgentRuntimeSkillRoot {
  return {
    id,
    providerId: 'pi',
    skillDirectoryRootPath: path
  };
}

function claudeRoot(id: string, path: string): AgentRuntimeSkillRoot {
  return {
    id,
    providerId: 'claude-code',
    localPluginPath: path
  };
}

function codexRoot(id: string, path: string): AgentRuntimeSkillRoot {
  return {
    id,
    providerId: 'codex',
    skillDirectoryRootPath: path
  };
}

/** Extra vendor skill directories the host lists beside injected ZCC skills. */
export function discoverNativeSkillRoots(
  args: NativeSkillDiscoveryArgs = {}
): AgentRuntimeSkillRoot[] {
  const homeDir = args.homeDir ?? homedir();
  const env = args.env ?? process.env;
  const out: AgentRuntimeSkillRoot[] = [];
  for (const [index, root] of resolveCursorVendorSkillRoots(homeDir).entries()) {
    out.push(acpRoot(`native-cursor-${index}`, root));
  }
  for (const [index, root] of resolveOpenCodeConfigSkillRoots(homeDir, env).entries()) {
    out.push(acpRoot(`native-opencode-${index}`, root));
  }
  for (const [index, root] of homeSkillDirs(homeDir, OMP_NATIVE_SKILL_ROOTS.user).entries()) {
    out.push(acpRoot(`native-omp-${index}`, root));
  }
  for (const [index, root] of homeSkillDirs(homeDir, GROK_NATIVE_SKILL_ROOTS.user).entries()) {
    out.push(acpRoot(`native-grok-${index}`, root));
  }
  for (const [index, root] of homeSkillDirs(homeDir, HERMES_NATIVE_SKILL_ROOTS.user).entries()) {
    out.push(acpRoot(`native-hermes-${index}`, root));
  }
  for (const [index, root] of resolveClaudeNativeSkillRoots(homeDir, env).entries()) {
    out.push(claudeRoot(`native-claude-${index}`, root));
  }
  for (const [index, root] of resolveCodexNativeSkillRoots(homeDir, env).entries()) {
    out.push(codexRoot(`native-codex-${index}`, root));
  }
  for (const [index, root] of resolvePiNativeSkillRoots(homeDir, env).entries()) {
    out.push(piRoot(`native-pi-${index}`, root));
  }
  return out;
}
