import type { SlashCommand } from '@zana-ai/zcc-domain/product';
import { claudeCodeSkillProvider } from '../skill-providers/skill-provider.js';
import { disabledSkillNames } from './skill-settings.js';

export interface ListCommandsOptions {
  projectPath?: string;
  projectId?: string;
}

/** Compatibility command palette shares native skill + legacy command discovery. */
export async function listCommands(options: ListCommandsOptions = {}): Promise<SlashCommand[]> {
  const disabled = await disabledSkillNames();
  const out: SlashCommand[] = [];
  // A skill beats a same-named legacy command; project beats user.
  for (const source of ['project', 'plugin', 'user'] as const) {
    if (source === 'project' && (!options.projectPath || !options.projectId)) continue;
    const units = await claudeCodeSkillProvider.discover(source, {
      projectPath: options.projectPath
    });
    units.sort((a, b) => Number(a.kind === 'command') - Number(b.kind === 'command'));
    for (const unit of units) {
      if (
        unit.parsed.userInvocable === false ||
        (unit.kind !== 'command' && disabled.has(unit.shortName))
      )
        continue;
      const name = `${unit.pluginName ? `${unit.pluginName}:` : ''}${unit.shortName}`;
      out.push({
        id: `${source}:${name}`,
        name,
        invocation: `/${name}`,
        scope: source,
        pluginName: unit.pluginName,
        ...(source === 'project' ? { projectId: options.projectId } : {}),
        path: unit.path,
        description: unit.parsed.description,
        argumentHint: unit.parsed.argumentHint
      });
    }
  }
  const seen = new Set<string>();
  return out.filter((row) => {
    if (seen.has(row.name)) return false;
    seen.add(row.name);
    return true;
  });
}
