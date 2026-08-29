import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HostTerminalManager, type PtyHandle } from './terminal-manager.js';
import { TERMINAL_HOST_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/terminal-execution';

const binding = { hostId: randomUUID(), instanceId: randomUUID(), hostConnectionId: randomUUID() };

function command() {
  return {
    kind: 'start' as const, protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, binding, commandId: randomUUID(), sessionId: randomUUID(), projectId: randomUUID(), launchEpoch: 0,
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
    const manager = new HostTerminalManager({ spawn: () => handle, emit: (event) => events.push(event) });
    const start = command();
    expect(manager.handle(start)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'accepted', hostSessionId: binding.hostConnectionId }),
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

  it('rejects a command bound to another server lease', () => {
    const manager = new HostTerminalManager({
      spawn: () => ({ onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {} }),
      emit: () => {}
    });
    const start = command();
    manager.handle(start);
    const { projectId: _projectId, launch: _launch, ...writeBase } = start;
    expect(manager.handle({
      ...writeBase,
      kind: 'write',
      commandId: randomUUID(),
      binding: { ...binding, hostConnectionId: randomUUID() },
      data: 'input'
    })).toEqual([expect.objectContaining({ kind: 'rejected' })]);
  });

  it('terminates every live terminal when its host shuts down', () => {
    let killed = 0;
    let exits = 0;
    const handles: Array<{ exit?: (event: { exitCode: number }) => void }> = [];
    const manager = new HostTerminalManager({
      spawn: () => ({
        onData: () => {},
        onExit: (listener) => { handles.push({ exit: listener }); },
        write: () => {},
        resize: () => {},
        kill: () => {
          killed += 1;
          handles.at(killed - 1)?.exit?.({ exitCode: 0 });
        }
      }),
      emit: (event) => { if (event.kind === 'exited') exits += 1; }
    });
    manager.handle(command());
    manager.handle(command());

    manager.close();

    expect(killed).toBe(2);
    expect(exits).toBe(2);
  });

  it('terminates terminals when their server lease is replaced', () => {
    let killed = 0;
    const manager = new HostTerminalManager({
      spawn: () => ({ onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => { killed += 1; } }),
      emit: () => {}
    });
    manager.handle(command());

    manager.revokeBinding(binding);

    expect(killed).toBe(1);
  });
});
