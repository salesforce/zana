import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { test, expect, launchApp } from './fixtures/app.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sharedInstancePage } from './fixtures/shared-instance.js';

test('shared sign-in opens the system browser without a popup and refreshes instances after approval', async ({ home }, testInfo) => {
  test.setTimeout(180_000);
  const app = await launchApp(home);
  const serverId = randomUUID(), instanceId = randomUUID();
  try {
    const windowIds = await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => win.id));
    await app.electron.evaluate(({ session, shell }, ids) => {
      const state = { opened: [] as string[], approved: false };
      (globalThis as any).__desktopSignIn = state;
      shell.openExternal = async url => { state.opened.push(url); };
      const isolated = session.fromPartition('persist:zcc-shared-account');
      isolated.protocol.handle('https', async request => {
        const url = new URL(request.url);
        if (url.origin !== 'https://zana-ide.com') return new Response('Denied', { status: 403 });
        // Reproduce the production failure: service clock slightly ahead of desktop.
        if (url.pathname === '/api/connect/desktop/start/') return Response.json({ userCode: 'u'.repeat(22), deviceCode: 'd'.repeat(43), expiresAt: Date.now() + 600_250 });
        if (url.pathname === '/api/connect/desktop/poll/') {
          if ((await request.json()).deviceCode !== 'd'.repeat(43)) return new Response('Denied', { status: 403 });
          return Response.json(state.approved ? { cookieValue: `${'s'.repeat(43)}.${'h'.repeat(43)}`, expiresAt: Date.now() + 30 * 86400_000 + 250 } : { pending: true });
        }
        if (url.pathname === '/api/connect/account') {
          const cookies = await isolated.cookies.get({ url: url.origin, name: 'zcc_session' });
          if (!cookies.some(cookie => cookie.value === `${'s'.repeat(43)}.${'h'.repeat(43)}` && cookie.httpOnly && cookie.secure)) return new Response('Sign in', { status: 401 });
          return Response.json({ servers: [{ id: ids.serverId, instanceId: ids.instanceId, name: 'Browser signed-in instance', browserUrl: 'https://owned.zana-ide.com', live: true }] });
        }
        return new Response('Denied', { status: 403 });
      });
    }, { serverId, instanceId });
    await app.window.locator('.instance-menu > summary').click();
    await app.window.getByRole('button', { name: 'Open another computer…', exact: true }).click();
    const picker = app.window.getByRole('region', { name: 'Zana instances' });
    await picker.getByRole('button', { name: 'Sign in to find your computers', exact: true }).click();
    await expect(picker.getByRole('status')).toContainText('your browser');
    await expect.poll(() => app.electron.evaluate(() => (globalThis as any).__desktopSignIn.opened)).toEqual([`https://zana-ide.com/connect/?desktop=${'u'.repeat(22)}`]);
    expect(await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => win.id))).toEqual(windowIds);
    await app.electron.evaluate(() => { (globalThis as any).__desktopSignIn.approved = true; });
    await expect(picker.getByText('Browser signed-in instance')).toBeVisible({ timeout: 15_000 });
    await expect(picker.getByRole('status')).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'Sign in to find your computers', exact: true })).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'Refresh computers', exact: true })).toBeEnabled();
    expect(await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => win.id))).toEqual(windowIds);
    await app.window.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await app.window.getByRole('link', { name: 'Remote access', exact: true }).click();
    await expect(app.window.locator('.instance-menu > summary')).toBeVisible();
    await app.window.getByRole('combobox', { name: 'Search settings' }).fill('Open another computer');
    await app.window.getByRole('option').filter({ hasText: 'Open another computer' }).click();
    await expect(app.window.getByRole('dialog', { name: 'Open another computer', exact: true })).toBeVisible();
    await expect(app.window.getByRole('region', { name: 'Zana instances' }).getByText('Browser signed-in instance')).toBeVisible();
    await captureElectronScreenshot(app.electron, app.window, testInfo.outputPath('open-another-zana-from-settings.png'));
    await app.window.evaluate(() => window.cc.sharedClient.signOut());
    expect(await app.electron.evaluate(({ session }) => session.fromPartition('persist:zcc-shared-account').cookies.get({ name: 'zcc_session' }))).toEqual([]);
  } finally { await app.electron.close(); }
});

test('shared desktop targets are account-selected, isolated from local IPC, and preserve local project state', async ({ home }) => {
  test.setTimeout(180_000);
  const app = await launchApp(home);
  const serverId = randomUUID(), instanceId = randomUUID();
  try {
    const before = await app.window.evaluate(() => window.cc.projects.list());
    await app.electron.evaluate(({ session }, ids) => {
      const isolated = session.fromPartition('persist:zcc-shared-account');
      const state = { paths: [] as string[], handoffCookie: false, callback: false };
      (globalThis as any).__directHandoff = state;
      const intent = `1790000000000.${'i'.repeat(43)}`;
      isolated.protocol.handle('https', async request => {
        const url = new URL(request.url);
        state.paths.push(url.pathname);
        if (url.hostname === 'zana-ide.com' && url.pathname === '/api/connect/account') return Response.json({ servers: [{ id: ids.serverId, instanceId: ids.instanceId, name: 'Shared fixture', browserUrl: 'https://shared-fixture.zana-ide.com', live: true }] });
        if (url.hostname === 'zana-ide.com' && url.pathname === '/api/connect/browser/open/' && request.method === 'POST') {
          const body = await request.json();
          if (body.serverId !== ids.serverId || request.headers.get('origin') !== url.origin) return new Response('Denied', { status: 403 });
          // Electron's protocol fixtures bypass Chromium's HTTP cookie processing.
          // Emulate that transport here; phone-connect-account covers real HTTPS.
          await isolated.cookies.set({ url: url.origin, name: 'zcc_connect_open', value: 'one-use-proof', secure: true, httpOnly: true, sameSite: 'lax', path: '/' });
          return Response.json({ location: `https://shared-fixture.zana-ide.com/_connect/login?intent=${intent}` }, { headers: { 'set-cookie': 'zcc_connect_open=one-use-proof; Secure; HttpOnly; SameSite=Lax; Path=/' } });
        }
        if (url.hostname === 'shared-fixture.zana-ide.com' && url.pathname === '/_connect/login') return new Response(null, { status: 303, headers: { location: `https://zana-ide.com/api/connect/browser/open/?code=fixture&intent=${url.searchParams.get('intent')}` } });
        if (url.hostname === 'zana-ide.com' && url.pathname === '/api/connect/browser/open/' && request.method === 'GET') {
          state.handoffCookie = (await isolated.cookies.get({ url: url.origin, name: 'zcc_connect_open' })).some(cookie => cookie.value === 'one-use-proof' && cookie.httpOnly && cookie.secure);
          if (!state.handoffCookie || url.searchParams.get('intent') !== intent) return new Response('Invalid browser state', { status: 403 });
          await isolated.cookies.remove(url.origin, 'zcc_connect_open');
          return new Response(null, { status: 303, headers: { location: 'https://shared-fixture.zana-ide.com/_connect/callback?code=fixture', 'set-cookie': 'zcc_connect_open=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' } });
        }
        if (url.hostname === 'shared-fixture.zana-ide.com' && url.pathname === '/_connect/callback') {
          state.callback = true;
          await isolated.cookies.set({ url: url.origin, name: 'zcc_connect_session', value: 'remote-session-proof', secure: true, httpOnly: true, sameSite: 'lax', path: '/' });
          return new Response(null, { status: 303, headers: { location: url.origin + '/', 'set-cookie': 'zcc_connect_session=remote-session-proof; Secure; HttpOnly; SameSite=Lax; Path=/' } });
        }
        if (url.hostname === 'shared-fixture.zana-ide.com') return new Response('<!doctype html><title>Shared fixture</title><h1>Shared fixture</h1><p id="bridge"></p><script>document.querySelector("#bridge").textContent=typeof window.cc</script>', { headers: { 'content-type': 'text/html' } });
        return new Response('Denied', { status: 403 });
      });
    }, { serverId, instanceId });
    const instances = await app.window.evaluate(() => window.cc.sharedClient.list());
    expect(instances).toEqual([{ id: serverId, instanceId, name: 'Shared fixture', url: 'https://shared-fixture.zana-ide.com', online: true }]);
    await expect(app.window.evaluate(() => window.cc.sharedClient.select('https://evil.example'))).rejects.toThrow('unavailable');
    await app.window.locator('.instance-menu > summary').click();
    await app.window.getByRole('button', { name: 'Open another computer…', exact: true }).click();
    await app.window.getByRole('region', { name: 'Zana instances' }).getByRole('button', { name: 'Open computer', exact: true }).click();
    const shared = await sharedInstancePage(app, 'https://shared-fixture.zana-ide.com');
    await expect(shared.getByRole('heading', { name: 'Shared fixture' })).toBeVisible();
    expect(await app.electron.evaluate(() => (globalThis as any).__directHandoff)).toMatchObject({ handoffCookie: true, callback: true });
    expect(await app.electron.evaluate(() => (globalThis as any).__directHandoff.paths)).not.toContain('/connect/');
    expect(await app.electron.evaluate(({ session }) => session.fromPartition('persist:zcc-shared-account').cookies.get({ url: 'https://shared-fixture.zana-ide.com', name: 'zcc_connect_session' }))).toEqual([expect.objectContaining({ value: 'remote-session-proof', secure: true, httpOnly: true })]);
    expect(await shared.evaluate(() => typeof window.cc)).toBe('undefined');
    expect(await shared.evaluate(() => typeof (window as any).require)).toBe('undefined');
    const preferences = await app.electron.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(row => row.webContents.getURL().startsWith('https://shared-fixture.'))!;
      const preferences = win.webContents.getLastWebPreferences();
      return { preload: preferences.preload, nodeIntegration: preferences.nodeIntegration, sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation };
    });
    expect(preferences).toMatchObject({ nodeIntegration: false, sandbox: true, contextIsolation: true });
    expect(preferences.preload).toBeFalsy();
    expect(JSON.parse(readFileSync(join(home, '.zcc/shared-target.json'), 'utf8'))).toEqual({ kind: 'connect', serverId, instanceId });
    await app.window.evaluate(() => window.cc.sharedClient.local());
    expect(await app.window.evaluate(() => window.cc.projects.list())).toEqual(before);
    expect(JSON.parse(readFileSync(join(home, '.zcc/shared-target.json'), 'utf8'))).toEqual({ kind: 'local' });
  } finally { await app.electron.close(); }
});
