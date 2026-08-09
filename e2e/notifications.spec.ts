/**
 * E2E coverage for the notifications rework (Phases B + C — see
 * docs/extensions-sdk-reference.md and the CLAUDE.md "notify" naming note):
 *
 *  - Phase B: a sandboxed disk extension calling `ctx.inbox.push` reaches the
 *    real Inbox via the brokered `inbox.push` capability, gated on the
 *    `inbox:push` permission and stamped with `extensionSource` from the
 *    AUTHENTICATED moduleId. An extension WITHOUT the permission is denied,
 *    and an unknown `projectId` is rejected — both re-verified end to end
 *    here (not just in the offline broker-caps unit tests).
 *  - Phase C: the titlebar bell opens the `NotificationsDrawer` slide-over
 *    instead of navigating to the Inbox nav route, and a pushed entry shows
 *    up there.
 *
 * Installs the `inbox-push-sample` fixture (test/fixtures/inbox-push-sample)
 * from a local `git://` daemon — the same offline, no-network install path
 * `install-from-git.spec.ts` uses — so this exercises a REAL sandboxed
 * `main.mjs` utilityProcess, not a stub.
 */
import { test, expect } from './fixtures/app';
import { startGitDaemon, type GitDaemon } from './fixtures/git-daemon';
import { MarketplacePage } from './fixtures/marketplace';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SAMPLE_FIXTURE = join(REPO_ROOT, 'test/fixtures/inbox-push-sample');

/** Same manifest, permissions:[] — proves the deny path without a real grant. */
const NOPERM_MANIFEST = JSON.stringify(
  {
    id: 'inbox-push-noperm',
    version: '1.0.0',
    title: 'Inbox Push NoPerm',
    icon: 'Bell',
    titleLabel: 'Inbox Push NoPerm',
    entry: { main: 'main.mjs', renderer: 'renderer.js' },
    engines: { zccApi: '^1.0.0' },
    permissions: [],
    projectTab: { label: 'NoPerm', icon: 'Bell', order: 101, global: true }
  },
  null,
  2
);
const NOPERM_MAIN = `export default {
  id: 'inbox-push-noperm',
  setup(ctx) {
    return { push: async (input) => ctx.inbox.push(input) };
  }
};
`;
const NOPERM_RENDERER = `export default {
  renderProjectTab() { return document.createElement('div'); }
};
`;

test.describe('notifications — extension inbox push + bell drawer', () => {
  let daemon: GitDaemon | null = null;

  test.afterEach(async () => {
    await daemon?.close();
    daemon = null;
  });

  test('a granted extension pushes a durable, stamped inbox entry an unpermissioned one cannot', async ({
    app,
    home
  }) => {
    daemon = await startGitDaemon(join(home, '.git-daemon'), [
      { repoName: 'inbox-push-sample', fromDir: SAMPLE_FIXTURE },
      {
        repoName: 'inbox-push-noperm',
        files: {
          'extension.json': NOPERM_MANIFEST,
          'main.mjs': NOPERM_MAIN,
          'renderer.js': NOPERM_RENDERER
        }
      }
    ]);
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

    // Grant consent (declares `inbox:push` → raises the P3-D overlay).
    const overlay = win.locator('.consent-overlay');
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    await overlay.locator('button.btn.primary').click();
    await expect(overlay).toBeHidden({ timeout: 15_000 });

    // Install the unpermissioned twin — permissions:[] means no consent gate.
    const installedNoPerm = await market.ipc<{ ok: boolean }>('install', {
      kind: 'git',
      url: daemon.urlFor('inbox-push-noperm')
    });
    expect(installedNoPerm.ok).toBe(true);

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

      // Deny path FIRST: the unpermissioned extension's push must be rejected,
      // and nothing should land in the inbox for it.
      const deniedResult = await win.evaluate(async (pid) => {
        try {
          await window.cc.modules.call('inbox-push-noperm', 'push', [{ projectId: pid, comments: 'nope' }]);
          return { threw: false };
        } catch (err) {
          return { threw: true, message: String((err as Error)?.message ?? err) };
        }
      }, projectId);
      expect(deniedResult.threw).toBe(true);

      // Unknown projectId path: the granted extension still can't target a
      // project that doesn't exist.
      const unknownProjectResult = await win.evaluate(async () => {
        try {
          await window.cc.modules.call('inbox-push-sample', 'push', [
            { projectId: 'proj-does-not-exist', comments: 'ghost' }
          ]);
          return { threw: false };
        } catch (err) {
          return { threw: true, message: String((err as Error)?.message ?? err) };
        }
      });
      expect(unknownProjectResult.threw).toBe(true);

      // The real push: granted extension + real projectId.
      const marker = `E2E_INBOX_PUSH_${Date.now()}`;
      const pushResult = await win.evaluate(
        async ({ pid, text }) => {
          return window.cc.modules.call('inbox-push-sample', 'push', [
            { projectId: pid, comments: text }
          ]) as Promise<{ id: string }>;
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
      { repoName: 'inbox-push-sample', fromDir: SAMPLE_FIXTURE }
    ]);
    const market = new MarketplacePage(app.window);
    const win = app.window;

    const installed = await market.ipc<{ ok: boolean }>('install', {
      kind: 'git',
      url: daemon.urlFor('inbox-push-sample')
    });
    expect(installed.ok).toBe(true);
    const overlay = win.locator('.consent-overlay');
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    await overlay.locator('button.btn.primary').click();
    await expect(overlay).toBeHidden({ timeout: 15_000 });

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
                  window.cc.modules.call('inbox-push-sample', 'push', [{ projectId: pid, comments: text }]),
                { pid: projectId, text: marker }
              );
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

  test('a `target` naming the extension\'s own module redirects the drawer click to its project tab, not the Inbox', async ({
    app,
    home
  }) => {
    daemon = await startGitDaemon(join(home, '.git-daemon'), [
      { repoName: 'inbox-push-sample', fromDir: SAMPLE_FIXTURE }
    ]);
    const market = new MarketplacePage(app.window);
    const win = app.window;

    const installed = await market.ipc<{ ok: boolean }>('install', {
      kind: 'git',
      url: daemon.urlFor('inbox-push-sample')
    });
    expect(installed.ok).toBe(true);
    const overlay = win.locator('.consent-overlay');
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    await overlay.locator('button.btn.primary').click();
    await expect(overlay).toBeHidden({ timeout: 15_000 });

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

      // The raw `projects.add` IPC persists in main but doesn't broadcast
      // `projects:onChanged` — land on Projects and reload so the renderer
      // actually knows about this project (else `focusInboxEntry`'s
      // `enterProjectFocus` has nothing to focus).
      const projectsNav = win.locator('button.nav-item').filter({ hasText: 'Projects' });
      await projectsNav.first().click();
      await win.locator('button[aria-label="Reload project list"]').click();

      // Same fixture forwards its `push` input verbatim to `ctx.inbox.push`, so
      // this exercises the SAME brokered `target` trust chain as the unit tests
      // (self-only, re-validated at click time) end to end.
      const marker = `E2ETARGETMARKER${Date.now()}`;
      await expect
        .poll(
          async () => {
            try {
              await win.evaluate(
                async ({ pid, text }) =>
                  window.cc.modules.call('inbox-push-sample', 'push', [
                    { projectId: pid, comments: text, target: { moduleId: 'inbox-push-sample' } }
                  ]),
                { pid: projectId, text: marker }
              );
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

      // The drawer closes and the click lands on the extension's OWN project
      // tab — not the Inbox nav route. Exact text match: the extension's own
      // nav item is labeled "Inbox Push Sample", which a substring `hasText:
      // 'Inbox'` filter would also match.
      await expect(drawer).toBeHidden({ timeout: 5_000 });
      await expect(win.locator('.nav-item.active', { hasText: /^Inbox$/ })).toHaveCount(0);
      await expect(win.locator('.inbox-push-sample-panel')).toBeVisible({ timeout: 5_000 });
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
