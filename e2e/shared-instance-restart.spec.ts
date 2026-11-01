import { test, expect, launchApp } from './fixtures/app.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sharedInstancePage } from './fixtures/shared-instance.js';

async function fakeAccount(app: Awaited<ReturnType<typeof launchApp>>, rows: Array<{ id: string; instanceId: string; name: string; browserUrl: string; live: boolean }>) {
  await app.electron.evaluate(({ session }, rows) => {
    session.fromPartition('persist:zcc-shared-account').protocol.handle('https', async request => {
      const url = new URL(request.url);
      if (url.hostname === 'zana-ide.com' && url.pathname === '/api/connect/account') return Response.json({ servers: rows });
      if (url.hostname === 'zana-ide.com' && url.pathname === '/api/connect/browser/open/') {
        const { serverId } = await request.json();
        const selected = rows.find(row => row.id === serverId);
        if (!selected || !selected.live) return new Response('Unavailable', { status: 403 });
        return Response.json({ location: `${selected.browserUrl}/_connect/login?intent=1790000000000.${'i'.repeat(43)}` });
      }
      if (url.pathname === '/_connect/login') return new Response(null, { status: 303, headers: { location: url.origin + '/' } });
      const row = rows.find(row => row.browserUrl === url.origin);
      if (!row) return new Response('Denied', { status: 403 });
      return new Response(`<!doctype html><title>${row.name}</title><h1>${row.name}</h1><textarea aria-label="Draft"></textarea><script>const field=document.querySelector('textarea');field.value=localStorage.getItem('draft')||'';field.oninput=()=>localStorage.setItem('draft',field.value)</script>`, { headers: { 'content-type': 'text/html' } });
    });
  }, rows);
}
async function select(app: Awaited<ReturnType<typeof launchApp>>, id: string, name: string) {
  await app.window.evaluate(id => window.cc.sharedClient.select(id), id);
  const page = await sharedInstancePage(app, `https://${name}-fixture.zana-ide.com`); await expect(page.getByRole('heading', { name })).toBeVisible(); return page;
}

test('shared instance switching keeps drafts separate and an expired account never restores local authority on restart', async ({ home }) => {
  test.setTimeout(180_000);
  let app = await launchApp(home);
  const rows = ['first', 'second'].map(name => ({ id: randomUUID(), instanceId: randomUUID(), name, browserUrl: `https://${name}-fixture.zana-ide.com`, live: true }));
  try {
    const local = await app.window.evaluate(() => window.cc.projects.list());
    await fakeAccount(app, rows);
    const first = await select(app, rows[0]!.id, 'first'); await first.getByRole('textbox').fill('Unsent first-instance draft');
    const second = await select(app, rows[1]!.id, 'second');
    expect(first.isClosed()).toBe(true); await expect(second.getByRole('textbox')).toHaveValue('');
    await second.getByRole('textbox').fill('Unsent second-instance draft');
    const restored = await select(app, rows[0]!.id, 'first'); await expect(restored.getByRole('textbox')).toHaveValue('Unsent first-instance draft');
    await app.electron.close();
    // Fresh isolated account has no authentication and no protocol fixture. Boot
    // must retain its saved instance and show a shared-only unavailable screen.
    app = await launchApp(home);
    await expect.poll(() => app.electron.windows().some(window => window.url().startsWith('data:text/html')), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => {
      for (const window of app.electron.windows()) {
        if (window.url().startsWith('data:text/html') && (await window.locator('body').textContent())?.includes('unavailable')) return true;
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    expect(JSON.parse(readFileSync(join(home, '.zcc/shared-target.json'), 'utf8'))).toEqual({ kind: 'connect', serverId: rows[0]!.id, instanceId: rows[0]!.instanceId });
    // Activity timestamps and additive defaults may change during boot. The
    // local project's identity and location must remain intact and separate.
    const identities = (projects: typeof local) => projects.map(({ id, path, name, createdAt }) => ({ id, path, name, createdAt }));
    expect(identities(await app.window.evaluate(() => window.cc.projects.list()))).toEqual(identities(local));
    const localWindow = await app.electron.browserWindow(app.window);
    expect(await localWindow.evaluate(win => win.isVisible())).toBe(false);
    await fakeAccount(app, rows);
    const afterLogin = await select(app, rows[0]!.id, 'first'); await expect(afterLogin.getByRole('textbox')).toHaveValue('Unsent first-instance draft');
    expect(await afterLogin.evaluate(() => typeof window.cc)).toBe('undefined');
    await app.window.evaluate(() => window.cc.sharedClient.signOut());
    expect(JSON.parse(readFileSync(join(home, '.zcc/shared-target.json'), 'utf8'))).toEqual({ kind: 'local' });
    const signedOut = await select(app, rows[0]!.id, 'first'); await expect(signedOut.getByRole('textbox')).toHaveValue('');
  } finally { await app.electron.close(); }
});

test('a damaged saved target requires explicit return before showing local data', async ({ home }) => {
  const root = join(home, '.zcc'); mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'shared-target.json'), '{broken');
  const app = await launchApp(home);
  try {
    await expect.poll(async () => {
      for (const page of app.electron.windows()) {
        if (page.url().startsWith('data:text/html') && (await page.locator('body').textContent())?.includes('damaged')) return true;
      }
      return false;
    }).toBe(true);
    expect(readFileSync(join(root, 'shared-target.json'), 'utf8')).toBe('{broken');
    await app.window.evaluate(() => window.cc.sharedClient.local());
    expect(JSON.parse(readFileSync(join(root, 'shared-target.json'), 'utf8'))).toEqual({ kind: 'local' });
  } finally { await app.electron.close(); }
});
