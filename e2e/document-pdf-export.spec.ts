import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('Docs and chat file previews download complete PDFs through Electron', async ({ app }, testInfo) => {
  const { window, home, electron } = app;
  const downloads = join(home, 'pdf-downloads');
  // Keep the real print/save path; only avoid opening an external PDF viewer.
  await electron.evaluate(({ shell }) => { shell.openPath = async () => ''; });
  const source = [
    '# Export guide',
    'First paragraph in the exported document.',
    '| Feature | Result |\n| --- | --- |\n| PDF | Available |',
    '```mermaid\nflowchart LR\n  Read --> Download\n```',
    ...Array.from({ length: 100 }, (_, i) => `Paragraph ${i + 1}: The entire document must be exported, including content below the visible scroll area.`),
    'FINAL DOCUMENT PARAGRAPH'
  ].join('\n\n');
  await window.evaluate(async ({ downloads, source }) => {
    await window.cc.config.set({ pdfExportDir: downloads });
    const doc = await window.cc.library.add({
      scope: 'global', relPath: 'export-guide.md', title: 'Export guide', content: source
    });
    if (!doc) throw new Error('Could not create export document');
    history.pushState({}, '', '/plugins/docs/panel/global/export-guide.md');
    dispatchEvent(new PopStateEvent('popstate'));
  }, { downloads, source });

  const download = window.getByRole('button', { name: 'Download PDF', exact: true });
  await expect(download).toBeEnabled();
  await download.click();
  const exported = join(downloads, 'Export guide.pdf');
  await expect.poll(() => existsSync(exported), { timeout: 30_000 }).toBe(true);
  const pdf = readFileSync(exported);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
  copyFileSync(exported, testInfo.outputPath('library-document.pdf'));
  await expect(download).toBeEnabled();
  await download.click();
  await expect.poll(() => existsSync(join(downloads, 'Export guide (2).pdf'))).toBe(true);
  expect(readFileSync(exported).equals(pdf)).toBe(true);

  // A failed write is visible and the action recovers for a subsequent attempt.
  const invalidDir = join(home, 'not-a-directory');
  writeFileSync(invalidDir, 'file');
  await window.evaluate((pdfExportDir) => window.cc.config.set({ pdfExportDir }), invalidDir);
  await expect(download).toBeEnabled();
  await download.click();
  await expect(window.getByText(/EEXIST|ENOTDIR/)).toBeVisible();
  await expect(download).toBeEnabled();
  await window.evaluate((pdfExportDir) => window.cc.config.set({ pdfExportDir }), downloads);

  const projectPath = join(home, 'pdf-project');
  mkdirSync(projectPath);
  writeFileSync(join(projectPath, 'chat-report.md'), source);
  await window.evaluate(async (projectPath) => {
    const project = await window.cc.projects.add(projectPath);
    if (!project.ok) throw new Error('Could not register test project');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'PDF preview test' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    const threadId = (body.thread ?? body.value).id;
    localStorage.setItem(`zcc.secondaryPanel.${threadId}`, JSON.stringify({
      version: 1, isOpen: true, isMaximized: false, widthPx: 600, activeId: 'report',
      tabs: [{ id: 'report', kind: 'file-preview', path: `${projectPath}/chat-report.md`, title: 'chat-report.md' }]
    }));
    history.pushState({}, '', `/threads/${threadId}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, projectPath);
  const toolbar = window.getByTestId('thread-file-preview-chrome');
  await expect(toolbar.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  await toolbar.getByRole('button', { name: 'Download PDF' }).click();
  const chatPdf = join(downloads, 'chat-report.md.pdf');
  await expect.poll(() => existsSync(chatPdf), { timeout: 30_000 }).toBe(true);
  expect(readFileSync(chatPdf).subarray(0, 5).toString()).toBe('%PDF-');
  copyFileSync(chatPdf, testInfo.outputPath('chat-document.pdf'));
  await window.screenshot({ path: testInfo.outputPath('chat-pdf-download.png') });
});
