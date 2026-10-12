import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
vi.mock('electron', () => ({ shell: {} }));
import { listCommands } from './commands.js';
let home: string, project: string;
async function file(path: string, body: string) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, body); }
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'native-commands-')); project = join(home, 'project'); await mkdir(project); vi.stubEnv('ZCC_CLAUDE_HOME', home); vi.stubEnv('CLAUDE_CONFIG_DIR', ''); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }); });
it('reads both skills and legacy commands with namespacing and argument hints', async () => {
  await file(join(home, '.claude/commands/git/commit.md'), '---\ndescription: Commit the change\nargument-hint: <files>\n---\nBody');
  await file(join(home, '.claude/skills/review/SKILL.md'), '---\nname: review-code\ndescription: Review\n---\nBody');
  expect(await listCommands()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'git:commit', invocation: '/git:commit', argumentHint: '<files>', scope: 'user' }), expect.objectContaining({ name: 'review-code' })]));
});
it('respects a custom config directory, including symlinked personal skills', async () => {
  const config = join(home, 'custom'); vi.stubEnv('CLAUDE_CONFIG_DIR', config);
  await file(join(config, 'commands/grill-me.md'), '---\ndescription: Ask questions\n---');
  await file(join(home, 'shared/SKILL.md'), '---\nname: shared\n---');
  await mkdir(join(config, 'skills')); await symlink(join(home, 'shared'), join(config, 'skills/linked'));
  await file(join(home, '.claude/commands/old.md'), 'old');
  expect((await listCommands()).map(row => row.name).sort()).toEqual(['grill-me', 'shared']);
});
it('honors author restrictions and disabled skill overrides', async () => {
  for (const [name, flag] of [['hidden', 'user-invocable: false'], ['manual', 'disable-model-invocation: true'], ['off', '']]) await file(join(home, `.claude/skills/${name}/SKILL.md`), `---\nname: ${name}\n${flag}\n---`);
  await file(join(home, '.claude/settings.json'), JSON.stringify({ skillOverrides: { off: 'off' } }));
  expect((await listCommands()).map(row => row.name)).toEqual(['manual']);
});
it('uses project skills before same-named commands and user entries', async () => {
  await file(join(home, '.claude/commands/review.md'), '---\ndescription: User\n---');
  await file(join(project, '.claude/commands/review.md'), '---\ndescription: Project command\n---');
  await file(join(project, '.claude/skills/review/SKILL.md'), '---\ndescription: Project skill\n---');
  const rows = await listCommands({ projectPath: project, projectId: 'p' });
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ scope: 'project', projectId: 'p', description: 'Project skill' });
  expect((await listCommands({ projectPath: project }))[0].scope).toBe('user');
});
it('reads enabled installed plugin manifests and ignores marketplace source trees and disabled plugins', async () => {
  const plugin = join(home, 'cache/plugin/v1');
  await file(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'reviewer', skills: ['./custom'], commands: ['./actions'] }));
  await file(join(plugin, 'custom/review/SKILL.md'), '---\nname: review\n---');
  await file(join(plugin, 'actions/check.md'), '---\ndescription: Check\n---');
  await file(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'reviewer@test': [{ scope: 'user', installPath: plugin }] } }));
  await file(join(home, '.claude/plugins/marketplaces/test/plugins/uninstalled/commands/no.md'), 'no');
  expect((await listCommands()).map(row => row.name).sort()).toEqual(['reviewer:check', 'reviewer:review']);
  await file(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'reviewer@test': false } }));
  expect(await listCommands()).toEqual([]);
});
it('rejects missing manifests, malformed metadata and project symlink escapes', async () => {
  await mkdir(join(project, '.claude/skills/empty'), { recursive: true });
  await file(join(home, 'outside/SKILL.md'), '---\nname: outside\n---');
  await symlink(join(home, 'outside'), join(project, '.claude/skills/escape'));
  await file(join(project, '.claude/skills/bad/SKILL.md'), '---\nname: [broken\n---');
  expect(await listCommands({ projectPath: project, projectId: 'p' })).toEqual([]);
});
