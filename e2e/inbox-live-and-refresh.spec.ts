/**
 * Production-boundary: the desktop Inbox shows entries appended by the product
 * server process without a reload, and the Refresh button picks up entries no
 * process announced.
 *
 * Electron main and the server each own an InboxStore over the same JSONL and
 * only emit for their own writes. A plugin push (like a thread's MCP
 * `inbox_push`) is a server write, so it must reach the window over the
 * server WS, not main IPC.
 */
import { test, expect } from './fixtures/app.js';
import { startGitDaemon, type GitDaemon } from './fixtures/git-daemon.js';
import { MarketplacePage } from './fixtures/marketplace.js';
import { INBOX_PUSH_SAMPLE_FILES } from './fixtures/sample-extensions.js';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let daemon: GitDaemon | null = null;
test.afterEach(async () => {
  await daemon?.close();
  daemon = null;
});

test('a server-side push appears live and Refresh reloads entries written behind the app', async ({ app, home }) => {
  const win = app.window;
  daemon = await startGitDaemon(join(home, '.git-daemon'), [{ repoName: 'inbox-push-sample', files: INBOX_PUSH_SAMPLE_FILES }]);
  const installed = await new MarketplacePage(win).ipc<{ ok: boolean }>('install', {
    kind: 'git',
    url: daemon.urlFor('inbox-push-sample')
  });
  expect(installed.ok).toBe(true);

  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-inbox-live-')));
  try {
    const projectId = await win.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      if (!res.ok) throw new Error(res.message);
      return res.value.id;
    }, projectDir);

    await win.getByTestId('nav-inbox').click();
    const list = win.locator('.inbox-list-pane');
    await expect(list.getByRole('button', { name: 'Refresh inbox' })).toBeVisible();

    // The plugin's utility process may still be starting, so retry the push
    // (not the assertion) until it lands. No reload: the row must arrive live.
    const live = `E2ELIVEMARKER${Date.now()}`;
    await expect.poll(async () => win.evaluate(
      async ({ pid, text }) => window.cc.pluginApps.callRpc('inbox-push-sample', 'push', { projectId: pid, comments: text })
        .then(() => 'ok', (err: unknown) => String(err)),
      { pid: projectId, text: live }
    ), { timeout: 15_000, intervals: [500, 1000] }).toBe('ok');
    await expect(win.locator('.inbox-row').filter({ hasText: live }).first()).toBeVisible({ timeout: 10_000 });

    // Written straight to disk, so neither process emits; only Refresh finds it.
    const quiet = `E2EREFRESHMARKER${Date.now()}`;
    const inboxDir = join(home, '.zcc', 'inbox');
    mkdirSync(inboxDir, { recursive: true });
    appendFileSync(join(inboxDir, 'entries.jsonl'), `${JSON.stringify({
      id: `refresh-${Date.now()}`, ts: Date.now(), projectId, subject: quiet, comments: quiet, report: true
    })}\n`);
    const quietRow = win.locator('.inbox-row').filter({ hasText: quiet });
    await expect(quietRow).toHaveCount(0);
    await list.getByRole('button', { name: 'Refresh inbox' }).click();
    await expect(quietRow.first()).toBeVisible({ timeout: 10_000 });
    await expect(list.getByRole('button', { name: 'Refresh inbox' })).toHaveAttribute('aria-busy', 'false');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
