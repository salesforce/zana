import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import * as pty from 'node-pty';

/**
 * node-pty 1.1.0 leaked a /dev/ptmx (and the parent slave) on every macOS spawn
 * inside native code that JavaScript never saw. PtyManager.finalizeExit /
 * reapDeadSessions cannot close those fds. This test talks to real node-pty so
 * a regression shows up as a climbing /dev/ptmx count, not a mocked destroy().
 */

const SPAWN_COUNT = 20;

function countPtmxFds(): number {
  const output = execFileSync('lsof', ['-p', String(process.pid), '-n', '-P'], {
    encoding: 'utf8'
  });
  return output.split('\n').filter((line) => line.includes('/dev/ptmx')).length;
}

function destroyWhenExited(proc: pty.IPty, kill = false): Promise<void> {
  return new Promise((resolve) => {
    proc.onExit(() => {
      const disposable = proc as pty.IPty & { destroy?: () => void };
      disposable.destroy?.();
      resolve();
    });
    if (kill) proc.kill();
  });
}

describe.skipIf(process.platform !== 'darwin')('macOS node-pty /dev/ptmx leak', () => {
  it('returns /dev/ptmx count to baseline after spawn/destroy', async () => {
    const baseline = countPtmxFds();
    const probe = pty.spawn('/bin/bash', ['-c', 'sleep 60'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24
    });
    expect(countPtmxFds(), 'lsof must observe the live master /dev/ptmx').toBeGreaterThan(baseline);
    await destroyWhenExited(probe, true);

    for (let i = 0; i < SPAWN_COUNT; i++) {
      const proc = pty.spawn('/bin/bash', ['-c', 'echo hello'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24
      });
      await destroyWhenExited(proc);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const final = countPtmxFds();
    expect(
      final,
      `leaked ${final - baseline} /dev/ptmx fds after ${SPAWN_COUNT} spawns (baseline ${baseline}, final ${final})`
    ).toBeLessThanOrEqual(baseline);
  }, 30_000);
});
