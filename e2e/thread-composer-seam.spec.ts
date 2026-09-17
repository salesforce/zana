import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('the files bar joins the plugin-wrapped composer without a gap or shadow', async ({ app }) => {
  const { window, home } = app;
  const projectPath = join(home, 'composer-seam-project');
  mkdirSync(projectPath);
  execFileSync('git', ['init', '--quiet'], { cwd: projectPath });
  writeFileSync(join(projectPath, 'README.md'), 'Composer seam fixture\n');

  const threadId = await window.evaluate(async (path) => {
    const projectResponse = await fetch('/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path })
    });
    const project = await projectResponse.json();
    if (!projectResponse.ok) throw new Error(JSON.stringify(project));
    const threadResponse = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.project.id,
        providerId: 'fake',
        input: 'Check composer layout'
      })
    });
    const thread = await threadResponse.json();
    if (!threadResponse.ok) throw new Error(JSON.stringify(thread));
    return (thread.thread ?? thread.value).id as string;
  }, projectPath);

  await window.evaluate((id) => {
    window.history.pushState({}, '', `/threads/${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);

  const dock = window.locator('.thread-composer-dock');
  const banner = dock.getByTestId('thread-workspace-banner');
  const composer = dock.locator('.plugin-composer-chrome .ui-command-composer');
  await expect(banner).toBeVisible();
  await expect(composer).toBeVisible();

  for (const expanded of [false, true]) {
    if (expanded) await banner.getByRole('button', { name: '1 File', exact: true }).click();
    await expect(banner.getByRole('button', { name: '1 File', exact: true }))
      .toHaveAttribute('aria-expanded', String(expanded));
    await composer.getByTestId('thread-command-input').focus();
    await expect(composer).toHaveCSS('border-top-left-radius', '0px');
    await expect(composer).toHaveCSS('border-top-right-radius', '0px');
    await expect(composer).toHaveCSS('box-shadow', 'none');
    const bannerBox = await banner.boundingBox();
    const composerBox = await composer.boundingBox();
    expect(bannerBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(Math.abs(composerBox!.y - (bannerBox!.y + bannerBox!.height))).toBeLessThanOrEqual(1);
    expect(composerBox!.x).toBe(bannerBox!.x);
    expect(composerBox!.width).toBe(bannerBox!.width);
  }
});
