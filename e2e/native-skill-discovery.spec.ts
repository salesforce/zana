import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test, expect, launchApp } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';
function file(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
async function route(app: Awaited<ReturnType<typeof launchApp>>, path: string) {
  await app.window.evaluate((path) => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test('native skills and legacy commands survive the built Electron host RPC boundary, with author restrictions and fresh plugin enablement', async ({
  home
}) => {
  const config = join(home, 'custom-claude');
  const plugin = join(config, 'plugins/cache/test/reviewer/1.0.0');
  file(
    join(config, 'commands/grill-me.md'),
    '---\ndescription: Question the proposal\n---\nAsk questions'
  );
  file(
    join(home, 'shared/SKILL.md'),
    '---\nname: linked-review\ndescription: Shared personal skill\ndisable-model-invocation: true\n---\nReview'
  );
  mkdirSync(join(config, 'skills'), { recursive: true });
  symlinkSync(join(home, 'shared'), join(config, 'skills/linked'));
  file(
    join(config, 'skills/agent-only/SKILL.md'),
    '---\nname: agent-only\nuser-invocable: false\n---\nBody'
  );
  mkdirSync(join(config, 'skills/empty'), { recursive: true });
  file(
    join(plugin, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'reviewer', skills: ['./custom'], commands: ['./actions'] })
  );
  file(join(plugin, 'custom/review/SKILL.md'), '---\nname: plugin-review\n---\nBody');
  file(join(plugin, 'actions/check.md'), '---\ndescription: Check\n---\nBody');
  file(
    join(config, 'plugins/installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: { 'reviewer@test': [{ scope: 'user', installPath: plugin }] }
    })
  );
  file(
    join(config, 'settings.json'),
    JSON.stringify({ enabledPlugins: { 'reviewer@test': true } })
  );
  file(
    join(config, 'plugins/marketplaces/test/plugins/uninstalled/skills/uninstalled/SKILL.md'),
    '---\nname: uninstalled\n---'
  );
  const app = await launchApp(home, {
    env: { CLAUDE_CONFIG_DIR: config },
    initialConfig: { sponsorPromptDismissed: true }
  });
  try {
    await waitForThreadProvider(app.window, 'claude-code');
    const listing = () =>
      app.window.evaluate(async () => {
        const response = await fetch('/api/v1/skills/native-capabilities?providerId=claude-code');
        if (!response.ok) throw Error(await response.text());
        return response.json();
      });
    const catalog = await listing();
    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'grill-me', kind: 'command' }),
        expect.objectContaining({
          name: 'linked-review',
          linked: true,
          disableModelInvocation: true
        }),
        expect.objectContaining({
          name: 'plugin-review',
          source: 'plugin',
          id: 'plugin:reviewer/review'
        })
      ])
    );
    expect(catalog.skills.map((row: any) => row.name)).not.toContain('empty');
    expect(catalog.skills.map((row: any) => row.name)).not.toContain('uninstalled');
    expect(catalog.commands.map((row: any) => row.name)).toContain('/reviewer:check');
    expect(catalog.commands.map((row: any) => row.name)).not.toContain('/agent-only');
    await route(app, '/extensions/skills');
    await app.window.getByRole('textbox', { name: 'Search skills' }).fill('grill-me');
    await expect(app.window.locator('.skills-row')).toContainText('Command');
    await app.window.getByRole('textbox', { name: 'Search skills' }).fill('linked-review');
    await expect(app.window.locator('.skills-row')).toContainText('Linked');
    await expect(app.window.locator('.skills-row')).toContainText('Manual only');
    const palette = await app.window.evaluate(() => window.cc.commands.list());
    expect(palette.map((row) => row.invocation)).toContain('/grill-me');
    expect(palette.map((row) => row.invocation)).not.toContain('/agent-only');
    file(
      join(config, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'reviewer@test': false } })
    );
    expect((await listing()).skills.map((row: any) => row.name)).not.toContain('plugin-review');
    file(join(config, 'skills/new/SKILL.md'), '---\nname: after-refresh\n---\nNew');
    await app.window.getByRole('textbox', { name: 'Search skills' }).fill('after-refresh');
    await app.window.getByRole('button', { name: 'Refresh skills', exact: true }).click();
    await expect(app.window.locator('.skills-row')).toContainText('after-refresh');
  } finally {
    await app.electron.close();
  }
});

test('project discovery confines symlinks and refuses an offline foreign host instead of scanning its local shadow', async ({
  home
}) => {
  const local = join(home, 'local'),
    foreign = join(home, 'foreign');
  file(join(local, '.claude/skills/local-canary/SKILL.md'), '---\nname: local-canary\n---');
  file(join(foreign, '.claude/skills/foreign-canary/SKILL.md'), '---\nname: foreign-canary\n---');
  symlinkSync(join(foreign, '.claude/skills/foreign-canary'), join(local, '.claude/skills/escape'));
  file(
    join(home, '.zcc/projects.json'),
    JSON.stringify({
      version: 1,
      projects: [
        { id: 'local', name: 'Local', path: local, createdAt: 1, lastActiveAt: 1 },
        {
          id: 'foreign',
          name: 'Foreign',
          path: foreign,
          hostId: 'offline-other-machine',
          createdAt: 1,
          lastActiveAt: 1
        }
      ]
    })
  );
  const app = await launchApp(home, {
    env: { CLAUDE_CONFIG_DIR: join(home, '.claude') },
    initialConfig: { sponsorPromptDismissed: true }
  });
  try {
    await waitForThreadProvider(app.window, 'claude-code');
    const results = await app.window.evaluate(async () => {
      const local = await fetch(
        '/api/v1/projects/local/native-capabilities?providerId=claude-code'
      );
      const foreign = await fetch(
        '/api/v1/projects/foreign/native-capabilities?providerId=claude-code'
      );
      const unknown = await fetch('/api/v1/projects/missing/native-capabilities');
      return {
        local: await local.json(),
        foreignStatus: foreign.status,
        foreign: await foreign.json(),
        unknownStatus: unknown.status
      };
    });
    expect(results.local.skills.map((row: any) => row.name)).toContain('local-canary');
    expect(results.local.skills.map((row: any) => row.name)).not.toContain('foreign-canary');
    expect(results.foreignStatus).toBeGreaterThanOrEqual(400);
    expect(results.unknownStatus).toBe(404);
  } finally {
    await app.electron.close();
  }
});
