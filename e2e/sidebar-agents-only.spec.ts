import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { tmuxScope: 'off', sponsorPromptDismissed: true } });

test('sidebar Agents only view hides project rows and tags each session with its project', async ({ app }, testInfo) => {
  const { window, home } = app;
  const support = window.getByRole('dialog', { name: 'Support Zana' });
  if (await support.isVisible().catch(() => false)) await support.getByRole('button', { name: 'Dismiss' }).click();
  const bin = join(home, 'sidebar-agent.cjs');
  writeFileSync(bin, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('2.1.220 (Claude Code)'); process.exit(0); }
process.stdout.write('CLI Agent ready\\n');
process.stdin.resume();
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  const roots = ['local-core', 'salesforce-agent-bench', 'zana-builder', 'mobile-app-builder', 'plant-app']
    .map((name) => { const root = join(home, name); mkdirSync(root); return root; });
  await window.evaluate(async ({ roots, bin }) => {
    await window.cc.config.set({ claudeBinary: bin });
    const ids: string[] = [];
    for (const path of roots) {
      const project = await window.cc.projects.add(path);
      if (!project.ok) throw new Error(project.message);
      ids.push(project.value.id);
    }
    const thread = async (projectId: string, title: string) => {
      const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, providerId: 'fake', input: title, title }) });
      if (!response.ok) throw new Error(await response.text());
    };
    await thread(ids[0], 'Check my auto-forward ticket');
    await thread(ids[1], 'What are the next steps to test this?');
    const cli = await window.cc.terminals.create({ projectId: ids[2], profile: 'claude', title: 'Refactor sidebar rail', cols: 80, rows: 24 });
    if (!cli.ok) throw new Error(cli.message);
  }, { roots, bin });
  await window.getByTestId('nav-inbox').click();
  await window.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  const rail = window.locator('.sidebar--global');
  const projectsSection = rail.locator('.sidebar-projects');
  await expect(rail.getByRole('button', { name: 'Open local-core', exact: true })).toBeVisible();
  await expect(rail.locator('[data-kind="agent"]')).toHaveCount(1);
  await expect(rail.getByTestId('project-thread-row')).toHaveCount(2);
  await captureElectronScreenshot(app.electron, window, testInfo.outputPath('sidebar-projects-view.png'), projectsSection);

  await rail.getByRole('button', { name: 'Organize projects', exact: true }).click();
  await rail.getByRole('menuitemradio', { name: 'Agents only', exact: true }).click();
  const agents = rail.getByRole('list', { name: 'Agents', exact: true });
  await expect(agents.getByRole('listitem')).toHaveCount(3);
  await expect(rail.getByRole('button', { name: 'Open local-core', exact: true })).toHaveCount(0);
  await expect(agents.getByTestId('project-thread-row').filter({ hasText: 'Check my auto-forward ticket' }))
    .toContainText('Thread · local-core');
  await expect(agents.locator('[data-kind="agent"] .project-terminal-project')).toHaveText('zana-builder');
  await expect(rail.getByRole('textbox', { name: 'Filter agents' })).toBeVisible();
  await expect(agents).toHaveCSS('border-left-width', '0px');
  await captureElectronScreenshot(app.electron, window, testInfo.outputPath('sidebar-agents-only-view.png'), projectsSection);

  await window.reload();
  await expect(rail.getByRole('list', { name: 'Agents', exact: true }).getByRole('listitem')).toHaveCount(3);
});
