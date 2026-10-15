import { createServer } from 'node:http';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true });

test('login popups retain delayed navigation, opener messages, POST and native close without duplicate tabs', async ({ app }) => {
  let origin = '';
  let postBody = '';
  const callback = (title: string) => `<!doctype html><title>${title}</title><h1>${title}</h1>
    <button id="done">Complete login</button><script>document.querySelector('#done').onclick=()=>{window.opener.postMessage('authenticated', ${JSON.stringify(origin)}); window.close();};</script>`;
  const server = createServer((request, response) => {
    if (request.url === '/provider') {
      response.writeHead(302, { location: origin + '/callback' });
      response.end();
    } else if (request.url === '/callback') {
      response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'popup_auth=ok; Path=/; SameSite=Lax' });
      response.end(callback('Popup callback'));
    } else if (request.url === '/post-login') {
      request.setEncoding('utf8');
      request.on('data', chunk => { postBody += chunk; });
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(callback('POST callback'));
      });
    } else {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<!doctype html><title>Login fixture</title><h1>Login fixture</h1>
        <button id="login">Login</button>
        <form method="POST" action="/post-login" target="post-login"><input name="test_code" value="fixture-only"><button id="post">POST login</button></form>
        <output>Idle</output><script>
        addEventListener('error', event => { window.popupError=event.message; });
        document.querySelector('#login').onclick=()=>{window.authPopup=window.open('', 'login', 'popup,width=600,height=500'); document.querySelector('output').textContent=authPopup?'Waiting':'Blocked'; setTimeout(() => { window.delayFired=true; if(authPopup) authPopup.location.href=${JSON.stringify(origin.replace('127.0.0.1', 'localhost') + '/provider')}; }, 150);};
        addEventListener('message', event => { if(event.origin===location.origin) document.querySelector('output').textContent=event.data; });</script>`);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing popup fixture port');
  origin = `http://127.0.0.1:${address.port}`;
  const threadId = 'thr_abcdefghij';
  const execute = (command: Record<string, unknown>) => app.electron.evaluate(async (_electron, command) => {
    const broker = (globalThis as { __zccDesktopBrowserBroker?: {
      listInstances(): Array<{ instanceId: string; generation: string }>;
      execute(command: Record<string, unknown>): Promise<any>;
    } }).__zccDesktopBrowserBroker!;
    const instance = broker.listInstances()[0]!;
    return broker.execute({ ...command, instanceId: instance.instanceId, generation: instance.generation, threadId: 'thr_abcdefghij' });
  }, command);
  const pageScript = (url: string, script: string) => app.electron.evaluate(async ({ webContents }, input) => {
    const page = webContents.getAllWebContents().find(wc => wc.getURL() === input.url);
    if (!page) return null;
    return page.executeJavaScript(input.script, true);
  }, { url, script });
  const panelIds = () => app.window.evaluate(() => {
    const raw = localStorage.getItem('zcc.secondaryPanel.thr_abcdefghij');
    return raw ? JSON.parse(raw).tabs.filter((tab: { kind: string }) => tab.kind === 'browser').map((tab: { id: string }) => tab.id) : [];
  });
  try {
    await expect(app.window.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 20_000 });
    await app.window.evaluate(() => { history.pushState({}, '', '/threads/thr_abcdefghij'); dispatchEvent(new PopStateEvent('popstate')); });
    await expect(app.window.getByTestId('thread-detail')).toBeVisible();
    await execute({ type: 'desktop.browser.create_tab', tabId: 'popup-parent', profile: { kind: 'personal' }, url: origin + '/', presentation: 'reveal' });
    await expect.poll(() => pageScript(origin + '/', 'document.title')).toBe('Login fixture');
    await expect.poll(panelIds).toEqual(['popup-parent']);
    await expect(app.window.getByTestId('thread-browser-tab')).toBeVisible();
    expect(await pageScript(origin + '/', "document.querySelector('#login').click(); document.querySelector('output').textContent")).toBe('Waiting');
    await expect.poll(() => pageScript(origin + '/callback', 'document.title')).toBe('Popup callback');
    await expect.poll(async () => (await panelIds()).length).toBe(2);
    const childIds = (await panelIds()).filter((id: string) => id !== 'popup-parent');
    expect(childIds).toHaveLength(1);
    const tabs = (await execute({ type: 'desktop.browser.list_tabs' })).tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs.every((tab: { profile: { kind: string } }) => tab.profile.kind === 'personal')).toBe(true);
    // Reopening a named login window must return the same WindowProxy/tab.
    expect(await pageScript(origin + '/', "window.open('', 'login') === window.authPopup")).toBe(true);
    expect((await execute({ type: 'desktop.browser.list_tabs' })).tabs).toHaveLength(2);
    expect(await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await pageScript(origin + '/callback', "setTimeout(() => document.querySelector('#done').click(), 100); true");
    await expect.poll(() => pageScript(origin + '/', "document.querySelector('output').textContent")).toBe('authenticated');
    expect(await pageScript(origin + '/', 'document.cookie')).toContain('popup_auth=ok');
    await expect.poll(panelIds).toEqual(['popup-parent']);
    await expect.poll(async () => (await execute({ type: 'desktop.browser.list_tabs' })).tabs.length).toBe(1);

    await execute({ type: 'desktop.browser.reveal_tab', tabId: 'popup-parent' });
    await expect(app.window.getByTestId('thread-browser-tab')).toBeVisible();
    await pageScript(origin + '/', "document.querySelector('#post').click(); void 0");
    await expect.poll(() => pageScript(origin + '/post-login', 'document.title')).toBe('POST callback');
    expect(postBody).toBe('test_code=fixture-only');
    await expect.poll(async () => (await panelIds()).length).toBe(2);
    await pageScript(origin + '/post-login', "setTimeout(() => document.querySelector('#done').click(), 100); true");
    await expect.poll(panelIds).toEqual(['popup-parent']);
    expect((await execute({ type: 'desktop.browser.list_tabs' })).tabs).toHaveLength(1);
    expect(await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  } finally {
    const tabs = (await execute({ type: 'desktop.browser.list_tabs' }).catch(() => ({ tabs: [] }))).tabs;
    console.log('Popup lifecycle cleanup', JSON.stringify(tabs));
    console.log('Popup parent state', await pageScript(origin + '/', "JSON.stringify({ output: document.querySelector('output').textContent, popup: !!window.authPopup, closed: window.authPopup?.closed, delayFired: window.delayFired, error: window.popupError })"));
    for (const tab of tabs) await execute({ type: 'desktop.browser.close_tab', tabId: tab.tabId }).catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
