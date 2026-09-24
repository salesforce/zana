import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';

test.use({ isolateBundledCatalog: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('CLI Agent preview_file displays project files and preserves confined reads', async ({ app }, testInfo) => {
  const { window, home } = app;
  const agent = makeFakeAgentBinary({ script: `
if [ "$1" = "--version" ]; then echo '2.1.220 (fake)'; exit 0; fi
printf '%s' "$ZCC_MCP_URL" > .preview-mcp-url
exec cat
` });
  const projectPath = join(realpathSync(home), 'preview-project');
  mkdirSync(join(projectPath, '.zcc'), { recursive: true });
  const report = '.zcc/report #1.md';
  writeFileSync(join(projectPath, report), `# CLI preview loaded\n\n${'Complete report content. '.repeat(1000)}\n\nEND OF REPORT\n`);
  writeFileSync(join(projectPath, 'shot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'));
  writeFileSync(join(home, 'outside.md'), 'PRIVATE OUTSIDE FILE');
  symlinkSync(join(home, 'outside.md'), join(projectPath, 'escape.md'));
  let sessionId: string | undefined;
  try {
    await window.evaluate((binary) => window.cc.config.set({ claudeBinary: binary }), agent.path);
    const ids = await window.evaluate(async (path) => {
      const project = await window.cc.projects.add(path);
      if (!project.ok) throw new Error(project.message);
      const session = await window.cc.terminals.create({ projectId: project.value.id, profile: 'claude', cols: 80, rows: 24 });
      if (!session.ok) throw new Error(session.message);
      history.pushState({}, '', `/projects/${project.value.id}/sessions/${session.value.id}`);
      dispatchEvent(new PopStateEvent('popstate'));
      return { projectId: project.value.id, sessionId: session.value.id };
    }, projectPath);
    sessionId = ids.sessionId;
    await expect(window.getByTestId('agent-session-view')).toBeVisible();
    await expect.poll(() => existsSync(join(projectPath, '.preview-mcp-url'))).toBe(true);
    const mcpUrl = readFileSync(join(projectPath, '.preview-mcp-url'), 'utf8');
    expect(mcpUrl).toContain(ids.sessionId);
    const preview = async (path: string) => {
      const response = await fetch(mcpUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'preview_file', arguments: { path } } })
      });
      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.error).toBeUndefined();
      expect(body.result.isError, JSON.stringify(body)).not.toBe(true);
      return body.result;
    };

    await preview(report);
    const panel = window.getByTestId('thread-secondary-panel');
    await expect(panel.getByRole('heading', { name: 'CLI preview loaded' })).toBeVisible();
    await expect(panel).toContainText('END OF REPORT');
    await expect(panel).not.toContainText('thread is not registered');
    await window.screenshot({ path: testInfo.outputPath('cli-file-preview.png') });

    await preview('shot.png');
    const image = panel.getByRole('img', { name: 'shot.png' });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);

    const reads = await window.evaluate(async ({ projectId, sessionId, projectPath }) => {
      const read = async (path: string, scope: string | null = projectId) => {
        const query = new URLSearchParams({ path, ...(scope ? { projectId: scope } : {}) });
        const response = await fetch(`/api/v1/threads/${sessionId}/host-files/content?${query}`);
        return { status: response.status, body: await response.text() };
      };
      return Promise.all([
        read(`${projectPath}/.zcc/report #1.md`), read('../outside.md'), read('escape.md'),
        read('missing.md'), read('.zcc/report #1.md', 'unregistered'), read('.zcc/report #1.md', null)
      ]);
    }, { ...ids, projectPath });
    expect(reads[0].status).toBe(200);
    expect(reads[0].body).toContain('END OF REPORT');
    expect(reads.slice(1).every((row) => row.status >= 400)).toBe(true);
    expect(reads.slice(1).every((row) => !row.body.includes('PRIVATE OUTSIDE FILE'))).toBe(true);

    // Existing conversation previews still use their environment; storage stays separate.
    const threadId = await window.evaluate(async (projectId) => {
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, providerId: 'fake', input: 'Preview regression' })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(body));
      return (body.thread ?? body.value).id as string;
    }, ids.projectId);
    const storageRoot = join(home, '.zcc', 'thread-storage', threadId);
    mkdirSync(storageRoot, { recursive: true });
    writeFileSync(join(storageRoot, 'stored.md'), '# Stored preview loaded');
    await window.evaluate((threadId) => {
      history.pushState({}, '', `/threads/${threadId}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, threadId);
    await expect(window.getByTestId('thread-detail')).toBeVisible();
    for (const file of [{ source: 'workspace', path: report }, { source: 'thread-storage', path: 'stored.md' }]) {
      await window.evaluate(async ({ threadId, file }) => {
        const response = await fetch(`/api/v1/threads/${threadId}/open`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file })
        });
        if (!response.ok) throw new Error(await response.text());
      }, { threadId, file });
      await expect(window.getByRole('heading', { name: file.source === 'workspace' ? 'CLI preview loaded' : 'Stored preview loaded' }).last()).toBeVisible();
    }
  } finally {
    if (sessionId) await window.evaluate((id) => window.cc.terminals.close(id), sessionId).catch(() => undefined);
    agent.cleanup();
  }
});
