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
  it('calls the pty kill without a signal, which node-pty would reject', () => {
    setPlatform('win32');
    const groupKill = vi.spyOn(process, 'kill');
    const handle = windowsPtyHandle();

    terminatePtyProcessTree(handle, { signal: 'SIGTERM' });

    expect(handle.kill).toHaveBeenCalledTimes(1);
    expect(handle.kill).toHaveBeenCalledWith();
    expect(handle.kill.mock.results[0]?.type).toBe('return');
    // No process groups on Windows.
    expect(groupKill).not.toHaveBeenCalled();
  });

  it('swallows a kill that loses the exit race', () => {
    setPlatform('win32');
    const handle: KillablePtyHandle = {
      pid: 4242,
      kill: () => {
        throw new Error('already exited');
      },
    };
    expect(() => terminatePtyProcessTree(handle)).not.toThrow();
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
