import { createServer } from 'node:net';
import { chromium, type Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { stubNativeDialogs, nativeDialogCalls } from './sdk/native-dialog.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';
import { signUiSend } from '../apps/server/src/http/ui-send-proof.js';

const secret = 'queued-send-built-electron-fixture-secret-32-bytes';
test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: {
  ZCC_FAKE_PROVIDER: '1', ZCC_PRODUCT_SERVER_CREDENTIAL: secret
} });

for (const surface of ['desktop', 'phone'] as const) {
  test(`Queued Send now confirms, cancels and sends only the selected message on ${surface}`, async ({ app }) => {
    test.setTimeout(120_000);
    const threadId = await app.window.evaluate(async () => {
      const scratch = await window.cc.projects.ensureQuickAgent();
      if (!scratch.ok) throw new Error(scratch.message);
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: scratch.value.id, providerId: 'fake', input: 'delay:30000 keep queue setup active' })
      });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()).thread.id as string;
    });
    await expect.poll(() => app.window.evaluate(async id =>
      (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId)).toBe('active');
    const selected = await app.window.evaluate(async id => {
      for (const input of ['Retained queued neighbor', 'Selected queued message']) {
        const response = await fetch(`/api/v1/threads/${id}/send`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input, mode: 'queue-if-active' })
        });
        if (!response.ok) throw new Error(await response.text());
      }
      const stopped = await fetch(`/api/v1/threads/${id}/stop`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
      });
      if (!stopped.ok) throw new Error(await stopped.text());
      const queue = await (await fetch(`/api/v1/threads/${id}/next-turn`)).json();
      if (queue.items.length !== 2 || !queue.paused) throw new Error('Paused queue was not retained');
      const item = queue.items.find((row: { text: string }) => row.text === 'Selected queued message');
      const forged = await fetch(`/api/v1/threads/${id}/next-turn/${item.id}/send`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-zcc-app-surface': 'mobile' }, body: '{}'
      });
      if (forged.status !== 403) throw new Error('Unsigned override was accepted');
      return item.id as string;
    }, threadId);

    let page: Page = app.window;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let gateway: Awaited<ReturnType<typeof startMobileGateway>> | undefined;
    try {
      if (surface === 'desktop') {
        await stubNativeDialogs(app.electron, [0, 1]);
        await page.evaluate(id => {
          window.history.pushState({}, '', `/threads/${id}`);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }, threadId);
      } else {
        const reservation = createServer();
        await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
        const port = (reservation.address() as { port: number }).port;
        await new Promise<void>(resolve => reservation.close(() => resolve()));
        const serverUrl = `http://127.0.0.1:${port}`;
        gateway = await startMobileGateway({
          upstream: new URL(app.window.url()).origin, publicUrl: serverUrl, port,
          signQueuedSend: (thread, item) => signUiSend(secret, thread, item, Date.now(), 'mobile-ui')
        });
        const paired = await fetch(`${serverUrl}/_mobile/pair`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: gateway.pair().code, label: 'Queued-send phone' })
        }).then(response => response.json());
        const session = await fetch(`${serverUrl}/_mobile/session`, {
          method: 'POST', headers: { authorization: `Bearer ${paired.credential}` }
        }).then(response => response.json());
        browser = await chromium.launch();
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        await context.addCookies([{ name: session.cookie.name, value: session.cookie.value,
          url: serverUrl, httpOnly: true, secure: false, sameSite: 'Strict' }]);
        page = await context.newPage();
        await page.goto(`${serverUrl}/threads/${threadId}`);
        expect(await page.evaluate(() => typeof window.cc)).toBe('undefined');
      }
      const card = page.getByTestId('thread-queued-messages');
      await expect(card.getByRole('button', { name: 'Send now', exact: true })).toHaveCount(2);
      const selectedRow = card.locator('li').filter({ hasText: 'Selected queued message' });
      if (surface === 'phone') page.once('dialog', async dialog => {
        expect(dialog.message()).toContain('Selected queued message');
        await dialog.dismiss();
      });
      await selectedRow.getByRole('button', { name: 'Send now', exact: true }).click();
      await expect(card.getByRole('alert')).toContainText('Send now was cancelled');
      await expect(selectedRow).toBeVisible();
      if (surface === 'phone') page.once('dialog', async dialog => { await dialog.accept(); });
      await selectedRow.getByRole('button', { name: 'Send now', exact: true }).click();
      await expect(selectedRow).toHaveCount(0);
      await expect(card.getByText('Retained queued neighbor', { exact: true })).toBeVisible();
      const queue = await app.window.evaluate(async id =>
        (await (await fetch(`/api/v1/threads/${id}/next-turn`)).json()), threadId);
      expect(queue.paused).toBe(true);
      expect(queue.items).toHaveLength(1);
      expect(queue.items[0].id).not.toBe(selected);
      if (surface === 'desktop') expect((await nativeDialogCalls(app.electron)).map(call => call.title))
        .toEqual(['Send queued message now?', 'Send queued message now?']);
    } finally {
      await browser?.close();
      await gateway?.close();
    }
  });
}
