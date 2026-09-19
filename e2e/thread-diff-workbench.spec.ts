import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

async function expectReadableControl(control: Locator) {
  const { foreground, background } = await control.evaluate((node) => {
    const style = getComputedStyle(node);
    return { foreground: style.color, background: style.backgroundColor };
  });
  expect(background).not.toBe('rgba(0, 0, 0, 0)');
  expect(foreground).not.toBe(background);
}

test('Changes workbench renders real Git diffs, navigates files and commits from the side panel', async ({ app }, testInfo) => {
  const { window, home } = app;
  await app.electron.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.webContents.getURL().startsWith('devtools:'))!;
    main.webContents.setZoomFactor(1);
    main.setContentSize(1280, 900);
  });
  await expect.poll(() => window.evaluate(() => innerWidth)).toBe(1280);
  const projectPath = join(home, 'changes-project');
  mkdirSync(projectPath);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: projectPath, encoding: 'utf8' });
  const write = (path: string, content: string) => {
    const target = join(projectPath, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  git('init', '-b', 'feature/changes-workbench');
  git('config', 'user.name', 'Changes E2E');
  git('config', 'user.email', 'changes@example.test');
  const paths = ['apps/app/src/components/ProjectList.test.ts', 'apps/app/src/plugins/CreateProjectDialog.tsx', 'apps/app/src/styles/global.css', 'plugins/example/src/plugin-contract.ts', 'plugins/example/src/app.tsx'];
  const source = Array.from({ length: 35 }, (_, i) => `// Project configuration ${i + 1}`).join('\n');
  write(paths[0], `${source}\n\ndescribe('project actions', () => {\n  it('opens project dialogs', () => {\n    expect(openProject()).toBe(true);\n  });\n});\n`);
  write(paths[1], `import { Modal } from './Modal';\n\nexport function CreateProjectDialog() {\n  return <Modal title="Create project" />;\n}\n`);
  write(paths[2], '.project-actions {\n  display: block;\n}\n');
  write(paths[3], 'export interface ProjectAction {\n  title: string;\n}\n');
  write(paths[4], 'export function ProjectHome() {\n  return <main>Projects</main>;\n}\n');
  git('add', '.');
  git('commit', '-m', 'Initial project');
  write(paths[0], `${source}\n\ndescribe('project actions', () => {\n  it('opens project dialogs', () => {\n    expect(openProject()).toBe(true);\n    expect(project.title).toContain('My project');\n    expect(project.actions).toHaveLength(3);\n  });\n\n  it('keeps project actions in the panel', () => {\n    const source = readFileSync(\n      new URL('../plugins/CreateProjectDialog.tsx', import.meta.url),\n      'utf8'\n    );\n    expect(source).toContain('project-dialog');\n  });\n});\n`);
  write(paths[1], `import { Modal } from './Modal';\n\nexport function CreateProjectDialog() {\n  return <Modal title="Create project" className="project-dialog" />;\n}\n`);
  write(paths[2], '.project-actions {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  padding: 16px;\n}\n');
  write(paths[3], 'export interface ProjectAction {\n  title: string;\n  description?: string;\n  onSelect: () => void;\n}\n');
  write(paths[4], 'export function ProjectHome() {\n  return (\n    <main className="project-home">\n      <h1>Projects</h1>\n      <ProjectActions />\n    </main>\n  );\n}\n');

  const threadId = await window.evaluate(async (path) => {
    const post = async (url: string, body: unknown) => {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(json));
      return json;
    };
    const { project } = await post('/api/v1/projects', { path });
    const result = await post('/api/v1/threads', { projectId: project.id, providerId: 'fake', input: 'Review project changes' });
    return (result.thread ?? result.value).id as string;
  }, projectPath);
  await window.evaluate((id) => {
    localStorage.setItem(`zcc.secondaryPanel.${id}`, JSON.stringify({ version: 1, isOpen: true, isMaximized: false, widthPx: 880, activeId: 'diff', tabs: [] }));
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  await window.getByTestId('thread-diff-pin').click();
  const panel = window.getByTestId('thread-diff-panel');
  await expect(panel.getByTestId('thread-diff-card')).toHaveCount(5);
  await expect(panel.getByTitle('On branch feature/changes-workbench')).toBeVisible();
  const checkThemeSurfaces = async (theme: string) => {
    const commit = panel.getByRole('button', { name: 'Commit', exact: true });
    await expectReadableControl(commit);
    await commit.click();
    await expectReadableControl(panel.getByRole('form', { name: 'Commit changes' }));
    await expectReadableControl(panel.getByLabel('Commit message'));
    await panel.screenshot({ path: testInfo.outputPath(`changes-commit-${theme}.png`), animations: 'disabled' });
    await panel.getByRole('button', { name: 'Cancel commit' }).click();
    await panel.getByLabel('Diff display options').click();
    await expectReadableControl(panel.locator('.thread-diff-options-menu'));
    await panel.getByLabel('Diff display options').press('Escape');
  };
  await window.getByTestId('thread-secondary-maximize').click();
  await window.evaluate(() => window.cc.config.set({ theme: 'light' }));
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');
  await checkThemeSurfaces('light');
  await panel.screenshot({ path: testInfo.outputPath('changes-full-light.png'), animations: 'disabled' });
  await panel.getByRole('button', { name: 'Show changed files' }).click();
  const nav = panel.getByRole('navigation', { name: 'Changed files' });
  await expect(nav.getByText('5 files changed')).toBeVisible();
  await panel.screenshot({ path: testInfo.outputPath('changes-tree-light.png'), animations: 'disabled' });
  const search = nav.getByRole('searchbox');
  await search.fill('global.css');
  await expect(panel.getByTestId('thread-diff-card')).toHaveCount(1);
  await expect(nav.getByText('1 of 5 files changed')).toBeVisible();
  await search.fill('');
  await panel.getByLabel('Diff display options').click();
  await panel.getByRole('button', { name: 'Collapse all files' }).click();
  await panel.getByLabel('Diff display options').press('Escape');
  await nav.getByRole('button', { name: `View diff for ${paths[4]}` }).click();
  await expect(panel.getByRole('button', { name: `Collapse ${paths[4]}` })).toBeVisible();
  await expect(panel.getByTestId('thread-diff-hunks')).toHaveCount(1);
  await nav.getByRole('button', { name: 'View as list' }).click();
  await expect(nav.getByText(paths[4], { exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'View as tree' }).click();
  await panel.getByLabel('Diff display options').click();
  await panel.getByRole('button', { name: 'Split diff view' }).click();
  await expect(panel.locator('.thread-diff-hunks.is-split')).toBeVisible();
  await panel.getByRole('button', { name: 'Stacked diff view' }).click();
  await panel.getByRole('button', { name: 'Wrap diff lines' }).click();
  await panel.getByRole('button', { name: 'Collapse all files' }).click();
  await panel.getByRole('button', { name: 'Expand all files' }).click();
  await panel.getByLabel('Diff display options').press('Escape');
  await window.evaluate(() => window.cc.config.set({ theme: 'dark' }));
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark');
  await checkThemeSurfaces('dark');
  await panel.screenshot({ path: testInfo.outputPath('changes-tree-dark.png'), animations: 'disabled' });

  await window.getByTestId('thread-secondary-maximize').click();
  // Drive the real splitter down to its minimum width.
  const splitter = window.getByRole('separator', { name: 'Resize right panel' });
  const bounds = (await splitter.boundingBox())!;
  await window.mouse.move(bounds.x + bounds.width / 2, bounds.y + 150);
  await window.mouse.down();
  await window.mouse.move(1600, bounds.y + 150);
  await window.mouse.up();
  await expect.poll(() => panel.evaluate((node) => node.clientWidth)).toBeLessThan(481);
  expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await panel.getByTestId('thread-diff-toolbar').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await panel.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth;
  })).toBe(true);
  expect(await panel.getByTestId('thread-diff-toolbar').evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return [...node.querySelectorAll('button')].filter((button) => button.checkVisibility()).every((button) => {
      const rect = button.getBoundingClientRect();
      return rect.left >= bounds.left && rect.right <= bounds.right;
    });
  })).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('changes-narrow-dark.png'), animations: 'disabled' });
  await panel.getByRole('button', { name: 'Hide changed files' }).click();
  await expect(nav).toHaveCount(0);
  await panel.getByRole('button', { name: 'Commit', exact: true }).click();
  await panel.getByLabel('Commit message').fill('Improve project actions');
  await panel.getByRole('button', { name: 'Commit changes', exact: true }).click();
  await expect(panel.getByText('No changes.', { exact: true })).toBeVisible();
  expect(git('log', '-1', '--format=%s').trim()).toBe('Improve project actions');
  expect(git('status', '--porcelain').trim()).toBe('');
});
