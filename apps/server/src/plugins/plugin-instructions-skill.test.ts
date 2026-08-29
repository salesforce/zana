import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatedSkillsRootPath } from './plugin-commands-skill.js';
import {
  renderPluginInstructionsSkill,
  syncPluginInstructionsSkill
} from './plugin-instructions-skill.js';

describe('plugin-instructions skill', () => {
  it('renders one section per contribution', () => {
    const body = renderPluginInstructionsSkill([
      { pluginId: 'custom-instructions', text: 'Always prefer small diffs.' }
    ]);
    expect(body).toContain('name: plugin-instructions');
    expect(body).toContain('Always prefer small diffs.');
    expect(body).toContain('custom-instructions');
  });

  it('writes the skill when text exists and removes it when empty', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-instructions-'));
    try {
      await syncPluginInstructionsSkill(dataDir, [
        { pluginId: 'custom-instructions', text: 'Be terse.' }
      ]);
      expect(
        readFileSync(join(generatedSkillsRootPath(dataDir), 'plugin-instructions', 'SKILL.md'), 'utf8')
      ).toContain('Be terse.');
      await syncPluginInstructionsSkill(dataDir, [{ pluginId: 'custom-instructions', text: '   ' }]);
      expect(existsSync(join(generatedSkillsRootPath(dataDir), 'plugin-instructions'))).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
