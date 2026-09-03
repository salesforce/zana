import { describe, expect, it } from 'vitest';
import { createEnrolledPty, type EnrolledPtyHandle } from './enrolled-pty.js';
import type { HostEventEnvelope } from '@zana-ai/zcc-contracts/host-rpc';

function fakeHandle(): EnrolledPtyHandle & {
  writes: string[];
  resizes: Array<{ cols: number; rows: number }>;
  killed: boolean;
  data?: (chunk: string) => void;
  exit?: (event: { exitCode: number }) => void;
} {
  const handle = {
    pid: 7,
    writes: [] as string[],
    resizes: [] as Array<{ cols: number; rows: number }>,
    killed: false,
    data: undefined as ((chunk: string) => void) | undefined,
    exit: undefined as ((event: { exitCode: number }) => void) | undefined,
    write(data: string) { handle.writes.push(data); },
    resize(cols: number, rows: number) { handle.resizes.push({ cols, rows }); },
    kill() { handle.killed = true; },
    onData(listener: (data: string) => void) { handle.data = listener; },
    onExit(listener: (event: { exitCode: number }) => void) { handle.exit = listener; }
  };
  return handle;
}

describe('enrolled pty', () => {
  it('starts, writes, resizes, and emits output plus exit', async () => {
    const events: HostEventEnvelope[] = [];
    const handle = fakeHandle();
    const pty = createEnrolledPty({
      emit: (event) => events.push(event),
      spawn: () => handle
    });
    const started = await pty.startTerminal({
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: '/tmp',
      cols: 80,
      rows: 24
    });
    expect(started.pid).toBe(7);
    handle.data?.('hello');
    await pty.writeTerminal({ sessionId: '11111111-1111-4111-8111-111111111111', data: 'ls\n' });
    await pty.resizeTerminal({ sessionId: '11111111-1111-4111-8111-111111111111', cols: 120, rows: 40 });
    handle.exit?.({ exitCode: 0 });
    expect(handle.writes).toEqual(['ls\n']);
    expect(handle.resizes).toEqual([{ cols: 120, rows: 40 }]);
    expect(events).toEqual([
      {
        terminalId: '11111111-1111-4111-8111-111111111111',
        kind: 'terminal.output',
        payload: { data: 'hello' }
      },
      {
        terminalId: '11111111-1111-4111-8111-111111111111',
        kind: 'terminal.exited',
        payload: { exitCode: 0 }
      }
    ]);
  });

  it('passes a login-shell -lc argv when a launch string is set', async () => {
    const spawned: Array<{ args: string[] }> = [];
    const handle = fakeHandle();
    const pty = createEnrolledPty({
      emit: () => {},
      spawn: (_file, args) => {
        spawned.push({ args });
        return handle;
      }
    });
    await pty.startTerminal({
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      command: '  npm run dev  '
    });
    expect(spawned).toEqual([{ args: ['-lc', 'npm run dev'] }]);
    await pty.startTerminal({
      sessionId: '11111111-1111-4111-8111-111111111112',
      cwd: '/tmp',
      cols: 80,
      rows: 24
    });
    expect(spawned[1]).toEqual({ args: ['-l'] });
  });
});
