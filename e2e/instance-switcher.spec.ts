import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { test, expect, launchApp } from './fixtures/app.js';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sharedChromePage, sharedInstancePage } from './fixtures/shared-instance.js';

type App = Awaited<ReturnType<typeof launchApp>>;
// Both documents are driven with real renderer input; the remote page never
// receives a preload or an action bridge.
async function chromeText(app: App) {
  return (await sharedChromePage(app)).locator('body').innerText();
}
async function chromeClick(app: App, label: string) {
  await (await sharedChromePage(app)).getByRole('button', { name: label, exact: true }).click();
}
async function chromeToggle(app: App) {
  const chrome = await sharedChromePage(app);
  await chrome.getByRole('button', { name: /^Zana switcher:/ }).click();
  await expect(chrome.getByRole('button', { name: 'Return to this computer', exact: true })).toBeVisible();
}
async function capture(app: App, file: string) {
  // BrowserWindow.capturePage captures the primary document. Save the native
  // toolbar separately as well; it must not be represented as part of that page.
  await (await sharedChromePage(app)).screenshot({ path: file.replace('.png', '-controls.png') });
  const image = await app.electron.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(row => row.webContents.getURL().startsWith('https://studio-fixture.'))!;
    return (await win.capturePage()).toPNG().toString('base64');
  });
  writeFileSync(file, Buffer.from(image, 'base64'));
}

test('header switching, remote isolation, offline return and Dock return keep local work intact', async ({ home }, testInfo) => {
  test.setTimeout(180_000);
  const app = await launchApp(home);
  const rows = ['Studio Mac', 'Travel Mac'].map((name, index) => ({ id: randomUUID(), instanceId: randomUUID(), name, browserUrl: `https://${index ? 'travel' : 'studio'}-fixture.zana-ide.com`, live: true }));
  try {
    const original = await app.window.evaluate(() => window.cc.projects.list());
    const summary = app.window.locator('.titlebar .instance-menu > summary');
    await expect(summary).toHaveAttribute('aria-label', 'Zana switcher: This computer');
    await expect(app.window.locator('.sidebar .instance-menu')).toHaveCount(0);
    const control = await summary.boundingBox(), help = await app.window.getByTestId('titlebar-help-toggle').boundingBox();
    expect(control!.x + control!.width).toBeLessThanOrEqual(help!.x);
    await app.electron.evaluate(({ session }, rows) => {
      const state = { unavailable: false }; (globalThis as any).__switcherFixture = state;
      session.fromPartition('persist:zcc-shared-account').protocol.handle('https', request => {
        const url = new URL(request.url);
        if (url.hostname === 'zana-ide.com' && url.pathname === '/api/connect/account') return state.unavailable ? new Response('Offline', { status: 503 }) : Response.json({ servers: rows });
        const row = rows.find(row => row.browserUrl === url.origin);
        if (!row || state.unavailable) return new Response('Offline', { status: 503 });
        return new Response(`<!doctype html><title>${row.name}</title><style>body{font:16px system-ui;background:#f7f9fc;padding:60px 40px}header{position:absolute;top:0;right:10px;height:38px;display:flex;gap:18px;align-items:center;color:#68778a}</style><header><span>?</span><span>☆</span><span>♧</span></header><h1>${row.name}</h1><textarea aria-label="Draft"></textarea><script>const field=document.querySelector('textarea');field.value=localStorage.getItem('draft')||'';field.oninput=()=>localStorage.setItem('draft',field.value)</script>`, { headers: { 'content-type': 'text/html' } });
      });
    }, rows);
    await summary.click();
    await captureElectronScreenshot(app.electron, app.window, testInfo.outputPath('local-header-switcher.png'));
    await app.window.getByRole('button', { name: 'Open another Zana…', exact: true }).click();
    await app.window.getByRole('region', { name: 'Zana instances' }).getByRole('listitem').filter({ hasText: 'Studio Mac' }).getByRole('button', { name: 'Open Zana' }).click();
    const studio = await sharedInstancePage(app, rows[0]!.browserUrl); await expect(studio.getByRole('heading', { name: 'Studio Mac' })).toBeVisible();
    await expect.poll(() => chromeText(app)).toContain('Studio Mac');
    expect(await studio.evaluate(() => typeof window.cc)).toBe('undefined');
    await studio.getByRole('textbox', { name: 'Draft' }).fill('Keep my Studio draft');
    // Remote attempts to imitate the action scheme cannot switch local authority.
    await studio.evaluate(() => { location.href = 'zcc-instance://local'; });
    expect(JSON.parse(readFileSync(join(home, '.zcc/shared-target.json'), 'utf8')).kind).toBe('connect');
    await chromeToggle(app);
    await capture(app, testInfo.outputPath('remote-document-only.png'));
    await chromeClick(app, 'Open another Zana…');
    await expect.poll(() => chromeText(app)).toContain('Travel Mac');
    await chromeClick(app, 'Travel Mac');
    const travel = await sharedInstancePage(app, rows[1]!.browserUrl); await expect(travel.getByRole('heading', { name: 'Travel Mac' })).toBeVisible();
    await expect(travel.getByRole('textbox')).toHaveValue('');
    await chromeToggle(app); await chromeClick(app, 'Return to this computer');
    await expect(summary).toBeVisible();
    expect(await app.window.evaluate(() => window.cc.projects.list())).toEqual(original);
    expect(JSON.parse(readFileSync(join(home, '.zcc/shared-target.json'), 'utf8'))).toEqual({ kind: 'local' });
    // Go back to Studio; browser-origin storage is preserved across switching.
    await app.window.evaluate(id => window.cc.sharedClient.select(id), rows[0]!.id);
    const restored = await sharedInstancePage(app, rows[0]!.browserUrl); await expect(restored.getByRole('textbox')).toHaveValue('Keep my Studio draft');
    if (process.platform === 'darwin') {
      const dockLabels = await app.electron.evaluate(({ app }) => app.dock!.getMenu()!.items.map(row => row.label));
      expect(dockLabels).toContain('Return to this computer'); expect(dockLabels).toContain('Quit Zana');
      await app.electron.evaluate(({ app }) => app.dock!.getMenu()!.items.find(row => row.label === 'Return to this computer')!.click());
      await expect(summary).toBeVisible();
      expect(await app.electron.evaluate(({ app }) => app.dock!.getMenu()!.items.length)).toBe(0);
      await app.window.evaluate(id => window.cc.sharedClient.select(id), rows[0]!.id); await sharedInstancePage(app, rows[0]!.browserUrl);
    }
    // A fresh unavailable/expired state still presents desktop-owned return.
    await app.electron.evaluate(() => { (globalThis as any).__switcherFixture.unavailable = true; });
    await chromeToggle(app); await chromeClick(app, 'Open another Zana…');
    await expect.poll(() => chromeText(app)).toContain('Check your connection');
    await chromeClick(app, 'Return to this computer'); await expect(summary).toBeVisible();
    expect(await app.window.evaluate(() => window.cc.projects.list())).toEqual(original);
  } finally { await app.electron.close(); }
});

test('Quit Zana in the local header exits the desktop app', async ({ home }) => {
  test.setTimeout(180_000);
  const app = await launchApp(home);
  try {
    // Keep the existing live-work confirmation: approve its native OS dialog
    // if the activity probe cannot finish while other suites load the machine.
    await app.electron.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox; });
    await app.window.locator('.titlebar .instance-menu > summary').click();
    const closed = app.electron.waitForEvent('close');
    await app.window.getByRole('button', { name: 'Quit Zana', exact: true }).click();
    await closed;
  } finally { await app.electron.close().catch(() => {}); }
});
