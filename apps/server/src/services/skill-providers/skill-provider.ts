import { experimental_resolveClaudePluginRoots, experimental_nativeRootsHostContract } from '@zana-ai/zcc-plugin-sdk/host';
import { resolveDeclaredScanRoots } from '@zana-ai/zcc-host-daemon/native-root-scan';
import { discoverProviderCommands } from '@zana-ai/zcc-host-daemon/command-discovery';
import { normalizeProviderNativeRoots } from '@zana-ai/zcc-domain/thread-runtime';
import { dirname } from 'node:path';
/**
 * Skill-provider descriptors — the per-agent-tool knowledge of WHERE skills
 * live on disk, HOW their manifests parse, and WHETHER (and how) they toggle.
 *
 * This mirrors the harness `LaunchProvider` split (`src/main/harness/
 * launch-provider.ts` + `registry.ts`, the `MAIN_MODULES` analogue): concrete
 * tool ids (`'claude-code'`, `'cursor'`, `'opencode'`) live ONLY in this file +
 * the registry (`registry.ts`). The generic orchestrator (`../skills.ts`) never
 * names a tool — it iterates `SKILL_PROVIDERS` and branches on the descriptor's
 * `layout.kind` / `toggle.kind`, so adding a tool is one new provider object +
 * one registry entry, zero edits to core discovery.
 *
 * Skill discovery is deliberately a SEPARATE registry from the harness
 * `LaunchProvider` (which owns spawn identity only): the two provider sets are
 * not 1:1 (a `shell` launch has no skills). They share the id STRING SPACE
 * (`'claude-code'`) so the association is free without coupling the two seams.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SkillSource, SkillTool, SkillToggleState } from '@zana-ai/zcc-domain/product';

/** Parsed manifest fields, tool-agnostic. */
export interface ParsedSkill {
  name?: string;
  argumentHint?: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  description?: string;
  allowedTools?: string[];
  /**
   * The tool's own notion of "enabled" as read from the manifest, when it has
   * one (Cursor's `alwaysApply`). Claude's enable state lives in
   * `settings.json` (not the manifest), so it leaves this undefined and the
   * provider computes toggle state from the overrides set instead.
   */
  enabledInManifest?: boolean;
}

/** A single discovered skill unit, before it becomes a `SkillEntry`. */
export interface DiscoveredUnit {
  /** Directory (dir layout) or file (file layout) holding the skill. */
  path: string;
  kind?: 'skill' | 'command' | 'rule';
  linked?: boolean;
  /** Short name — the manifest `name`, else the dir/file basename. */
  shortName: string;
  /** Qualified name used in the entry id (e.g. `zana/team-status`). */
  qualifiedName: string;
  parsed: ParsedSkill;
  source: SkillSource;
  /** Plugin slug (only when source === 'plugin'). */
  pluginName?: string;
}

/**
 * How enable/disable works for a tool. A descriptor, never a bare boolean, so
 * `../skills.ts` can compute `SkillToggleState` without knowing the concrete
 * tool.
 *  - `settings-overrides`: Claude — `skillOverrides` in `~/.claude/settings.json`,
 *     keyed by short name. Plugin-scope skills are always read-only.
 *  - `read-only`: no toggle (Cursor rules today, AGENTS.md/GEMINI.md, etc.).
 */
export type ToggleCapability =
  | { kind: 'settings-overrides' }
  | { kind: 'read-only'; reason: string };

/**
 * Context handed to a provider's discovery for one (scope, root) pair. The
 * generic orchestrator supplies the roots; the provider walks them.
 */
export interface DiscoveryContext {
  /** Absolute project root (only for `source === 'project'`). */
  projectPath?: string;
}

export interface SkillProvider {
  /** Concrete tool id — appears ONLY here + in the registry (Rule 6). */
  readonly id: SkillTool;
  /** Human label, e.g. "Claude Code", "Cursor". */
  readonly label: string;
  /** Lucide icon NAME (string). The renderer maps it to a component. */
  readonly icon: string;
  readonly toggle: ToggleCapability;
  /**
   * Discover this provider's skill units for a given scope. Returns [] when the
   * scope isn't served (e.g. Cursor has no user/plugin scope today). Never
   * throws — a missing dir / unreadable file degrades to fewer entries.
   */
  discover(source: SkillSource, ctx: DiscoveryContext): Promise<DiscoveredUnit[]>;
  /**
   * Compute the toggle state for a discovered unit. `disabledShortNames` is the
   * settings-derived disabled set (only meaningful for `settings-overrides`).
   */
  toggleState(unit: DiscoveredUnit, disabledShortNames: ReadonlySet<string>): SkillToggleState;
}

// ---------------------------------------------------------------------------
// Shared parsing helpers (tool-agnostic frontmatter reader).
// ---------------------------------------------------------------------------

function unquote(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * Tiny YAML-frontmatter parser. Handles the subset SKILL.md / `.mdc` use —
 * `key: value` lines, `key: [a, b]` inline arrays, and `- item` list entries.
 * No new npm deps; full YAML isn't worth a dependency for a few keys.
 */
function parseFrontmatter(raw: string): ParsedSkill {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const block = match[1];
  const lines = block.split(/\r?\n/);
  const out: ParsedSkill = {};
  let currentListKey: 'allowedTools' | 'globs' | null = null;
  for (const line of lines) {
    if (line.trim() === '') {
      currentListKey = null;
      continue;
    }
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && currentListKey) {
      const v = unquote(listItem[1].trim());
      if (v && currentListKey === 'allowedTools') {
        (out.allowedTools = out.allowedTools ?? []).push(v);
      }
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) {
      currentListKey = null;
      continue;
    }
    const key = kv[1].trim();
    const value = kv[2].trim();
    if (key === 'name') out.name = unquote(value);
    else if (key === 'description') out.description = unquote(value);
    else if (key === 'alwaysApply') out.enabledInManifest = value === 'true';
    else if (key === 'allowed-tools' || key === 'allowedTools') {
      if (value === '') {
        currentListKey = 'allowedTools';
      } else if (value.startsWith('[') && value.endsWith(']')) {
        out.allowedTools = value
          .slice(1, -1)
          .split(',')
          .map((s) => unquote(s.trim()))
          .filter(Boolean);
        currentListKey = null;
      } else {
        out.allowedTools = [unquote(value)];
        currentListKey = null;
      }
    } else {
      currentListKey = null;
    }
  }
  return out;
}

async function readManifest(path: string): Promise<ParsedSkill> {
  try {
    return parseFrontmatter(await readFile(path, 'utf-8'));
  } catch {
    return {};
  }
}

async function listDirs(parent: string): Promise<string[]> {
  if (!existsSync(parent)) return [];
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listFiles(parent: string, exts: string[]): Promise<string[]> {
  if (!existsSync(parent)) return [];
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && exts.some((ext) => e.name.endsWith(ext)))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Walk `<parent>/<name>/SKILL.md` trees (Claude + OpenCode layout). */
async function discoverSkillMdDirectories(
  parent: string,
  source: SkillSource
): Promise<DiscoveredUnit[]> {
  const out: DiscoveredUnit[] = [];
  for (const n of await listDirs(parent)) {
    const dir = join(parent, n);
    const parsed = await readManifest(join(dir, 'SKILL.md'));
    out.push({
      path: dir,
      shortName: parsed.name?.trim() || n,
      qualifiedName: n,
      parsed,
      source
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Claude Code provider — the historical behaviour, now behind the descriptor.
// ---------------------------------------------------------------------------

/** Compatibility IPC and bundle paths use the same resolver/scanner as host listings. */
async function discoverClaude(source: SkillSource, ctx: DiscoveryContext): Promise<DiscoveredUnit[]> {
  const homeDir = process.env.ZCC_CLAUDE_HOME || homedir();
  const env = process.env;
  const cwd = ctx.projectPath ?? null;
  const plugins = await experimental_resolveClaudePluginRoots({ homeDir, cwd, env });
  const resolved = experimental_nativeRootsHostContract.resolveNativeRoots.output.parse({
    skills: [{ path: join(plugins.claudeDir, 'skills'), origin: 'user', shape: 'skills', skipIfManifest: '.claude-plugin/plugin.json' }, ...plugins.skills],
    commands: [{ path: join(plugins.claudeDir, 'commands'), origin: 'user', shape: 'commands' }, ...plugins.commands]
  });
  const roots = await resolveDeclaredScanRoots({ cwd, homeDir, providerId: 'claude-code', nativeRoots: {
    skills: normalizeProviderNativeRoots({ project: [{ path: '.claude/skills', ancestors: true, skipIfManifest: '.claude-plugin/plugin.json' }] }),
    commands: normalizeProviderNativeRoots({ project: ['.claude/commands'] }), resolved
  } });
  const out: DiscoveredUnit[] = [];
  for (const row of await discoverProviderCommands({ roots })) {
    if (!row.filePath) continue;
    const pluginName = row.namePrefix ? row.namePrefix.slice(0, -1) : undefined;
    const scope = pluginName ? 'plugin' : row.origin;
    if (scope !== source) continue;
    const shortName = pluginName ? row.name.slice(row.namePrefix!.length) : row.name;
    const qualifiedName = `${pluginName ? `${pluginName}/` : ''}${row.qualifiedName ?? shortName}`;
    out.push({ path: row.source === 'skill' ? dirname(row.filePath) : row.filePath, shortName, qualifiedName, source, pluginName, kind: row.source, linked: row.linked, parsed: { name: shortName, description: row.description ?? undefined, argumentHint: row.argumentHint ?? undefined, allowedTools: row.allowedTools, userInvocable: row.userInvocable, disableModelInvocation: row.disableModelInvocation } });
  }
  const seen = new Set<string>();
  return out.filter(unit => { const key = `${unit.kind}:${unit.qualifiedName}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export const claudeCodeSkillProvider: SkillProvider = {
  id: 'claude-code',
  label: 'Claude Code',
  icon: 'Sparkles',
  toggle: { kind: 'settings-overrides' },
  async discover(source, ctx) {
    if (source === 'project' && !ctx.projectPath) return [];
    return discoverClaude(source, ctx);
  },
  toggleState(unit, disabledShortNames) {
    // Plugin skills are managed via Claude Code's `/plugin` command and can't
    // be disabled from settings.json — render them read-only.
    if (unit.kind === 'command') return { supported: false, enabled: true, reason: 'Managed in the command file' };
    if (unit.source === 'plugin') {
      return {
        supported: false,
        enabled: true,
        reason: 'Managed by /plugin'
      };
    }
    // skillOverrides is keyed by short skill name (per Claude Code docs).
    const enabled = !disabledShortNames.has(unit.shortName);
    return { supported: true, enabled };
  }
};

// ---------------------------------------------------------------------------
// Cursor provider — project-scoped rules under `.cursor/rules/*.mdc`.
// ---------------------------------------------------------------------------

async function discoverCursorProject(projectPath: string): Promise<DiscoveredUnit[]> {
  const dir = join(projectPath, '.cursor', 'rules');
  const out: DiscoveredUnit[] = [];
  for (const file of await listFiles(dir, ['.mdc'])) {
    const path = join(dir, file);
    const parsed = await readManifest(path);
    const shortName = parsed.name?.trim() || file.replace(/\.mdc$/, '');
    out.push({ path, kind: 'rule', shortName, qualifiedName: shortName, parsed, source: 'project' });
  }
  return out;
}

export const cursorSkillProvider: SkillProvider = {
  id: 'cursor',
  label: 'Cursor',
  icon: 'MousePointer2',
  // Cursor rules toggle via the `.mdc` frontmatter `alwaysApply` field, not a
  // central settings file. Writing that back is a future phase; for now the
  // rows are read-only (visibility-only), the same treatment as plugin skills.
  toggle: { kind: 'read-only', reason: 'Managed in the .mdc rule file' },
  async discover(source, ctx) {
    // Cursor only has a project-scope concept today (`.cursor/rules`).
    if (source === 'project' && ctx.projectPath) return discoverCursorProject(ctx.projectPath);
    return [];
  },
  toggleState(unit) {
    // `alwaysApply: true` ⇒ always on; otherwise the rule is conditionally
    // applied (by glob) — still surfaced, shown as effectively enabled.
    const enabled = unit.parsed.enabledInManifest !== false;
    return { supported: false, enabled, reason: 'Managed in the .mdc rule file' };
  }
};

// ---------------------------------------------------------------------------
// OpenCode provider — user skills under `~/.config/opencode/skills` (honors
// `XDG_CONFIG_HOME`) and project skills under `.opencode/skills`. Same
// `<name>/SKILL.md` layout as Claude. No plugin scope and no central toggle
// file today, so rows are read-only (visibility-only).
// ---------------------------------------------------------------------------

function openCodeUserSkillsDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const configHome = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(configHome, 'opencode', 'skills');
}

export const openCodeSkillProvider: SkillProvider = {
  id: 'opencode',
  label: 'OpenCode',
  icon: 'Terminal',
  toggle: { kind: 'read-only', reason: 'Managed in the OpenCode skill folder' },
  async discover(source, ctx) {
    if (source === 'user') return discoverSkillMdDirectories(openCodeUserSkillsDir(), 'user');
    if (source === 'project' && ctx.projectPath) {
      return discoverSkillMdDirectories(join(ctx.projectPath, '.opencode', 'skills'), 'project');
    }
    return [];
  },
  toggleState() {
    return { supported: false, enabled: true, reason: 'Managed in the OpenCode skill folder' };
  }
};
