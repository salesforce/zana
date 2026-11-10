import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'plugins', 'skills-hooks-mcp');

export const SKILLS_ONLY_ID = 'skills-only@test';
export const MIXED_ID = 'mixed@test';

function writeFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/**
 * Seed the isolated HOME's Claude config: two user skills and the two fixture
 * plugins (skills-only, and mixed = skills + hook + MCP server). Only writes
 * under `home`; never the real user's config.
 */
export function seedSkillInventory(home: string): { configDir: string; plugins: Record<string, string> } {
  const configDir = join(home, '.claude');
  for (const name of ['allowed-user', 'blocked-user']) {
    writeFile(join(configDir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} E2E user skill\n---\nBody\n`);
  }
  // User slash command (not a skill): must be switched off too.
  writeFile(join(configDir, 'commands', 'blocked-cmd.md'), '---\ndescription: blocked-cmd E2E user command\n---\nBody\n');
  const plugins: Record<string, string> = {};
  const installed: Record<string, Array<{ scope: string; installPath: string }>> = {};
  for (const [dir, id] of [['skills-only', SKILLS_ONLY_ID], ['mixed', MIXED_ID]] as const) {
    const installPath = join(configDir, 'plugins', 'cache', 'test', dir, '1.0.0');
    cpSync(join(fixtureRoot, dir), installPath, { recursive: true });
    installed[id] = [{ scope: 'user', installPath }];
    plugins[id] = installPath;
  }
  writeFile(join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: installed }));
  writeFile(join(configDir, 'settings.json'), JSON.stringify({ enabledPlugins: { [SKILLS_ONLY_ID]: true, [MIXED_ID]: true } }));
  return { configDir, plugins };
}
