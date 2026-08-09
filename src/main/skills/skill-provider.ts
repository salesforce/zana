/**
 * Skill-provider descriptors — the per-agent-tool knowledge of WHERE skills
 * live on disk, HOW their manifests parse, and WHETHER (and how) they toggle.
 *
 * This mirrors the harness `LaunchProvider` split (`src/main/harness/
 * launch-provider.ts` + `registry.ts`, the `MAIN_MODULES` analogue): concrete
 * tool ids (`'claude-code'`, `'cursor'`) live ONLY in this file + the registry
 * (`registry.ts`). The generic orchestrator (`../skills.ts`) never names a
 * tool — it iterates `SKILL_PROVIDERS` and branches on the descriptor's
 * `layout.kind` / `toggle.kind`, so adding Windsurf/Codex/Gemini is one new
 * provider object + one registry entry, zero edits to core discovery.
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
import type { SkillSource, SkillTool, SkillToggleState } from '../../shared/types.js';

/** Parsed manifest fields, tool-agnostic. */
export interface ParsedSkill {
  name?: string;
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

const CLAUDE_DIR = join(homedir(), '.claude');
const USER_SKILLS_DIR = join(CLAUDE_DIR, 'skills');
const PLUGINS_DIR = join(CLAUDE_DIR, 'plugins');

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

// ---------------------------------------------------------------------------
// Claude Code provider — the historical behaviour, now behind the descriptor.
// ---------------------------------------------------------------------------

async function discoverClaudeUser(): Promise<DiscoveredUnit[]> {
  const out: DiscoveredUnit[] = [];
  for (const n of await listDirs(USER_SKILLS_DIR)) {
    const dir = join(USER_SKILLS_DIR, n);
    const parsed = await readManifest(join(dir, 'SKILL.md'));
    out.push({
      path: dir,
      shortName: parsed.name?.trim() || n,
      qualifiedName: n,
      parsed,
      source: 'user'
    });
  }
  return out;
}

/**
 * Walk `~/.claude/plugins/` and discover plugin skills. Plugin layout in the
 * wild varies, so we probe a couple of patterns:
 *  - `~/.claude/plugins/<plugin>/skills/<skill>/SKILL.md`
 *  - `~/.claude/plugins/marketplaces/<mp>/plugins/<plugin>/skills/<skill>/SKILL.md`
 *  - `~/.claude/plugins/marketplaces/<mp>/plugins/<plugin>/skills/SKILL.md` (single-skill)
 */
async function discoverClaudePlugins(): Promise<DiscoveredUnit[]> {
  if (!existsSync(PLUGINS_DIR)) return [];
  const out: DiscoveredUnit[] = [];
  const seen = new Set<string>();

  const visit = async (pluginDir: string, pluginName: string) => {
    const skillsDir = join(pluginDir, 'skills');
    if (!existsSync(skillsDir)) return;
    let isSingleSkill = false;
    try {
      isSingleSkill = (await stat(join(skillsDir, 'SKILL.md'))).isFile();
    } catch {
      /* not a single-skill layout */
    }
    if (isSingleSkill) {
      const qualifiedName = pluginName;
      if (seen.has(qualifiedName)) return;
      seen.add(qualifiedName);
      const parsed = await readManifest(join(skillsDir, 'SKILL.md'));
      out.push({
        path: skillsDir,
        shortName: parsed.name?.trim() || pluginName,
        qualifiedName,
        parsed,
        source: 'plugin',
        pluginName
      });
      return;
    }
    for (const skillName of await listDirs(skillsDir)) {
      const qualifiedName = `${pluginName}/${skillName}`;
      if (seen.has(qualifiedName)) continue;
      seen.add(qualifiedName);
      const dir = join(skillsDir, skillName);
      const parsed = await readManifest(join(dir, 'SKILL.md'));
      out.push({
        path: dir,
        shortName: parsed.name?.trim() || skillName,
        qualifiedName,
        parsed,
        source: 'plugin',
        pluginName
      });
    }
  };

  for (const name of await listDirs(PLUGINS_DIR)) {
    if (name === 'marketplaces' || name === 'cache' || name === 'data') continue;
    await visit(join(PLUGINS_DIR, name), name);
  }

  const marketplacesDir = join(PLUGINS_DIR, 'marketplaces');
  if (existsSync(marketplacesDir)) {
    for (const mp of await listDirs(marketplacesDir)) {
      const pluginsDir = join(marketplacesDir, mp, 'plugins');
      if (!existsSync(pluginsDir)) continue;
      for (const p of await listDirs(pluginsDir)) {
        await visit(join(pluginsDir, p), p);
      }
    }
  }
  return out;
}

async function discoverClaudeProject(projectPath: string): Promise<DiscoveredUnit[]> {
  const dir = join(projectPath, '.claude', 'skills');
  const out: DiscoveredUnit[] = [];
  for (const n of await listDirs(dir)) {
    const skillDir = join(dir, n);
    const parsed = await readManifest(join(skillDir, 'SKILL.md'));
    out.push({
      path: skillDir,
      shortName: parsed.name?.trim() || n,
      qualifiedName: n,
      parsed,
      source: 'project'
    });
  }
  return out;
}

export const claudeCodeSkillProvider: SkillProvider = {
  id: 'claude-code',
  label: 'Claude Code',
  icon: 'Sparkles',
  toggle: { kind: 'settings-overrides' },
  async discover(source, ctx) {
    if (source === 'user') return discoverClaudeUser();
    if (source === 'plugin') return discoverClaudePlugins();
    if (source === 'project' && ctx.projectPath) return discoverClaudeProject(ctx.projectPath);
    return [];
  },
  toggleState(unit, disabledShortNames) {
    // Plugin skills are managed via Claude Code's `/plugin` command and can't
    // be disabled from settings.json — render them read-only.
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
    out.push({ path, shortName, qualifiedName: shortName, parsed, source: 'project' });
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
