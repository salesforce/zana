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
    await app.window.getByRole('button', { name: 'Open another Zana…', exact: true }).click();
    const picker = app.window.getByRole('region', { name: 'Zana instances' });
    await picker.getByRole('button', { name: 'Sign in to browse Zanas', exact: true }).click();
    await expect(picker.getByRole('status')).toContainText('your browser');
    await expect.poll(() => app.electron.evaluate(() => (globalThis as any).__desktopSignIn.opened)).toEqual([`https://zana-ide.com/connect/?desktop=${'u'.repeat(22)}`]);
    expect(await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => win.id))).toEqual(windowIds);
    await app.electron.evaluate(() => { (globalThis as any).__desktopSignIn.approved = true; });
    await expect(picker.getByText('Browser signed-in instance')).toBeVisible({ timeout: 15_000 });
    await expect(picker.getByRole('status')).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'Sign in to browse Zanas', exact: true })).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'Refresh instances', exact: true })).toBeEnabled();
    expect(await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => win.id))).toEqual(windowIds);
    await app.window.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await app.window.getByRole('link', { name: 'Remote access', exact: true }).click();
    await expect(app.window.locator('.instance-menu > summary')).toBeVisible();
    await app.window.getByRole('combobox', { name: 'Search settings' }).fill('Open another Zana');
    await app.window.getByRole('option').filter({ hasText: 'Open another Zana' }).click();
    await expect(app.window.getByRole('dialog', { name: 'Open another Zana', exact: true })).toBeVisible();
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
      isolated.protocol.handle('https', request => {
        const url = new URL(request.url);
        if (url.hostname === 'zana-ide.com' && url.pathname === '/api/connect/account') return Response.json({ servers: [{ id: ids.serverId, instanceId: ids.instanceId, name: 'Shared fixture', browserUrl: 'https://shared-fixture.zana-ide.com', live: true }] });
        if (url.hostname === 'shared-fixture.zana-ide.com') return new Response('<!doctype html><title>Shared fixture</title><h1>Shared fixture</h1><p id="bridge"></p><script>document.querySelector("#bridge").textContent=typeof window.cc</script>', { headers: { 'content-type': 'text/html' } });
        return new Response('Denied', { status: 403 });
      });
    }, { serverId, instanceId });
    const instances = await app.window.evaluate(() => window.cc.sharedClient.list());
    expect(instances).toEqual([{ id: serverId, instanceId, name: 'Shared fixture', url: 'https://shared-fixture.zana-ide.com', online: true }]);
    await expect(app.window.evaluate(() => window.cc.sharedClient.select('https://evil.example'))).rejects.toThrow('unavailable');
    await app.window.locator('.instance-menu > summary').click();
    await app.window.getByRole('button', { name: 'Open another Zana…', exact: true }).click();
    await app.window.getByRole('region', { name: 'Zana instances' }).getByRole('button', { name: 'Open Zana', exact: true }).click();
    const shared = await sharedInstancePage(app, 'https://shared-fixture.zana-ide.com');
    await expect(shared.getByRole('heading', { name: 'Shared fixture' })).toBeVisible();
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
