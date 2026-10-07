/**
 * Built-Electron production boundary for the desktop-browser broker:
 * create a tab, acquire a control lease, open loopback CDP, and reveal only
 * when that thread is focused. Cookie values never leave main — this spec
 * only lists import sources against the sandboxed HOME (not the developer's
 * real Chrome). Fixture-DB decrypt/write coverage lives in
 * `apps/desktop/src/browser-import/browser-import.test.ts`.
 */
import { WebSocket } from 'ws';
import { createServer } from 'node:http';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true });

const THREAD_ID = 'thr_abcdefghij';

function createAndActivateTarget(wsEndpoint: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(wsEndpoint);
    const timer = setTimeout(() => { ws.terminate(); reject(Error('hidden CDP page timed out')); }, 10_000);
    let targetId = '';
    ws.once('error', error => { clearTimeout(timer); reject(error); });
    ws.on('message', data => {
      const response = JSON.parse(String(data));
      if (response.error) { clearTimeout(timer); ws.close(); reject(Error(JSON.stringify(response.error))); return; }
      if (response.id === 1) {
        targetId = response.result.targetId;
        ws.send(JSON.stringify({ id: 2, method: 'Target.activateTarget', params: { targetId } }));
      } else if (response.id === 2) { clearTimeout(timer); ws.close(); resolve(targetId); }
    });
    ws.once('open', () => ws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank' } })));
  });
}


test('desktop browser broker leases loopback CDP and reveals a focused thread', async ({ app }) => {
  const { window, electron } = app;
  await expect(window.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 20_000 });

  const created = await electron.evaluate(async (_electron, threadId) => {
    const broker = (globalThis as { __zccDesktopBrowserBroker?: {
      listInstances: () => Array<{ instanceId: string; generation: string }>;
      execute: (command: Record<string, unknown>) => Promise<Record<string, unknown>>;
    } }).__zccDesktopBrowserBroker;
    if (!broker) throw new Error('desktop browser broker tap missing (ZCC_E2E)');
    const [instance] = broker.listInstances();
    if (!instance) throw new Error('no desktop window registered with the broker');
    const tabId = `browser:e2e-${Date.now()}`;
    await broker.execute({
      type: 'desktop.browser.create_tab',
      instanceId: instance.instanceId,
      generation: instance.generation,
      threadId,
      tabId,
      url: 'about:blank',
      profile: { kind: 'automation', id: tabId },
      presentation: 'hidden'
    });
    const leaseId = `lease-e2e-${Date.now()}`;
    const expiresAt = Date.now() + 60_000;
    await broker.execute({
      type: 'desktop.browser.acquire_control',
      instanceId: instance.instanceId,
      generation: instance.generation,
      threadId,
      leaseId,
      tabIds: [tabId],
      controllerLabel: 'E2E',
      expiresAt
    });
    const connection = await broker.execute({
      type: 'desktop.browser.open_connection',
      instanceId: instance.instanceId,
      generation: instance.generation,
      threadId,
      leaseId,
      tabIds: [tabId]
    });
    return {
      instanceId: instance.instanceId,
      generation: instance.generation,
      tabId,
      leaseId,
      wsEndpoint: String(connection.wsEndpoint ?? '')
    };
  }, THREAD_ID);

  expect(created.wsEndpoint).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/cdp\/[a-f0-9]{64}$/);

  const version = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const ws = new WebSocket(created.wsEndpoint);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('CDP Browser.getVersion timed out'));
    }, 10_000);
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    ws.once('message', (data) => {
      clearTimeout(timer);
      // The capability permits one socket at a time. Wait for the close
      // handshake before reconnecting to exercise Target.createTarget.
      ws.once('close', () => resolve(JSON.parse(String(data)) as Record<string, unknown>));
      ws.close();
    });
    ws.once('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }));
    });
  });
  expect(version).toMatchObject({
    id: 1,
    result: expect.objectContaining({
      product: expect.stringMatching(/Chrome/i)
    })
  });

  const createdTarget = await createAndActivateTarget(created.wsEndpoint);
  expect(createdTarget).toBeTruthy();
  await expect(window.getByTestId('thread-browser-tab')).toHaveCount(0);
  const hiddenTabs = await electron.evaluate(async (_electron, scope) => {
    const broker = (globalThis as any).__zccDesktopBrowserBroker;
    return (await broker.execute({ type: 'desktop.browser.list_tabs', instanceId: scope.instanceId, generation: scope.generation, threadId: scope.threadId })).tabs;
  }, { ...created, threadId: THREAD_ID });
  expect(hiddenTabs).toHaveLength(2);
  expect(hiddenTabs.every((tab: { presentation: string }) => tab.presentation === 'hidden')).toBe(true);


  await window.evaluate((threadId) => {
    window.history.pushState({}, '', `/threads/${threadId}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, THREAD_ID);
  await expect(window.getByTestId('thread-detail')).toBeVisible({ timeout: 15_000 });

  await electron.evaluate(async (_electron, args) => {
    const broker = (globalThis as { __zccDesktopBrowserBroker?: {
      execute: (command: Record<string, unknown>) => Promise<unknown>;
    } }).__zccDesktopBrowserBroker;
    if (!broker) throw new Error('desktop browser broker tap missing (ZCC_E2E)');
    await broker.execute({
      type: 'desktop.browser.reveal_tab',
      instanceId: args.instanceId,
      generation: args.generation,
      threadId: args.threadId,
      tabId: args.tabId
    });
  }, { ...created, threadId: THREAD_ID });

  await expect(window.getByTestId('thread-browser-tab')).toBeVisible({ timeout: 10_000 });

  // A remote lease cannot derive presentation permission from a page that a
  // desktop user had already revealed before this conversation was upgraded.
  const remoteEndpoint = await electron.evaluate(async (_electron, scope) => {
    const broker = (globalThis as any).__zccDesktopBrowserBroker;
    const target = { instanceId: scope.instanceId, generation: scope.generation, threadId: scope.threadId };
    await broker.execute({ type: 'desktop.browser.release_control', ...target, leaseId: scope.leaseId });
    const leaseId = scope.leaseId + '-remote';
    await broker.execute({ type: 'desktop.browser.acquire_control', ...target, leaseId,
      tabIds: [scope.tabId], controllerLabel: 'Remote E2E', expiresAt: Date.now() + 60_000, allowPresentation: false });
    return (await broker.execute({ type: 'desktop.browser.open_connection', ...target, leaseId, tabIds: [scope.tabId] })).wsEndpoint as string;
  }, { ...created, threadId: THREAD_ID });
  const remoteTarget = await createAndActivateTarget(remoteEndpoint);
  expect(remoteTarget).toBeTruthy();
  const remoteTabs = await electron.evaluate(async (_electron, scope) => {
    const broker = (globalThis as any).__zccDesktopBrowserBroker;
    return (await broker.execute({ type: 'desktop.browser.list_tabs', instanceId: scope.instanceId,
      generation: scope.generation, threadId: scope.threadId })).tabs;
  }, { ...created, threadId: THREAD_ID });
  expect(remoteTabs).toHaveLength(3);
  // about:blank may have no attached native view even though its desktop tab
  // is open. New pages must remain hidden regardless of that source state.
  expect(remoteTabs.filter((tab: { tabId: string }) => tab.tabId !== created.tabId)
    .every((tab: { presentation: string }) => tab.presentation === 'hidden')).toBe(true);
  await expect(window.getByTestId('thread-browser-tab')).toHaveCount(1);

  const sources = await electron.evaluate(async () => {
    const broker = (globalThis as { __zccDesktopBrowserBroker?: {
      listInstances: () => Array<{ instanceId: string; generation: string }>;
      execute: (command: Record<string, unknown>) => Promise<Record<string, unknown>>;
    } }).__zccDesktopBrowserBroker;
    if (!broker) throw new Error('desktop browser broker tap missing (ZCC_E2E)');
    const [instance] = broker.listInstances();
    if (!instance) throw new Error('no desktop window registered with the broker');
    return broker.execute({
      type: 'desktop.browser.list_import_sources',
      instanceId: instance.instanceId,
      generation: instance.generation
    });
  });
  const listed = Array.isArray((sources as { sources?: unknown }).sources)
    ? (sources as { sources: Array<Record<string, unknown>> }).sources
    : [];
  for (const source of listed) {
    expect(source).not.toHaveProperty('cookies');
    expect(JSON.stringify(source)).not.toMatch(/encrypted_value|cookieValue|"value":"[^"]{8,}"/);
    expect(typeof source.name).toBe('string');
    expect(typeof source.id).toBe('string');
  }
});

test('equivalent previews reuse their page without crossing browser profiles', async ({ app }) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><body>Persistent preview</body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server port');
  const url = `http://127.0.0.1:${address.port}/`;
  const execute = (command: Record<string, unknown>) => app.electron.evaluate(async (_electron, command) => {
    const broker = (globalThis as { __zccDesktopBrowserBroker?: {
      listInstances: () => Array<{ instanceId: string; generation: string }>;
      execute: (command: Record<string, unknown>) => Promise<Record<string, unknown>>;
    } }).__zccDesktopBrowserBroker;
    if (!broker) throw new Error('Missing desktop broker');
    const [instance] = broker.listInstances();
    return broker.execute({ ...instance, ...command });
  }, { threadId: THREAD_ID, ...command });
  const create = (tabId: string, profile: { kind: 'personal' } | { kind: 'automation'; id: string }, nextUrl = url) => execute({
    type: 'desktop.browser.create_tab', tabId, profile, url: nextUrl, presentation: 'hidden'
  });
  try {
    await create('personal', { kind: 'personal' });
    await expect.poll(async () => (await execute({ type: 'desktop.browser.list_tabs' })).tabs).toEqual([
      expect.objectContaining({ tabId: 'personal', url })
    ]);
    // The same local server with a different host spelling and route keeps its
    // existing page. In particular, this must not reload and lose hot-reload state.
    const duplicateUrl = `http://localhost:${address.port}/client-route`;
    await expect(create('duplicate', { kind: 'personal' }, duplicateUrl)).resolves.toMatchObject({ tab: { tabId: 'personal', url } });
    await expect(create('automation-a', { kind: 'automation', id: 'run-a' })).resolves.toMatchObject({ tab: { tabId: 'automation-a' } });
    await expect(create('automation-b', { kind: 'automation', id: 'run-b' })).resolves.toMatchObject({ tab: { tabId: 'automation-b' } });
    const pages = () => app.electron.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .filter(contents => contents.getURL() === url)
      .map(contents => ({ id: contents.id, loading: contents.isLoading() })), url);
    await expect.poll(pages).toEqual([
      expect.objectContaining({ loading: false }), expect.objectContaining({ loading: false }), expect.objectContaining({ loading: false })
    ]);
    const before = await pages();
    // Hidden page popups must not escape automation through renderer IPC.
    await app.window.evaluate(() => {
      const probe = { events: [] as string[], dispose: () => {} };
      const off = window.cc.browser.onOpenTab(event => probe.events.push(event.url));
      const offScoped = window.cc.browser.onScopedOpenTab?.(event => probe.events.push(event.url));
      probe.dispose = () => { off(); offScoped?.(); };
      (window as any).__hiddenPopupProbe = probe;
    });
    try {
      await app.electron.evaluate(async ({ webContents }, url) => {
        const source = webContents.getAllWebContents().find(contents => contents.getURL() === url);
        if (!source) throw Error('Missing hidden popup source');
        await source.executeJavaScript("window.open('http://127.0.0.1:1/hidden-popup'); void 0");
      }, url);
      expect(await app.window.evaluate(() => (window as any).__hiddenPopupProbe.events)).toEqual([]);
    } finally {
      await app.window.evaluate(() => {
        (window as any).__hiddenPopupProbe.dispose();
        delete (window as any).__hiddenPopupProbe;
      });
    }
    const requestsBefore = requests;
    await execute({ type: 'desktop.browser.acquire_control', leaseId: 'preview-lease', tabIds: ['automation-a'], controllerLabel: 'Preview regression', expiresAt: Date.now() + 60_000 });
    const connection = await execute({ type: 'desktop.browser.open_connection', leaseId: 'preview-lease', tabIds: ['automation-a'] });
    const createTarget = (endpoint: unknown) => new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(String(endpoint));
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('CDP create target timed out')); }, 10_000);
      ws.once('error', error => { clearTimeout(timer); reject(error); });
      ws.once('open', () => ws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: duplicateUrl } })));
      ws.once('message', data => {
        clearTimeout(timer);
        ws.close();
        const body = JSON.parse(String(data));
        if (body.error) reject(new Error(JSON.stringify(body.error)));
        else resolve();
      });
    });
    await createTarget(connection.wsEndpoint);
    const listed = await execute({ type: 'desktop.browser.list_tabs' });
    expect(listed.tabs).toHaveLength(3);
    expect(await pages()).toEqual(before);
    expect(requests).toBe(requestsBefore);

    // A second controller of the SAME automation profile must also get its
    // own page; URL reuse cannot silently steal a tab from an existing lease.
    await create('second-controller', { kind: 'automation', id: 'run-a' }, 'about:blank');
    await execute({ type: 'desktop.browser.acquire_control', leaseId: 'other-lease', tabIds: ['second-controller'], controllerLabel: 'Other controller', expiresAt: Date.now() + 60_000 });
    const other = await execute({ type: 'desktop.browser.open_connection', leaseId: 'other-lease', tabIds: ['second-controller'] });
    await createTarget(other.wsEndpoint);
    const controlled = (await execute({ type: 'desktop.browser.list_tabs' })).tabs as Array<{ tabId: string; control: { leaseId: string } | null }>;
    expect(controlled).toHaveLength(5);
    expect(controlled.find(tab => tab.tabId === 'automation-a')?.control?.leaseId).toBe('preview-lease');
    expect(controlled.filter(tab => tab.control?.leaseId === 'other-lease')).toHaveLength(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


test('native downloads require a visible personal tab without a control lease', async ({ app }) => {
  const server = createServer((request, response) => {
    if (request.url === '/download') {
      response.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="fixture.txt"' });
      response.end('native download fixture');
    } else { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<p>Download fixture</p>'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const execute = (command: Record<string, unknown>) => app.electron.evaluate(async (_electron, command) => {
    const broker = (globalThis as any).__zccDesktopBrowserBroker;
    const [instance] = broker.listInstances();
    return broker.execute({ ...instance, threadId: 'thr_abcdefghij', ...command });
  }, command);
  const download = (pageUrl: string) => app.electron.evaluate(async ({ webContents }, pageUrl) => {
    const contents = webContents.getAllWebContents().find(row => row.getURL() === pageUrl);
    if (!contents) throw Error('Download tab missing');
    return new Promise(resolve => {
      const timer = setTimeout(() => rejectDownload(), 10000);
      const rejectDownload = () => { contents.session.removeListener('will-download', observe); resolve({ timeout: true }); };
      const observe = (event: Electron.Event, item: Electron.DownloadItem) => {
        clearTimeout(timer); contents.session.removeListener('will-download', observe);
        if (event.defaultPrevented) { resolve({ blocked: true }); return; }
        const options = item.getSaveDialogOptions(); item.cancel();
        resolve({ blocked: false, title: options.title });
      };
      contents.session.on('will-download', observe);
      contents.downloadURL(new URL('/download', pageUrl).href);
    });
  }, pageUrl);
  try {
    await execute({ type: 'desktop.browser.create_tab', tabId: 'download-personal', profile: { kind: 'personal' }, url, presentation: 'hidden' });
    await expect.poll(() => app.electron.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(row => row.getURL() === url && !row.isLoading()), url)).toBe(true);
    expect(await download(url)).toEqual({ blocked: true });
    await app.window.evaluate(() => { history.pushState({}, '', '/threads/thr_abcdefghij'); dispatchEvent(new PopStateEvent('popstate')); });
    await expect(app.window.getByTestId('thread-detail')).toBeVisible();
    await execute({ type: 'desktop.browser.reveal_tab', tabId: 'download-personal' });
    await expect(app.window.getByTestId('thread-browser-tab')).toBeVisible();
    await expect.poll(() => app.electron.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().some(win => win.contentView.children.some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === url && view.getVisible())), url)).toBe(true);
    expect(await download(url)).toEqual({ blocked: false, title: 'Save downloaded file' });
    await execute({ type: 'desktop.browser.acquire_control', leaseId: 'download-lease', tabIds: ['download-personal'], controllerLabel: 'Download regression', expiresAt: Date.now() + 60000 });
    expect(await download(url)).toEqual({ blocked: true });
    await execute({ type: 'desktop.browser.create_tab', tabId: 'download-automation', profile: { kind: 'automation', id: 'download-run' }, url: url + '?automation', presentation: 'hidden' });
    await expect.poll(() => app.electron.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(row => row.getURL() === url && !row.isLoading()), url + '?automation')).toBe(true);
    expect(await download(url + '?automation')).toEqual({ blocked: true });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
