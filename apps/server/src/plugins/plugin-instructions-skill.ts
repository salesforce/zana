import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generatedSkillsRootPath } from './plugin-commands-skill.js';

const SKILL_NAME = 'plugin-instructions';

export interface PluginInstructionContribution {
  pluginId: string;
  text: string;
}

export function pluginInstructionsSkillDir(dataDir: string): string {
  return join(generatedSkillsRootPath(dataDir), SKILL_NAME);
}

export function renderPluginInstructionsSkill(
  contributions: readonly PluginInstructionContribution[]
): string {
  const sections = contributions.map((contribution) =>
    [`## From plugin \`${contribution.pluginId}\``, '', contribution.text.trim()].join('\n')
  );
  return [
    '---',
    `name: ${SKILL_NAME}`,
    'description: Standing instructions contributed by installed ZCC plugins. Always follow these host-wide instructions when they apply to the current task.',
    '---',
    '',
    '# Plugin instructions',
    '',
    'Installed plugins contributed these standing instructions. Treat them as',
    'host-wide context for later threads on this ZCC host.',
    '',
    ...sections,
    ''
  ].join('\n');
}

export async function syncPluginInstructionsSkill(
  dataDir: string,
  contributions: readonly PluginInstructionContribution[]
): Promise<void> {
  const dir = pluginInstructionsSkillDir(dataDir);
  const nonempty = contributions.filter((row) => row.text.trim().length > 0);
  if (nonempty.length === 0) {
    await rm(dir, { recursive: true, force: true });
    return;
  }
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), renderPluginInstructionsSkill(nonempty), 'utf8');
}
