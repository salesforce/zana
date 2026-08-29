import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generatedSkillsRootPath,
  renderPluginCommandsSkill,
  syncPluginCommandsSkill
} from './plugin-commands-skill.js';

describe('plugin-commands skill', () => {
  it('renders one section per contribution', () => {
    const body = renderPluginCommandsSkill([
      {
        pluginId: 'tasks',
        name: 'tasks',
        summary: 'Plan and track work',
        commands: [{ name: 'list', summary: 'List tasks', usage: 'zcc tasks list' }]
      }
    ]);
    expect(body).toContain('name: plugin-commands');
    expect(body).toContain('zcc tasks list');
    expect(body).toContain('plugin-commands');
  });

  it('writes the skill when contributions exist and removes it when empty', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-commands-'));
    try {
      await syncPluginCommandsSkill(dataDir, [
        { pluginId: 'hello', name: 'hello', summary: 'Say hello', commands: [] }
      ]);
      expect(readFileSync(join(generatedSkillsRootPath(dataDir), 'plugin-commands', 'SKILL.md'), 'utf8')).toContain(
        'zcc hello'
      );
      await syncPluginCommandsSkill(dataDir, []);
      expect(existsSync(join(generatedSkillsRootPath(dataDir), 'plugin-commands'))).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
