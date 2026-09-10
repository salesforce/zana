/**
 * E2E coverage for the notifications rework (Phases B + C — see
 * docs/extensions-sdk-reference.md and the CLAUDE.md "notify" naming note):
 *
 *  - Phase B: a full-trust PluginService plugin calling `zcc.sdk.inbox.push`
 *    reaches the real Inbox, is stamped with `extensionSource` from the
 *    authenticated plugin id.
 *  - Phase C: the titlebar bell opens the `NotificationsDrawer` slide-over
 *    instead of navigating to the Inbox nav route, and a pushed entry shows
 *    up there.
 *
 * Installs the inline `inbox-push-sample` plugin from a local `git://`
 * daemon — the same offline, no-network install path
 * `install-from-git.spec.ts` uses — so this exercises a REAL in-process
 * PluginService `server.mjs`, not a stub.
 */
import { test, expect } from './fixtures/app.js';
import { startGitDaemon, type GitDaemon } from './fixtures/git-daemon.js';
import { MarketplacePage } from './fixtures/marketplace.js';
import { INBOX_PUSH_SAMPLE_FILES } from './fixtures/sample-extensions.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const INBOX_PUSH_REPO = { repoName: 'inbox-push-sample', files: INBOX_PUSH_SAMPLE_FILES };

test.describe('notifications — extension inbox push + bell drawer', () => {
  let daemon: GitDaemon | null = null;

  test.afterEach(async () => {
    await daemon?.close();
    daemon = null;
  });

  test('an installed plugin pushes a durable, host-stamped inbox entry', async ({
    app,
    home
  }) => {
    daemon = await startGitDaemon(join(home, '.git-daemon'), [INBOX_PUSH_REPO]);
    const market = new MarketplacePage(app.window);
    const win = app.window;

    // Install the permissioned sample via IPC (UI install-from-git flow is
    // already covered by install-from-git.spec.ts; here the install is just
    // setup for the real assertion).
    const installed = await market.ipc<{ ok: boolean }>('install', {
      kind: 'git',
      url: daemon.urlFor('inbox-push-sample')
    });
    expect(installed.ok).toBe(true);

    await expect.poll(async () => win.evaluate(async () => {
      const plugins = await window.cc.pluginApps.list();
      return plugins.some((plugin) => plugin.id === 'inbox-push-sample' && plugin.enabled);
    })).toBe(true);

    const projectDir = mkdtempSync(join(tmpdir(), 'zcc-inbox-push-test-'));
    let projectId: string | null = null;
    try {
      projectId = await win.evaluate(async (path) => {
        const res = await window.cc.projects.add(path);
        const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
          id: string;
        };
        return proj.id;
      }, projectDir);
      expect(projectId).toBeTruthy();

      // Real PluginService RPC + SDK push with a real projectId.
      const marker = `E2E_INBOX_PUSH_${Date.now()}`;
      const pushResult = await win.evaluate(
        async ({ pid, text }) => {
          return window.cc.pluginApps.callRpc('inbox-push-sample', 'push',
            { projectId: pid, comments: text }) as Promise<{ id: string }>;
        },
        { pid: projectId, text: marker }
      );
      expect(pushResult?.id).toBeTruthy();

      // It's durable: reachable via the same inbox history the UI renders,
      // and host-stamped with extensionSource (never a payload-supplied value).
      const entry = await win.evaluate(
        async ({ pid, id }) => {
          const res = (await window.cc.inbox.history({ projectId: pid, limit: 50 })) as {
            entries?: Array<{ id: string; comments?: string; extensionSource?: { extensionId: string } }>;
          };
          return (res.entries ?? []).find((e) => e.id === id) ?? null;
        },
        { pid: projectId, id: pushResult.id }
      );
      expect(entry).toBeTruthy();
      expect(entry!.comments).toBe(marker);
      expect(entry!.extensionSource?.extensionId).toBe('inbox-push-sample');
    } finally {
      if (projectId) {
        await win.evaluate(async (pid) => {
          try {
            await window.cc.projects.remove(pid);
          } catch {
            /* best-effort */
          }
        }, projectId);
      }
      try {
        rmSync(projectDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  test('the bell opens a slide-over drawer (not a nav change) and shows a pushed entry', async ({
    app,
    home
  }) => {
    daemon = await startGitDaemon(join(home, '.git-daemon'), [
      INBOX_PUSH_REPO
    ]);
    const market = new MarketplacePage(app.window);
    const win = app.window;

    const installed = await market.ipc<{ ok: boolean }>('install', {
      kind: 'git',
      url: daemon.urlFor('inbox-push-sample')
    });
    expect(installed.ok).toBe(true);
    const projectDir = mkdtempSync(join(tmpdir(), 'zcc-inbox-drawer-test-'));
    let projectId: string | null = null;
    try {
      projectId = await win.evaluate(async (path) => {
        const res = await window.cc.projects.add(path);
        const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
          id: string;
        };
        return proj.id;
      }, projectDir);
      expect(projectId).toBeTruthy();

      // No dedupeKey/question/scheduled → classifyEntry falls through to the
      // `report` feed category (SIGNAL, not folded) — so a plain push IS
      // drawer-worthy without needing to stamp `notify: 'loud'`.
      // The child utilityProcess may still be finishing its post-consent
      // (re)spawn, so poll rather than assume it's ready on the first call.
      // No underscores: the drawer renders comments through mdToPlainText,
      // which treats `_..._` as markdown italic and strips the underscores.
      const marker = `E2EDRAWERMARKER${Date.now()}`;
      await expect
        .poll(
          async () => {
            try {
              await win.evaluate(
                async ({ pid, text }) =>
                  window.cc.pluginApps.callRpc('inbox-push-sample', 'push', { projectId: pid, comments: text }),
                { pid: projectId, text: marker }
              );
              await win.reload();
              await expect(win.locator('.titlebar-bell')).toBeVisible({ timeout: 15_000 });
              return 'ok';
            } catch (err) {
              return String((err as Error)?.message ?? err);
            }
          },
          { timeout: 15_000, intervals: [500, 1000] }
        )
        .toBe('ok');

      // Clicking the bell must NOT navigate to the Inbox nav route — it opens
      // the drawer overlay in place.
      const bell = win.locator('.titlebar-bell');
      await bell.click();

      const drawer = win.locator('.notifications-drawer');
      await expect(drawer).toBeVisible({ timeout: 10_000 });
      // The nav must still be whatever it was — not the full Inbox route.
      await expect(win.locator('.nav-item.active', { hasText: 'Inbox' })).toHaveCount(0);

      // The pushed entry shows up in the drawer's Reports section.
      await expect(drawer.locator('.notifications-drawer-row', { hasText: marker })).toBeVisible({
        timeout: 5_000
      });

      // "View all in Inbox" closes the drawer and navigates to the real Inbox
      // nav route — the drawer is a shortcut, not a replacement.
      await drawer.locator('.notifications-drawer-view-all').click();
      await expect(drawer).toBeHidden({ timeout: 5_000 });
      await expect(win.locator('.nav-item.active', { hasText: 'Inbox' })).toHaveCount(1);
    } finally {
      if (projectId) {
        await win.evaluate(async (pid) => {
          try {
            await window.cc.projects.remove(pid);
          } catch {
            /* best-effort */
          }
        }, projectId);
      }
      try {
        rmSync(projectDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  test('clicking a plugin-pushed drawer row opens that specific Inbox entry', async ({
    app,
    home
  }) => {
    daemon = await startGitDaemon(join(home, '.git-daemon'), [
      INBOX_PUSH_REPO
    ]);
    const market = new MarketplacePage(app.window);
    const win = app.window;

    const installed = await market.ipc<{ ok: boolean }>('install', {
      kind: 'git',
      url: daemon.urlFor('inbox-push-sample')
    });
    expect(installed.ok).toBe(true);
    const projectDir = mkdtempSync(join(tmpdir(), 'zcc-inbox-target-test-'));
    let projectId: string | null = null;
    try {
      projectId = await win.evaluate(async (path) => {
        const res = await window.cc.projects.add(path);
        const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
          id: string;
        };
        return proj.id;
      }, projectDir);
      expect(projectId).toBeTruthy();

      // Current Plugin SDK push contract accepts projectId + comments. Clicking
      // its row must use normal entry-focused Inbox navigation.
      const marker = `E2ETARGETMARKER${Date.now()}`;
      await expect
        .poll(
          async () => {
            try {
              await win.evaluate(
                async ({ pid, text }) =>
                  window.cc.pluginApps.callRpc('inbox-push-sample', 'push', { projectId: pid, comments: text }),
                { pid: projectId, text: marker }
              );
              await win.reload();
              await expect(win.locator('.titlebar-bell')).toBeVisible({ timeout: 15_000 });
              return 'ok';
            } catch (err) {
              return String((err as Error)?.message ?? err);
            }
          },
          { timeout: 15_000, intervals: [500, 1000] }
        )
        .toBe('ok');

      const bell = win.locator('.titlebar-bell');
      await bell.click();

      const drawer = win.locator('.notifications-drawer');
      await expect(drawer).toBeVisible({ timeout: 10_000 });

      const row = drawer.locator('.notifications-drawer-row', { hasText: marker });
      await expect(row).toBeVisible({ timeout: 5_000 });
      await row.click();

      // Drawer closes and exact pushed entry opens in Inbox.
      await expect(drawer).toBeHidden({ timeout: 5_000 });
      await expect(win.locator('.nav-item.active', { hasText: /^Inbox$/ })).toHaveCount(1);
      await expect(win.locator('.inbox-detail')).toContainText(marker, { timeout: 5_000 });
    } finally {
      if (projectId) {
        await win.evaluate(async (pid) => {
          try {
            await window.cc.projects.remove(pid);
          } catch {
            /* best-effort */
          }
        }, projectId);
      }
      try {
        rmSync(projectDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });
});
