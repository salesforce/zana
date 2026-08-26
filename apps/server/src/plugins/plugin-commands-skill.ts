import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PLUGIN_CLI_OUTPUT_MAX_BYTES, type PluginCliCommandInfo } from '@zana-ai/zcc-plugin-sdk/server';

export interface PluginCliContribution {
  pluginId: string;
  name: string;
  summary: string;
  commands: PluginCliCommandInfo[];
}

const SKILL_NAME = 'plugin-commands';

export function generatedSkillsRootPath(dataDir: string): string {
  return join(dataDir, 'skills-generated');
}

export function pluginCommandsSkillDir(dataDir: string): string {
  return join(generatedSkillsRootPath(dataDir), SKILL_NAME);
}

export function renderPluginCommandsSkill(
  contributions: readonly PluginCliContribution[]
): string {
  const sections = contributions.map((contribution) => {
    const lines = [
      `## zcc ${contribution.name} — ${contribution.summary}`,
      '',
      `Contributed by plugin \`${contribution.pluginId}\`. Run \`zcc ${contribution.name} --help\` for details;`,
      `\`zcc plugin run ${contribution.pluginId} <args...>\` is the explicit equivalent.`
    ];
    if (contribution.commands.length > 0) {
      lines.push('');
      for (const command of contribution.commands) {
        lines.push(`- \`${command.usage}\` — ${command.summary}`);
      }
    }
    return lines.join('\n');
  });
  return [
    '---',
    `name: ${SKILL_NAME}`,
    'description: CLI commands contributed by installed ZCC plugins. Use when a task involves one of the plugin commands listed here; run them with bash like any other zcc command.',
    '---',
    '',
    '# Plugin Commands',
    '',
    'Installed ZCC plugins contribute these `zcc` subcommands. Invoke them with',
    'bash exactly like core `zcc` commands; they run server-side.',
    `Combined stdout and stderr is capped at ${PLUGIN_CLI_OUTPUT_MAX_BYTES} UTF-8 bytes. Above-limit`,
    'results fail atomically as `plugin_cli_output_too_large` and are never clipped;',
    'use pagination or file/streaming commands for large results.',
    '',
    ...sections,
    ''
  ].join('\n');
}

export async function syncPluginCommandsSkill(
  dataDir: string,
  contributions: readonly PluginCliContribution[]
): Promise<void> {
  const dir = pluginCommandsSkillDir(dataDir);
  if (contributions.length === 0) {
    await rm(dir, { recursive: true, force: true });
    return;
  }
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), renderPluginCommandsSkill(contributions), 'utf8');
}
