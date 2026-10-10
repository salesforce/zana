import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { tmuxScope: 'off', sponsorPromptDismissed: true } });

test('search edits do not execute a regex against retained renderer previews', async ({ app }, testInfo) => {
  const { window: page, home } = app;
  const root = join(home, 'regex-highlight-audit');
  mkdirSync(root);
  writeFileSync(join(root, 'preview.txt'), 'a'.repeat(26) + '!');
  const id = await page.evaluate(async root => {
    const result = await window.cc.projects.add(root);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, root);
  await page.evaluate(id => {
    history.pushState({}, '', `/projects/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, id);
  await expect(page.getByText('regex-highlight-audit', { exact: true }).first()).toBeVisible();
  // Enter through the project control so keyboard actions have selected scope;
  // a URL change alone can render the project before selection is established.
  await page.getByRole('button', { name: 'Open regex-highlight-audit', exact: true }).click();
  const modifier = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control');
  await page.keyboard.press(`${modifier}+Shift+f`);
  const input = page.locator('.search-panel input');
  await expect(input).toBeVisible();
  await input.fill('!');
  await expect(page.locator('.search-item')).toHaveCount(1);
  await page.getByTitle('Use regex', { exact: true }).click();
  await expect(page.locator('.search-item')).toHaveCount(1);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const state = globalThis as any;
    state.auditLongTasks = [];
    state.auditMaxGap = 0;
    state.auditLast = performance.now();
    state.auditObserver = new PerformanceObserver(list => { for (const entry of list.getEntries()) state.auditLongTasks.push(entry.duration); });
    state.auditObserver.observe({ entryTypes: ['longtask'] });
    state.auditTimer = setInterval(() => {
      const now = performance.now();
      state.auditMaxGap = Math.max(state.auditMaxGap, now - state.auditLast);
      state.auditLast = now;
    }, 10);
  });
  try {
    await input.fill('(a+)+$');
    await page.waitForTimeout(700);
    const measured = await page.evaluate(() => {
      const state = globalThis as any;
      return { maxTimerGapMs: state.auditMaxGap, longTasksMs: state.auditLongTasks };
    });
    console.log('SEARCH_RENDERER_RESPONSIVENESS', JSON.stringify(measured));
    await testInfo.attach('search-renderer-responsive.json', { body: JSON.stringify(measured, null, 2), contentType: 'application/json' });
    expect(measured.maxTimerGapMs).toBeLessThan(500);
  } finally {
    await page.evaluate(() => { const state = globalThis as any; clearInterval(state.auditTimer); state.auditObserver.disconnect(); });
  }
});

test('large documents stay bounded and recursive deletion yields at the Electron boundary', async ({ home }) => {
  test.setTimeout(120_000);
  const { closeApp, launchApp } = await import('./fixtures/app.js');
  const { writeFile } = await import('node:fs/promises');
  const root = join(home, 'large-preview-project'); mkdirSync(join(root, 'delete-me'), { recursive: true });
  const large = '# Large document\n```javascript\n' + 'const value = 1;\n'.repeat(60_000) + '```';
  writeFileSync(join(root, 'large.md'), large);
  for (let batch = 0; batch < 60; batch++) await Promise.all(Array.from({ length: 100 }, (_, i) => writeFile(join(root, 'delete-me', `${batch}-${i}.txt`), 'fixture')));
  mkdirSync(join(home, '.zcc/inbox'), { recursive: true });
  writeFileSync(join(home, '.zcc/projects.json'), JSON.stringify({ version: 1, projects: [{ id: 'large-preview', name: 'Large preview project', path: root, createdAt: Date.now(), lastActiveAt: Date.now() }] }));
  writeFileSync(join(home, '.zcc/inbox/entries.jsonl'), JSON.stringify({ id: 'large-report', projectId: 'large-preview', ts: Date.now(), subject: 'Large document regression', comments: 'Attached document', docs: [{ path: 'large.md' }] }) + '\n');
  const app = await launchApp(home, { e2e: true, env: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true, tmuxScope: 'off' } });
  try {
    const page = app.window; await page.getByTestId('nav-inbox').click(); await page.locator('.inbox-row').filter({ hasText: 'Large document regression' }).click();
    await expect(page.getByText('Preview shortened. Copy full text to read the complete content.')).toBeVisible();
    expect(await page.locator('.inbox-doc-body pre').evaluate(node => node.textContent!.length)).toBeLessThanOrEqual(64_000);
    await page.getByRole('button', { name: 'Copy full text', exact: true }).click(); await expect(page.getByRole('button', { name: 'Copied full text' })).toBeVisible();
    expect(await app.electron.evaluate(({ clipboard }) => clipboard.readText())).toBe(large);
    await app.electron.evaluate(() => {
      const state = globalThis as any; state.probeTicks = 0; state.probeGap = 0; let last = performance.now();
      state.probeTimer = setInterval(() => { const now = performance.now(); state.probeTicks++; state.probeGap = Math.max(state.probeGap, now - last); last = now; }, 10);
    });
    expect(await page.evaluate(async root => window.cc.fs.delete(root, root + '/delete-me'), root)).toMatchObject({ ok: true });
    const measured = await app.electron.evaluate(() => { const state = globalThis as any; clearInterval(state.probeTimer); return { ticks: state.probeTicks, gap: state.probeGap }; });
    expect(measured.ticks).toBeGreaterThan(0); expect(measured.gap).toBeLessThan(500);
  } finally { await app.electron.close(); }
});

test('plugin service returns survive worker transport and a blocking callback cannot freeze product requests', async ({ home }) => {
  test.setTimeout(90_000);
  const { closeApp, launchApp } = await import('./fixtures/app.js');
  const root = join(home, 'plugin-worker-regression'); mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'plugin-worker-regression', version: '1.0.0', engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' }, zcc: { name: 'Busy worker regression', description: 'Isolated fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(root, 'server.mjs'), `export default async api => {
    const db = api.storage.database(); db.migrate(['CREATE TABLE values_table (id INTEGER PRIMARY KEY, value TEXT)']);
    db.prepare('INSERT OR REPLACE INTO values_table VALUES (?, ?)').run(1, 'native worker');
    await api.storage.kv.set('ready', true);
    let listeners = 0;
    api.services.provide({ version: 1, label: () => 'ready', lazy: () => Promise.resolve('lazy'), async delayed() { await new Promise(resolve => setTimeout(resolve, 10)); return 'async'; }, subscribe() { listeners++; return () => { listeners--; }; }, count: () => listeners });
    api.rpc.method('ready', async () => ({ row: db.prepare('SELECT value FROM values_table').get(), stored: await api.storage.kv.get('ready') }));
    api.rpc.method('busy', async () => { await new Promise(resolve => setTimeout(resolve, 20)); while (true) {} });
  }`);
  const consumer = join(home, 'plugin-service-consumer'); mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'plugin-service-consumer', version: '1.0.0', engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' }, zcc: { name: 'Service consumer regression', description: 'Service fixture', branding: { icon: 'Puzzle' }, server: './server.mjs', requires: ['plugin-worker-regression'] } }));
  writeFileSync(join(consumer, 'server.mjs'), `export default api => {
    const sdk = api.services.use('plugin-worker-regression');
    api.rpc.method('check', async () => {
      const label = 'prefix ' + sdk.label(); const unsubscribe = sdk.subscribe(); const during = sdk.count(); await unsubscribe();
      return { label, during, after: sdk.count(), lazy: await sdk.lazy().then(value => value), delayed: await sdk.delayed(), version: sdk.version, hasVersion: 'version' in sdk };
    });
  }`);
  mkdirSync(join(home, '.zcc/plugins'), { recursive: true });
  const installed = (id: string, rootDir: string) => ({ id, version: '1.0.0', name: id, description: 'Fixture', icon: 'Puzzle', enabled: true, status: 'running', statusDetail: null, provenance: 'direct', sourceKind: 'path', source: rootDir, rootDir, serverEntry: './server.mjs', appEntry: null, npmResolvedVersion: null, npmIntegrity: null, gitResolvedCommit: null, catalogMarketplace: null, catalogEntryId: null, installedAt: Date.now(), updatedAt: Date.now() });
  writeFileSync(join(home, '.zcc/plugins/installed.json'), JSON.stringify({ version: 1, plugins: [installed('plugin-worker-regression', root), installed('plugin-service-consumer', consumer)] }));
  const app = await launchApp(home, { e2e: true, env: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });
  try {
    const page = app.window;
    await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'plugin-worker-regression')?.statusDetail ?? 'running')).toBe('running');
    const ready = await page.evaluate(async () => { const response = await fetch('/api/v1/plugin-apps/plugin-worker-regression/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'ready', args: {} }) }); return response.json(); });
    expect(ready).toEqual({ value: { row: { value: 'native worker' }, stored: true } });
    const semantics = await page.evaluate(async () => {
      const response = await fetch('/api/v1/plugin-apps/plugin-service-consumer/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'check', args: {} }) });
      return response.json();
    });
    expect(semantics).toEqual({ value: { label: 'prefix ready', during: 1, after: 0, lazy: 'lazy', delayed: 'async', version: 1, hasVersion: true } });
    await page.evaluate(() => { (globalThis as any).busyReply = fetch('/api/v1/plugin-apps/plugin-worker-regression/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'busy', args: {} }) }).then(async response => ({ status: response.status, body: await response.json() })); });
    await page.waitForTimeout(200);
    const latency = await page.evaluate(async () => { const start = performance.now(); const response = await fetch('/api/v1/plugins'); if (!response.ok) throw Error('Product request failed'); await response.json(); return performance.now() - start; });
    expect(latency).toBeLessThan(500);
    await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'plugin-worker-regression')?.status), { timeout: 10_000 }).toBe('degraded');
    const rejected = await page.evaluate(() => (globalThis as any).busyReply); expect(rejected.status).toBeGreaterThanOrEqual(400); expect(rejected.body.error).toContain('stopped responding');
  } finally { await app.electron.close(); }
});

test('history searches and marker lock retries keep product HTTP responsive in Electron', async ({ home }) => {
  test.setTimeout(120_000);
  const { closeApp, launchApp } = await import('./fixtures/app.js');
  const { openDatabase, createSqliteDatabase, upsertHost, createEnvironment, createConversationThread, appendConversationThreadEvent } = await import('../packages/db/src/index.js');
  const root = join(home, 'history-project'); mkdirSync(root, { recursive: true }); mkdirSync(join(home, '.zcc'), { recursive: true });
  writeFileSync(join(home, '.zcc/projects.json'), JSON.stringify({ version: 1, projects: [{ id: 'history', name: 'History project', path: root, createdAt: Date.now(), lastActiveAt: Date.now() }] }));
  const db = openDatabase(join(home, '.zcc/zcc.sqlite'));
  const hostId = upsertHost(db, { name: 'history fixture', hostKeyHash: 'f'.repeat(64) }).id;
  const environmentId = createEnvironment(db, { projectId: 'history', hostId, path: root, workspaceProvisionType: 'unmanaged', status: 'ready' }).id;
  let threadId = '';
  const payload = { event: { item: { type: 'assistantMessage', text: 'existing-content '.repeat(250) } } };
  db.transaction(() => {
    for (let i = 0; i < 100; i++) {
      const thread = createConversationThread(db, { projectId: 'history', hostId, environmentId, providerId: 'fake', title: 'History ' + i, visibility: 'visible' });
      threadId ||= thread.id;
      for (let j = 0; j < 100; j++) appendConversationThreadEvent(db, { threadId: thread.id, type: 'item/completed', payload });
    }
  }); db.close();
  const app = await launchApp(home, { e2e: true, env: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });
  let lock: ReturnType<typeof createSqliteDatabase> | undefined;
  try {
    const page = app.window;
    const search = await page.evaluate(async () => {
      let ticks = 0; const timer = setInterval(() => ticks++, 5);
      try { const response = await fetch('/api/v1/threads/history?q=absent-search-needle'); return { status: response.status, page: await response.json(), ticks }; }
      finally { clearInterval(timer); }
    });
    expect(search.status).toBe(200); expect(search.page.rows).toEqual([]); expect(search.ticks).toBeGreaterThan(0);
    lock = createSqliteDatabase(join(home, '.zcc/thread-reads.sqlite')); lock.exec('BEGIN IMMEDIATE');
    const request = page.evaluate(async id => { const start = performance.now(); const response = await fetch(`/api/v1/threads/${id}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return { status: response.status, elapsed: performance.now() - start }; }, threadId);
    await page.waitForTimeout(150);
    const latency = await page.evaluate(async () => { const start = performance.now(); const response = await fetch('/api/v1/threads/history'); if (!response.ok) throw Error('Product request failed'); await response.json(); return performance.now() - start; });
    expect(latency).toBeLessThan(500);
    lock.exec('COMMIT'); lock.close(); lock = undefined;
    const read = await request; expect(read.status).toBe(200); expect(read.elapsed).toBeGreaterThan(100);
  } finally { try { lock?.exec('ROLLBACK'); } finally { lock?.close(); await closeApp(app.electron); } }
});

test('legacy extension storage writes await persistence across the utility-process broker', async ({ home }) => {
  const { launchApp } = await import('./fixtures/app.js'); const { readFileSync } = await import('node:fs');
  const id = 'legacy-storage-regression', root = join(home, '.zcc/extensions', id); mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'extension.json'), JSON.stringify({ id, title: 'Legacy storage fixture', version: '1.0.0', icon: 'Box', engines: { zccApi: '^1.0.0' }, permissions: ['storage'], entry: { main: 'main.mjs' } }));
  writeFileSync(join(root, 'main.mjs'), `export default { id: '${id}', async setup(ctx) { await ctx.storage.set('startup', 'persisted'); return { read: async () => await ctx.storage.get('startup'), write: async value => { await ctx.storage.set('startup', value); return await ctx.storage.get('startup'); } }; } };`);
  const app = await launchApp(home, { env: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });
  try {
    await app.window.evaluate(id => window.cc.extensions.grantConsent(id, ['storage']), id);
    await expect.poll(() => app.window.evaluate(async id => { try { return await window.cc.modules.call(id, 'read', []); } catch { return null; } }, id)).toBe('persisted');
    const value = 'bounded storage '.repeat(30000);
    expect(await app.window.evaluate(({ id, value }) => window.cc.modules.call(id, 'write', [value]), { id, value })).toBe(value);
    expect(JSON.parse(readFileSync(join(home, '.zcc/modules', id + '.json'), 'utf8')).startup).toBe(value);
  } finally { await app.electron.close(); }
});

test('Explorer bounds large diffs and stays responsive when the diff worker cannot start', async ({ app }, testInfo) => {
  const { execFileSync } = await import('node:child_process');
  const { window: page, home } = app;
  const root = join(home, 'diff-budget-project'); mkdirSync(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init'); git('config', 'user.name', 'Diff fixture'); git('config', 'user.email', 'diff@example.test');
  const lines = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix} line ${i}`).join('\n');
  writeFileSync(join(root, 'large.txt'), lines('original', 4000));
  writeFileSync(join(root, 'small.txt'), lines('original', 400));
  git('add', '.'); git('commit', '-m', 'Fixture baseline');
  writeFileSync(join(root, 'large.txt'), lines('modified', 4000));
  writeFileSync(join(root, 'small.txt'), lines('modified', 400));
  await page.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw Error(result.message);
  }, root);
  const heading = page.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await page.getByRole('button', { name: 'Open diff-budget-project', exact: true }).click();
  await page.getByTestId('project-nav-explorer').click();
  await page.locator('.tree-row.file').filter({ hasText: 'large.txt' }).click();
  await expect(page.getByTitle('Show diff against HEAD', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const state = globalThis as any;
    state.originalWorker = Worker; state.failedDiffWorkers = 0; state.diffMaxGap = 0;
    let last = performance.now();
    state.diffProbeTimer = setInterval(() => { const now = performance.now(); state.diffMaxGap = Math.max(state.diffMaxGap, now - last); last = now; }, 10);
    state.Worker = class extends Worker {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (String(url).startsWith('blob:')) { state.failedDiffWorkers++; throw Error('Fixture rejects blob workers'); }
        super(url, options);
      }
    };
  });
  try {
    await page.getByTitle('Show diff against HEAD', { exact: true }).click();
    const large = page.getByRole('region', { name: 'Large diff', exact: true });
    await expect(large).toBeVisible();
    expect(await large.locator('pre').count()).toBe(2);
    expect(await large.locator('pre').evaluateAll(nodes => nodes.every(node => node.textContent!.split('\n').length <= 1001))).toBe(true);
    expect(await page.evaluate(() => (globalThis as any).failedDiffWorkers)).toBe(0);
    await page.locator('.tree-row.file').filter({ hasText: 'small.txt' }).click();
    await expect(large).toHaveCount(0);
    const diff = page.locator('.agent-diff-viewer');
    await expect(diff).toContainText('modified line');
    await expect.poll(() => page.evaluate(() => (globalThis as any).failedDiffWorkers)).toBeGreaterThan(0);
    expect(await diff.locator('tr').count()).toBeLessThan(200);
    const measured = await page.evaluate(() => ({ maxTimerGapMs: (globalThis as any).diffMaxGap, failedWorkers: (globalThis as any).failedDiffWorkers }));
    await testInfo.attach('diff-worker-fallback-responsive.json', { body: JSON.stringify(measured, null, 2), contentType: 'application/json' });
    expect(measured.maxTimerGapMs).toBeLessThan(500);
  } finally {
    await page.evaluate(() => { const state = globalThis as any; clearInterval(state.diffProbeTimer); state.Worker = state.originalWorker; });
  }
});
