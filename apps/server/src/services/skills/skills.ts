import { disabledSkillNames } from './skill-settings.js';
export { disabledSkillNames, setSkillEnabled, setManyEnabled, readHooks } from './skill-settings.js';
import { shell } from 'electron';
import type { SkillEntry } from '@zana-ai/zcc-domain/product';
import type { DiscoveredUnit, SkillProvider } from '../skill-providers/skill-provider.js';
import { SKILL_PROVIDERS, entryId } from '../skill-providers/registry.js';

function unitToEntry(
  provider: SkillProvider,
  unit: DiscoveredUnit,
  disabledShortNames: ReadonlySet<string>,
  projectId?: string
): SkillEntry {
  const toggle = provider.toggleState(unit, disabledShortNames);
  return {
    id: unit.kind === 'command' ? `command:${provider.id}:${unit.source}:${unit.qualifiedName}` : entryId(provider.id, unit.source, unit.qualifiedName),
    kind: unit.kind, linked: unit.linked, userInvocable: unit.parsed.userInvocable, disableModelInvocation: unit.parsed.disableModelInvocation,
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
  const disabled = await disabledSkillNames();
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
