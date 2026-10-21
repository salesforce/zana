import { test, expect } from './fixtures/app.js';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });

// The editor buttons on a file's opener bar spawn the configured CLI from main
// with the project folder AND the file, so the file opens in its project
// window. A fake CLI records each argv it is started with.
test('file opener bar opens the file inside its project in VS Code and IntelliJ', async ({ app, home }) => {
  test.skip(process.platform === 'win32', 'Windows runs the editor exe directly; argv is covered in openers.test.ts');
  const { window } = app;
  const root = join(home, 'opener project');
  mkdirSync(join(root, 'src dir'), { recursive: true });
  writeFileSync(join(root, 'src dir', 'it’s here.ts'), 'export const here = true;\n');
  const realRoot = realpathSync(root);
  const realFile = join(realRoot, 'src dir', 'it’s here.ts');

  const log = join(home, 'editor-argv.jsonl');
  const editor = join(home, 'fake-editor.cjs');
  writeFileSync(editor, `#!/usr/bin/env node\nrequire('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
  chmodSync(editor, 0o755);
  const calls = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]) : [];

  await window.evaluate(async ({ path, editor }) => {
    await window.cc.config.set({ editorCodeBinary: editor, editorIntellijBinary: editor });
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
  }, { path: root, editor });

  const heading = window.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await window.getByRole('button', { name: 'Open opener project', exact: true }).click();
  await window.getByTestId('project-nav-explorer').click();
  await window.locator('.tree-row.dir').filter({ hasText: 'src dir' }).click();
  await window.locator('.tree-row.file').filter({ hasText: 'it’s here.ts' }).click();
  const bar = window.locator('.explorer-viewer .opener-bar');
  await expect(bar).toBeVisible();

  await bar.getByTitle('Open in VS Code').click();
  await expect.poll(calls).toEqual([['-n', realRoot, realFile]]);
  await bar.getByTitle('Open in IntelliJ IDEA').click();
  await expect.poll(calls).toEqual([['-n', realRoot, realFile], [realRoot, realFile]]);

  // Main ignores a project root it doesn't trust and opens the file alone.
  await window.evaluate(async ({ file, foreign }) => {
    const result = await window.cc.openers.openIn('code', file, { projectRoot: foreign });
    if (!result.ok) throw new Error(result.message);
  }, { file: realFile, foreign: home });
  await expect.poll(calls).toEqual([['-n', realRoot, realFile], [realRoot, realFile], ['-n', realFile]]);
});
