import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { shell } from 'electron';
import type { SkillEntry } from '@zana-ai/zcc-domain/product';
import type { DiscoveredUnit, SkillProvider } from '../skill-providers/skill-provider.js';
import { SKILL_PROVIDERS, entryId } from '../skill-providers/registry.js';

const CLAUDE_DIR = join(homedir(), '.claude');
const SETTINGS_FILE = join(CLAUDE_DIR, 'settings.json');

async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  const tmp = `${SETTINGS_FILE}.tmp.${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(settings, null, 2), 'utf-8');
  await rename(tmp, SETTINGS_FILE);
}

/**
 * Read settings AND fold any legacy `disabledSkills: string[]` into
 * `skillOverrides: { name: 'off' }`, then drop the legacy key. Idempotent —
 * after the first call on a settings file, the legacy key is gone and the
 * fold is a no-op. This is necessary because Claude Code only honors
 * `skillOverrides` (https://code.claude.com/docs/en/settings.md), so any
 * older `disabledSkills` entries we wrote previously had no real effect.
 *
 * NOTE: `skillOverrides` is a CLAUDE-specific mechanism — it lives in
 * `~/.claude/settings.json` and is keyed by short skill name. It stays owned
 * here (the Claude toggle path); other tools' toggle state lives in their own
 * files and never touches this settings file.
 */
async function readSettingsWithMigration(): Promise<Record<string, unknown>> {
  const settings = await readSettings();
  const legacy = settings.disabledSkills;
  if (Array.isArray(legacy) && legacy.length > 0) {
    const overrides = (settings.skillOverrides as Record<string, string> | undefined) ?? {};
    let migrated = 0;
    for (const name of legacy) {
      if (typeof name !== 'string') continue;
      if (overrides[name] !== 'off') {
        overrides[name] = 'off';
        migrated += 1;
      }
    }
    settings.skillOverrides = overrides;
    delete settings.disabledSkills;
    await writeSettings(settings);
    if (migrated > 0) {
      // eslint-disable-next-line no-console
      console.log(`[main] migrated ${migrated} entries from disabledSkills to skillOverrides`);
    }
  } else if (legacy !== undefined) {
    // Legacy key present but empty — drop it without bothering to log.
    delete settings.disabledSkills;
    await writeSettings(settings);
  }
  return settings;
}

function disabledNamesFromOverrides(settings: Record<string, unknown>): Set<string> {
  const overrides = settings.skillOverrides;
  if (!overrides || typeof overrides !== 'object') return new Set();
  const out = new Set<string>();
  for (const [name, value] of Object.entries(overrides as Record<string, unknown>)) {
    if (value === 'off') out.add(name);
  }
  return out;
}

function unitToEntry(
  provider: SkillProvider,
  unit: DiscoveredUnit,
  disabledShortNames: ReadonlySet<string>,
  projectId?: string
): SkillEntry {
  const toggle = provider.toggleState(unit, disabledShortNames);
  return {
    id: entryId(provider.id, unit.source, unit.qualifiedName),
    name: unit.shortName,
    tool: provider.id,
    toolLabel: provider.label,
    source: unit.source,
    pluginName: unit.pluginName,
    projectId: unit.source === 'project' ? projectId : undefined,
    path: unit.path,
    description: unit.parsed.description,
    allowedTools: unit.parsed.allowedTools,
    toggle,
    enabled: toggle.enabled
  };
}

export interface ListSkillsOptions {
  projectPath?: string;
  projectId?: string;
}

/**
 * Discover all skills across every registered tool provider (Claude Code,
 * Cursor, …). User + plugin scopes are global; the project scope is only
 * walked when a project path is supplied. Core never names a concrete tool —
 * it iterates {@link SKILL_PROVIDERS}.
 */
export async function listSkills(options: ListSkillsOptions = {}): Promise<SkillEntry[]> {
  const settings = await readSettingsWithMigration();
  const disabled = disabledNamesFromOverrides(settings);
  const out: SkillEntry[] = [];

  const sources: Array<'user' | 'plugin' | 'project'> = ['user', 'plugin'];
  if (options.projectPath && options.projectId) sources.push('project');

  for (const provider of SKILL_PROVIDERS) {
    for (const source of sources) {
      const units = await provider.discover(source, { projectPath: options.projectPath });
      for (const unit of units) {
        out.push(unitToEntry(provider, unit, disabled, options.projectId));
      }
    }
  }
  return out;
}

/**
 * Set a single skill's enabled state. Only the Claude `settings-overrides`
 * mechanism is writable today: we write the explicit `'on'` value when enabling
 * (rather than deleting the key) so the user's intent is durable. The `name`
 * arg is a short skill name (skillOverrides is name-keyed). Skills belonging to
 * read-only tools are set through this path only via bundle apply, which
 * already filters them out.
 */
export async function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  const settings = await readSettingsWithMigration();
  const overrides = (settings.skillOverrides as Record<string, string> | undefined) ?? {};
  overrides[name] = enabled ? 'on' : 'off';
  settings.skillOverrides = overrides;
  await writeSettings(settings);
}

export async function setManyEnabled(
  updates: Array<{ name: string; enabled: boolean }>
): Promise<void> {
  if (updates.length === 0) return;
  const settings = await readSettingsWithMigration();
  const overrides = (settings.skillOverrides as Record<string, string> | undefined) ?? {};
  for (const { name, enabled } of updates) {
    overrides[name] = enabled ? 'on' : 'off';
  }
  settings.skillOverrides = overrides;
  await writeSettings(settings);
}

export async function readHooks(): Promise<unknown> {
  const settings = await readSettings();
  return settings.hooks ?? null;
}

export async function revealSkillDir(
  skillId: string,
  options: ListSkillsOptions = {}
): Promise<{ ok: boolean; path: string; message?: string }> {
  const all = await listSkills(options);
  const found = all.find((s) => s.id === skillId);
  if (!found) {
    return { ok: false, path: '', message: `Skill not found: ${skillId}` };
  }
  try {
    await shell.openPath(found.path);
    return { ok: true, path: found.path };
  } catch (err) {
    return {
      ok: false,
      path: found.path,
      message: err instanceof Error ? err.message : String(err)
    };
  }
}
