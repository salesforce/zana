/**
 * Built-Electron: a restore capability that owns a retained Squad worktree
 * (`followUpExecutionId`) survives a FAILED launch and is restorable on retry.
 *
 * TM1: terminals.restore claims the follow-up worktree before launching. A
 * failed launch must release that claim (and the capability reservation) so the
 * retry is not refused and the execution is not left "in use" until restart.
 *
 * A restore capability carrying a followUpExecutionId is seeded into the isolated
 * userData ledger. Attempt 1 restores it against a nonexistent project (launch
 * fails through the real restore IPC); attempt 2 re-seeds the same capability id
 * against the real project and must succeed.
 *
 * Limitation: the in-memory claim registry is not exposed to the renderer, so
 * claim release itself is proven by the unit tests; here we prove the
 * IPC-level failure -> retry -> success sequence at the production boundary.
 */
import { test, expect, launchApp, type AppHandle } from './fixtures/app.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

test.setTimeout(180_000);

async function stop(handle: AppHandle): Promise<void> {
  let closed = false;
  await Promise.race([
    handle.electron.close().then(() => { closed = true; }).catch(() => { closed = true; }),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000))
  ]);
  if (!closed) {
    try { handle.electron.process()?.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

test('failed follow-up restore launch leaves the capability restorable; retry succeeds', async ({ home }) => {
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-restore-claim-'));
  const binDir = mkdtempSync(join(tmpdir(), 'zcc-restore-claim-bin-'));
  const goodBin = join(binDir, 'claude-stub.cjs');
  writeFileSync(goodBin, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('2.1.220 (Claude Code)'); process.exit(0); }
process.stdout.write('CLI Agent ready\\n');
process.stdin.resume();
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  const capabilityId = randomUUID();
  const sessionId = randomUUID();
  const ledger = join(home, 'electron-user-data', 'restore-capabilities.json');
  const seed = (projectId: string): void => {
    mkdirSync(join(home, 'electron-user-data'), { recursive: true });
    writeFileSync(ledger, JSON.stringify({
      version: 1,
      entries: [{
        id: capabilityId,
        request: { projectId, profile: 'claude', cwd: projectDir, cols: 80, rows: 24, title: 'Follow-up: restore claim' },
        sessionId,
        sessionProfile: 'claude',
        sessionTitle: 'Follow-up: restore claim',
        followUpExecutionId: `exec-${randomUUID()}`,
        createdAt: Date.now()
      }]
    }));
  };

  const app = await launchApp(home, { initialConfig: { tmuxScope: 'off' } });
  const { window } = app;
  let projectId = '';
  try {
    await window.evaluate((bin) => window.cc.config.set({ claudeBinary: bin }), goodBin);
    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      if (!res.ok) throw new Error(res.message);
      return res.value.id;
    }, projectDir);
    expect(projectId).toBeTruthy();

    // The ledger is re-read on every restore, so seeding while running is safe.
    // Attempt 1 targets a project that does not exist: the real restore IPC claims
    // the follow-up worktree, the launch fails, and the claim + reservation must be released.
    seed('project-that-does-not-exist');
    const failed = await window.evaluate((id) => window.cc.terminals.restore({ capabilityId: id }), capabilityId);
    expect(failed.ok).toBe(false);

    // Retry the SAME capability against the real project: must be reservable and launch.
    seed(projectId);
    const retried = await window.evaluate((id) => window.cc.terminals.restore({ capabilityId: id }), capabilityId);
    expect(retried.ok, JSON.stringify(retried)).toBe(true);
    if (retried.ok) expect(retried.value.id).toBe(sessionId);

    await expect.poll(async () => window.evaluate(async (pid) =>
      (await window.cc.terminals.list(pid)).some((s) => s.status !== 'exited'), projectId), { timeout: 20_000 }).toBe(true);
  } finally {
    try {
      await window.evaluate(async ({ pid, sid }) => {
        try { await window.cc.terminals.close(sid); } catch { /* best-effort */ }
        try { await window.cc.projects.remove(pid); } catch { /* best-effort */ }
      }, { pid: projectId, sid: sessionId });
    } catch { /* window may be gone */ }
    await stop(app);
    for (const dir of [projectDir, binDir]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
});
