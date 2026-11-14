import { spawn } from 'node:child_process';
import { registerSpawnedTreeRoot } from '@zana-ai/zcc-agent-process-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminatePtyProcessTree, type KillablePtyHandle } from './pty-termination.js';

const realPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** Mirrors node-pty's WindowsTerminal.kill: any signal argument throws. */
function windowsPtyHandle(pid = 4242): KillablePtyHandle & { kill: ReturnType<typeof vi.fn> } {
  return {
    pid,
    kill: vi.fn((signal?: string) => {
      if (signal) throw new Error('Signals not supported on windows.');
    }),
  };
}

afterEach(() => {
  setPlatform(realPlatform);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('terminatePtyProcessTree on Windows', () => {
  it('releases the pty with a signal-less kill, then stops its tree by PID', () => {
    setPlatform('win32');
    const groupKill = vi.spyOn(process, 'kill');
    const order: string[] = [];
    const handle = windowsPtyHandle();
    handle.kill.mockImplementation((signal?: string) => {
      if (signal) throw new Error('Signals not supported on windows.');
      order.push('kill');
    });
    const stopWindowsTree = vi.fn((pid: number) => { order.push(`tree ${pid}`); });

    terminatePtyProcessTree(handle, { signal: 'SIGTERM', stopWindowsTree });

    expect(handle.kill).toHaveBeenCalledTimes(1);
    expect(handle.kill).toHaveBeenCalledWith();
    expect(order).toEqual(['kill', 'tree 4242']);
    // No process groups on Windows.
    expect(groupKill).not.toHaveBeenCalled();
  });

  it('still stops the tree when the pty kill throws', () => {
    setPlatform('win32');
    const stopWindowsTree = vi.fn();
    const handle: KillablePtyHandle = {
      pid: 4242,
      kill: () => {
        throw new Error('already exited');
      },
    };
    expect(() => terminatePtyProcessTree(handle, { stopWindowsTree })).not.toThrow();
    expect(stopWindowsTree).toHaveBeenCalledWith(4242);
  });

  it.each([undefined, 0])('never runs taskkill for pid %s', (pid) => {
    setPlatform('win32');
    const stopWindowsTree = vi.fn();
    const handle = { pid, kill: vi.fn() };
    terminatePtyProcessTree(handle, { stopWindowsTree });
    expect(handle.kill).toHaveBeenCalledWith();
    expect(stopWindowsTree).not.toHaveBeenCalled();
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The default tree stop against real processes: a root whose child was
// started detached, as codex starts its app-server processes.
(realPlatform === 'win32' ? describe : describe.skip)('terminatePtyProcessTree with real taskkill', () => {
  it('ends the root and a detached descendant', { timeout: 30_000 }, async () => {
    const root = spawn(process.execPath, ['-e', [
      "const { spawn } = require('node:child_process');",
      "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true, windowsHide: true });",
      'console.log(g.pid);',
      'setInterval(() => {}, 1000);',
    ].join('\n')], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const grandchild = await new Promise<number>((resolve) => {
      root.stdout.setEncoding('utf8').once('data', (text: string) => resolve(Number(text.trim())));
    });
    // The test runner guard refuses taskkill for any PID this test did not spawn.
    const release = registerSpawnedTreeRoot(root.pid!);
    try {
      expect(isAlive(grandchild)).toBe(true);
      terminatePtyProcessTree({ pid: root.pid, kill: () => undefined });
      const deadline = Date.now() + 20_000;
      while ((isAlive(grandchild) || root.exitCode === null && root.signalCode === null) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(isAlive(grandchild)).toBe(false);
      expect(root.exitCode !== null || root.signalCode !== null).toBe(true);
    } finally {
      release();
      try { process.kill(grandchild); } catch { /* Already gone. */ }
      root.kill();
    }
  });

  it('never runs taskkill for a PID the test did not spawn', () => {
    // The fake handles across host-daemon tests carry made-up PIDs; on a
    // Windows machine those can be live processes, the app's own included.
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      terminatePtyProcessTree({ pid: unrelated.pid, kill: () => undefined });
      expect(isAlive(unrelated.pid!)).toBe(true);
    } finally {
      warn.mockRestore();
      unrelated.kill();
    }
  });
});

describe('terminatePtyProcessTree on POSIX', () => {
  it('signals the process group and the handle, then hard-kills a survivor', () => {
    vi.useFakeTimers();
    setPlatform('linux');
    const groupKill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const handle = { pid: 4242, kill: vi.fn() };

    terminatePtyProcessTree(handle, { signal: 'SIGTERM', hardKillAfterMs: 100 });

    expect(groupKill).toHaveBeenCalledWith(-4242, 'SIGTERM');
    expect(handle.kill).toHaveBeenCalledWith('SIGTERM');
    vi.advanceTimersByTime(100);
    expect(groupKill).toHaveBeenCalledWith(-4242, 0);
    expect(groupKill).toHaveBeenCalledWith(-4242, 'SIGKILL');
  });
});
