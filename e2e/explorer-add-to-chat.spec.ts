import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, dismissConsentOverlays } from './fixtures/app.js';

test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { sponsorPromptDismissed: true, theme: 'light' } });
test.setTimeout(120_000);

test('Explorer "Add to chat" inserts file and folder path mentions into the open composer', async ({ app, home }) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const root = join(home, 'Explorer Mentions');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# Add to chat\n');
  writeFileSync(join(root, 'src', 'app.ts'), 'export const app = true;\n');
  const projectId = await page.evaluate(async root => {
    const result = await window.cc.projects.add(root);
    if (!result.ok) throw Error(result.message);
    return result.value.id;
  }, root);
  await page.evaluate(path => {
    history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate'));
  }, `/projects/${projectId}/explorer`);
  const host = page.getByTestId('explorer-panel-layout');
  const file = host.locator('.tree-row.file').filter({ hasText: 'README.md' });
  const folder = host.locator('.tree-row.dir').filter({ hasText: 'src' });

  // With no chat open there is nothing to insert into: the user is told, nothing breaks.
  await file.click({ button: 'right' });
  await host.getByRole('button', { name: 'Add to chat', exact: true }).click();
  await expect(page.getByText('Open a chat for this project first')).toBeVisible();

  await host.getByRole('button', { name: 'Ask an agent', exact: true }).click();
  const input = host.getByTestId('panel-agent-tab-composer').getByTestId('thread-command-input');
  await expect(input).toBeEditable();

  await file.click({ button: 'right' });
  await host.getByRole('button', { name: 'Add to chat', exact: true }).click();
  await expect(input.locator('.prompt-mention-pill')).toHaveCount(1);
  await expect(input.locator('.prompt-mention-pill').first()).toContainText('README.md');

  await folder.click({ button: 'right' });
  await host.getByRole('button', { name: 'Add to chat', exact: true }).click();
  await expect(input.locator('.prompt-mention-pill')).toHaveCount(2);
  await expect(input.locator('.prompt-mention-pill').nth(1)).toContainText('src');
});
