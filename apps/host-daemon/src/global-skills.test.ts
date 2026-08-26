import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installGlobalSkills, readGlobalSkillsStatus } from './global-skills.js';

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('global CLI skills', () => {
  it('writes zcc-cli into both agent skill roots atomically', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-global-skills-'));
    homes.push(homeDir);
    const content = '# zcc-cli\nDrive Zana from the terminal.\n';
    const installed = await installGlobalSkills({
      homeDir,
      skills: [{ name: 'zcc-cli', content }]
    });
    expect(installed.installations.map((row) => row.path).sort()).toEqual([
      join(homeDir, '.agents', 'skills', 'zcc-cli'),
      join(homeDir, '.claude', 'skills', 'zcc-cli')
    ].sort());
    expect(readFileSync(join(homeDir, '.agents', 'skills', 'zcc-cli', 'SKILL.md'), 'utf8')).toBe(content);
    expect(readFileSync(join(homeDir, '.claude', 'skills', 'zcc-cli', 'SKILL.md'), 'utf8')).toBe(content);

    const status = await readGlobalSkillsStatus({ homeDir, names: ['zcc-cli'] });
    expect(status.entries).toHaveLength(2);
    expect(status.entries.every((row) => row.installed && row.hash)).toBe(true);
  });

  it('reports missing copies as not installed', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-global-skills-missing-'));
    homes.push(homeDir);
    const status = await readGlobalSkillsStatus({ homeDir, names: ['zcc-cli'] });
    expect(status.entries.every((row) => row.installed === false && row.hash === null)).toBe(true);
  });

  it('rejects a path-like skill name', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-global-skills-escape-'));
    homes.push(homeDir);
    await expect(installGlobalSkills({
      homeDir,
      skills: [{ name: '../etc', content: 'nope' }]
    })).rejects.toMatchObject({ code: 'invalid_path' });
  });
});
