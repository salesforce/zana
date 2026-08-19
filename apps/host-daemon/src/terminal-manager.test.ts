import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HostTerminalManager, type PtyHandle } from './terminal-manager.js';

function command() {
  return {
    kind: 'start' as const, commandId: randomUUID(), sessionId: randomUUID(), projectId: randomUUID(), launchEpoch: 0,
    deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    launch: { argv: ['zsh'], cwd: '/tmp', env: { PATH: '/usr/bin' }, cols: 120, rows: 40, mode: 'local-pty' as const }
  };
}

describe('HostTerminalManager', () => {
  it('owns local terminal handles and orders output before exit', () => {
    let onData: ((data: string) => void) | undefined;
    let onExit: ((event: { exitCode: number }) => void) | undefined;
    const events: unknown[] = [];
    const handle: PtyHandle = {
      pid: 123, onData: (listener) => { onData = listener; }, onExit: (listener) => { onExit = listener; },
      write: () => {}, resize: () => {}, kill: () => {}
    };
    const manager = new HostTerminalManager({ spawn: () => handle, emit: (event) => events.push(event), hostSessionId: () => 'host-1' });
    const start = command();
    expect(manager.handle(start)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'accepted', hostSessionId: 'host-1' }),
      expect.objectContaining({ kind: 'started', pid: 123 })
    ]));
    onData?.('one');
    onExit?.({ exitCode: 0 });
    expect(events).toMatchObject([
      { kind: 'accepted' }, { kind: 'started' }, { kind: 'output', sequence: 0, data: 'one' }, { kind: 'exited', sequence: 1, code: 0 }
    ]);
  });

  it('deduplicates repeated server command ids', () => {
    const events: unknown[] = [];
    const manager = new HostTerminalManager({
      spawn: () => ({ onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {} }),
      emit: (event) => events.push(event)
    });
    const start = command();
    const first = manager.handle(start);
    expect(manager.handle(start)).toEqual(first);
    expect(events).toHaveLength(2);
  });
});
