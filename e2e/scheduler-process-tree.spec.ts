/**
 * Production-boundary regression: scheduled runs use a non-tmux supervisor
 * group. Closing its tracked PTY must remove a TERM-resistant descendant.
 */
import { test, expect } from './fixtures/app';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ e2e: true });

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('closing a scheduled shell tears down its forked descendant', async ({ app }) => {
  test.skip(process.platform === 'win32', 'Windows has no POSIX process groups');
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-schedule-tree-'));
  const pidFile = join(projectDir, 'grandchild.pid');
  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    return (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string };
  }, projectDir).then((project) => project.id);

  let sessionId: string | null = null;
  let scheduleId: string | null = null;
  try {
    const result = await window.evaluate(async (args) => {
      const { projectId, pidFile } = args as {
        projectId: string;
        pidFile: string;
      };
      const child = `trap '' TERM; echo $$ > ${JSON.stringify(pidFile)}; while :; do sleep 1; done`;
      const created = await window.cc.scheduler.create({
        name: 'E2E process tree',
        projectId,
        profile: 'shell',
        extraArgs: ['-c', `sh -c ${JSON.stringify(child)} & wait`],
        every: '1h',
        enabled: false,
        inboxLevel: 'silent',
        autoCloseOnFinish: false
      });
      const schedule = (created && 'ok' in created ? (created as { value: { id: string } }).value : created) as { id: string };
      await window.cc.scheduler.runNow(schedule.id);
      for (let i = 0; i < 50; i++) {
        const schedules = await window.cc.scheduler.list() as Array<{ id: string; status?: { runs?: Array<{ sessionId?: string }> } }>;
        const sessionId = schedules.find((entry) => entry.id === schedule.id)?.status?.runs?.[0]?.sessionId;
        if (sessionId) return { scheduleId: schedule.id, sessionId };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('scheduled session was not recorded');
    }, { projectId, pidFile });
    scheduleId = result.scheduleId;
    sessionId = result.sessionId;

    await expect.poll(() => existsSync(pidFile), { timeout: 15_000 }).toBe(true);
    const grandchildPid = Number(readFileSync(pidFile, 'utf8'));
    expect(isAlive(grandchildPid)).toBe(true);

    await window.evaluate((id) => window.cc.terminals.close(id), sessionId);
    await expect.poll(() => isAlive(grandchildPid), { timeout: 15_000 }).toBe(false);
    sessionId = null;
  } finally {
    await window.evaluate(async (args) => {
      const { projectId, sessionId, scheduleId } = args as {
        projectId: string;
        sessionId: string | null;
        scheduleId?: string;
      };
      try {
        if (sessionId) await window.cc.terminals.close(sessionId);
      } catch {
        /* best-effort */
      }
      try {
        if (scheduleId) await window.cc.scheduler.delete(scheduleId);
      } catch {
        /* best-effort */
      }
      try {
        await window.cc.projects.remove(projectId);
      } catch {
        /* best-effort */
      }
    }, { projectId, sessionId, scheduleId });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
