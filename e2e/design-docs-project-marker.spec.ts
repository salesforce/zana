import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

// Design Docs project chips must show the sidebar's icon + color and follow a recolor live.
test('Design Docs project marker matches the project icon and color and follows recolor', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');

  const projectPath = join(home, 'design-docs-marker-project');
  mkdirSync(projectPath, { recursive: true });
  const projectId = await win.evaluate(async (path) => {
    const added = await window.cc.projects.add(path);
    if (!added.ok) throw new Error(added.message);
    await window.cc.pluginApps.callRpc('design-docs', 'create', {
      title: 'Marker parity doc', template: 'technical', projectId: added.value.id
    });
    await window.cc.projects.update(added.value.id, { icon: 'Rocket', color: '#3fb950' });
    return added.value.id as string;
  }, projectPath);

  await win.getByRole('button', { name: /^Design Docs/ }).click();
  await expect(win.getByText('Marker parity doc').first()).toBeVisible();
  const marker = win.locator('.project-marker--icon[data-project-icon="Rocket"]').last();
  await expect(marker).toBeVisible();
  await expect(marker).toHaveCSS('color', 'rgb(63, 185, 80)');

  await win.evaluate((id) => window.cc.projects.update(id, { color: '#bc8cff' }), projectId);
  await expect(win.locator('.project-marker--icon[data-project-icon="Rocket"]').last())
    .toHaveCSS('color', 'rgb(188, 140, 255)');
});
