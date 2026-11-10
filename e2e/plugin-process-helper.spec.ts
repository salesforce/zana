/**
 * Electron production-boundary: `zcc.process.spawn` children are host-tracked and reaped as a process
 * GROUP. An isolated worker plugin spawns a long-lived `sh` that backgrounds a grandchild. Disabling the
 * plugin, uninstalling it, and a forced worker crash each kill both the leader and the grandchild. The
 * host discards child output, so each shell writes its own pid files; liveness is `kill(pid, 0)`.
 * The per-plugin cap of 8 live children holds: a ninth spawn is refused and the eight are still reaped.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect } from './fixtures/app.js';
import { installObservers, isAlive, readPid, rpcOn, waitForRunning, writeHomeConfig } from './fixtures/aida-p2.js';

const PLUGIN = 'p2-process';
const CAP = 8;

const test = base.extend<{ pidDir: string }>({
  pidDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-p2-process-'));
    try { await use(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  },
  launchEnv: async ({ home }, use) => {
    installObservers(home, { [PLUGIN]: {} });
    writeHomeConfig(home, {});
    await use({});
  }
});
test.setTimeout(120_000);

/** Spawn a leader + grandchild tree and return both pids once the shell has written them. */
async function spawnTree(app: { window: import('@playwright/test').Page }, dir: string, name: string) {
  const reply = await rpcOn(app.window, PLUGIN)<{ pid: number }>('spawnTree', { dir, name });
  await expect.poll(() => [readPid(join(dir, `${name}.leader.pid`)), readPid(join(dir, `${name}.child.pid`))].every(Boolean), { timeout: 15_000 }).toBe(true);
  const leader = readPid(join(dir, `${name}.leader.pid`))!;
  const child = readPid(join(dir, `${name}.child.pid`))!;
  expect(leader).toBe(reply.pid);
  expect(child).not.toBe(leader);
  expect(isAlive(leader) && isAlive(child)).toBe(true);
  return { leader, child };
}

const bothDead = (tree: { leader: number; child: number }) => !isAlive(tree.leader) && !isAlive(tree.child);

test.describe('process groups are reaped', () => {
  test('on disable and on uninstall', async ({ app, pidDir }) => {
    await waitForRunning(app.window, [PLUGIN]);
    const first = await spawnTree(app, pidDir, 'disable');
    expect(await app.window.evaluate((id) => window.cc.pluginApps.setEnabled(id, false), PLUGIN)).toMatchObject({ ok: true });
    await expect.poll(() => bothDead(first), { timeout: 20_000, message: 'leader or grandchild survived disable' }).toBe(true);

    expect(await app.window.evaluate((id) => window.cc.pluginApps.setEnabled(id, true), PLUGIN)).toMatchObject({ ok: true });
    await waitForRunning(app.window, [PLUGIN]);
    const second = await spawnTree(app, pidDir, 'uninstall');
    const removed = await app.window.evaluate((id) => window.cc.pluginApps.remove(id), PLUGIN);
    expect(removed, JSON.stringify(removed)).toMatchObject({ ok: true });
    await expect.poll(() => bothDead(second), { timeout: 20_000, message: 'leader or grandchild survived uninstall' }).toBe(true);
  });

  test('on a forced worker crash', async ({ app, pidDir }) => {
    await waitForRunning(app.window, [PLUGIN]);
    const tree = await spawnTree(app, pidDir, 'crash');
    await rpcOn(app.window, PLUGIN)('crash').catch(() => undefined);
    await expect.poll(() => bothDead(tree), { timeout: 20_000, message: 'leader or grandchild survived the worker crash' }).toBe(true);
  });
});

test('the 8-child cap holds and every capped child is still reaped', async ({ app, pidDir }) => {
  mkdirSync(pidDir, { recursive: true });
  await waitForRunning(app.window, [PLUGIN]);
  const result = await rpcOn(app.window, PLUGIN)<{ pids: number[]; error?: string }>('spawnMany', { dir: pidDir, count: CAP + 1 });
  expect(result.pids).toHaveLength(CAP);
  expect(result.error).toMatch(/limit reached \(8\)/);
  expect(result.pids.every(isAlive)).toBe(true);
  expect(new Set(result.pids).size).toBe(CAP);

  expect(await app.window.evaluate((id) => window.cc.pluginApps.setEnabled(id, false), PLUGIN)).toMatchObject({ ok: true });
  await expect.poll(() => result.pids.filter(isAlive), { timeout: 20_000, message: 'capped children survived disable' }).toEqual([]);
});
