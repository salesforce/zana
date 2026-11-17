import { randomUUID } from 'node:crypto';
import * as nativePty from 'node-pty';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TERMINAL_HOST_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/terminal-execution';
import { createEnrolledPty } from './enrolled-pty.js';
import { createLocalPtyTerminalManager } from './local-pty-host.js';
import { terminatePtyProcessTree } from './pty-termination.js';

vi.mock('node-pty', () => ({ spawn: vi.fn() }));
// Record the handle each close path passes, and never run a real kill.
vi.mock('./pty-termination.js', () => ({ terminatePtyProcessTree: vi.fn() }));

/**
 * node-pty on Windows reports pid 0 until ConPTY has connected, then the real
 * shell pid. The adapters must read it at close time, not copy it at spawn,
 * or the Windows tree stop (pid > 0 only) never runs.
 */
function nativeHandleWithLatePid() {
  const handle = {
    pid: 0,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn()
  };
  vi.mocked(nativePty.spawn).mockReturnValue(handle as never);
  return handle;
}

function closedPid(): number | undefined {
  const calls = vi.mocked(terminatePtyProcessTree).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0]![0].pid;
}

describe('pty adapters read the native pid when they close', () => {
  afterEach(() => {
    vi.mocked(terminatePtyProcessTree).mockReset();
    vi.mocked(nativePty.spawn).mockReset();
  });

  it('enrolled pty passes the pid node-pty reports after spawn', async () => {
    const handle = nativeHandleWithLatePid();
    const pty = createEnrolledPty({ emit: () => {}, shell: '/bin/sh' });
    await pty.startTerminal({ sessionId: 'late-pid', cwd: '/tmp', cols: 80, rows: 24 });
    handle.pid = 4242;
    await pty.stopTerminal({ sessionId: 'late-pid' });
    expect(closedPid()).toBe(4242);
  });

  it('host terminal manager passes the pid node-pty reports after spawn', () => {
    const handle = nativeHandleWithLatePid();
    const manager = createLocalPtyTerminalManager(() => {});
    const binding = { hostId: randomUUID(), instanceId: randomUUID(), hostConnectionId: randomUUID() };
    const base = {
      protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
      binding,
      sessionId: randomUUID(),
      launchEpoch: 0,
      deadlineAt: new Date(Date.now() + 30_000).toISOString()
    };
    manager.handle({
      ...base,
      kind: 'start',
      commandId: randomUUID(),
      projectId: randomUUID(),
      launch: { argv: ['cmd.exe'], cwd: '/tmp', env: { PATH: '/usr/bin' }, cols: 80, rows: 24, mode: 'local-pty' }
    });
    handle.pid = 4343;
    manager.handle({ ...base, kind: 'terminate', commandId: randomUUID(), expected: true });
    expect(closedPid()).toBe(4343);
  });
});
