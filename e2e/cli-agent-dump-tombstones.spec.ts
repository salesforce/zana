/**
 * Dead CLI Agent cards are dumped from the UI. restore-capabilities.json can
 * still hold hours-old Pi/Claude/Cursor ledgers — after reboot they must NOT
 * nest in the project rail the way idle threads do. Resume stays in-RAM only.
 *
 * Two-boot: register a project, stop, seed a uniquely titled exited capability
 * into the isolated Electron userData ledger, boot again. Host IPC still lists
 * the tombstone (the ledger is intact); the project rail and Agents board do
 * not paint it.
 */
import { test, expect, launchApp, type AppHandle } from './fixtures/app.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

test.setTimeout(180_000);

async function stop(handle: AppHandle): Promise<void> {
  let closed = false;
  await Promise.race([
    handle.electron
      .close()
      .then(() => {
        closed = true;
      })
      .catch(() => {
        closed = true;
      }),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000))
  ]);
  if (!closed) {
    try {
      handle.electron.process()?.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

test('dead CLI ledger cards are not painted after reboot', async ({ home }) => {
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-dump-cli-'));
  const projectName = basename(projectDir);
  const tombstoneTitle = `DUMP-CLI-${randomUUID().slice(0, 8)}`;
  const hoursAgo = Date.now() - 4 * 60 * 60 * 1000;
  let projectId = '';

  const first = await launchApp(home);
  try {
    projectId = await first.window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
        id: string;
      };
      return proj.id;
    }, projectDir);
    expect(projectId).toBeTruthy();
  } finally {
    await stop(first);
  }

  writeFileSync(
    join(home, 'electron-user-data', 'restore-capabilities.json'),
    JSON.stringify({
      version: 1,
      entries: [
        {
          id: randomUUID(),
          request: {
            projectId,
            profile: 'pi',
            cwd: projectDir,
            cols: 80,
            rows: 24,
            title: tombstoneTitle
          },
          sessionId: randomUUID(),
          sessionProfile: 'pi',
          sessionTitle: tombstoneTitle,
          createdAt: hoursAgo,
          exitedAt: hoursAgo + 1_000
        }
      ]
    })
  );

  const second = await launchApp(home);
  try {
    await expect
      .poll(
        async () => {
          const listed = await second.window.evaluate(() =>
            window.cc.terminals.listRememberedSessions()
          );
          return listed.some(
            (row) => row.title === tombstoneTitle && row.remembered === true && row.status === 'exited'
          );
        },
        { timeout: 20_000 }
      )
      .toBe(true);

    const live = await second.window.evaluate((pid) => window.cc.terminals.list(pid), projectId);
    expect(live.filter((row) => row.title === tombstoneTitle)).toEqual([]);

    const workspaces = second.window.locator('[data-testid="sidebar-projects-heading"]');
    if ((await workspaces.getAttribute('aria-expanded')) === 'false') {
      await workspaces.click();
    }
    const row = second.window.locator('.project-item').filter({ hasText: projectName }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    const rail = second.window.locator('[data-testid="project-session-rail"]');
    await expect(rail).toBeVisible({ timeout: 15_000 });
    // Hydrate used to run right after restoreSessions during init — wait past
    // that window so absence is not a race against a still-running paint.
    await second.window.waitForTimeout(2_000);
    await expect(rail.getByText(tombstoneTitle)).toHaveCount(0);
    await expect(rail.getByText(/exited \d+h ago/)).toHaveCount(0);

    await second.window.locator('[data-testid="project-nav-agents"]').click();
    await expect(second.window.locator('.agents-board')).toBeVisible({ timeout: 15_000 });
    await expect(second.window.getByText('No agents yet')).toBeVisible();
    await expect(second.window.getByText(tombstoneTitle, { exact: true })).toHaveCount(0);
  } finally {
    try {
      await second.window.evaluate(async (pid) => {
        try {
          await window.cc.projects.remove(pid);
        } catch {
          /* best-effort */
        }
      }, projectId);
    } catch {
      /* window may already be gone */
    }
    await stop(second);
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});
