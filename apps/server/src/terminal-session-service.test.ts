import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TerminalSessionService } from './terminal-session-service.js';
import { TERMINAL_HOST_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/terminal-execution';
import { createRuntimeDatabase } from './runtime-database.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sessionId = randomUUID();
const binding = { hostId: randomUUID(), instanceId: randomUUID(), hostConnectionId: randomUUID() };

function start() {
  return {
    kind: 'start' as const,
    protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
    commandId: randomUUID(),
    sessionId,
    projectId: randomUUID(),
    launchEpoch: 0,
    deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    launch: { argv: ['zsh'], cwd: '/tmp', env: { PATH: '/usr/bin' }, cols: 80, rows: 24, mode: 'local-pty' as const }
  };
}

describe('TerminalSessionService', () => {
  it('owns the accepted epoch and filters duplicate host output', async () => {
    const service = new TerminalSessionService({
      token: 'token',
      signingKey: 'key',
      execute: async (command) => [
        { kind: 'accepted' as const, protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, commandId: command.commandId, sessionId, launchEpoch: 0, hostSessionId: 'host-1' },
        { kind: 'started' as const, protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, sessionId, launchEpoch: 0, pid: 123 }
      ]
    });
    await service.execute(start());

    expect(service.record({ kind: 'output', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, sessionId, launchEpoch: 0, sequence: 0, data: 'one' })).toBe(true);
    expect(service.record({ kind: 'output', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, sessionId, launchEpoch: 0, sequence: 0, data: 'duplicate' })).toBe(false);
    expect(service.record({ kind: 'output', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, sessionId, launchEpoch: 1, sequence: 1, data: 'stale' })).toBe(false);
    expect(service.record({ kind: 'exited', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, sessionId, launchEpoch: 0, sequence: 1, code: 0, expected: true })).toBe(true);
    expect(service.get(sessionId)).toMatchObject({ state: 'exited', nextSequence: 2, expectedExit: true });
  });

  it('accepts output that races ahead of the start response', async () => {
    const service = new TerminalSessionService({ token: 'token', signingKey: 'key', execute: async () => [] });
    const command = start();
    const pending = service.execute(command);

    expect(service.record({ kind: 'accepted', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, commandId: command.commandId, sessionId, launchEpoch: 0, hostSessionId: 'host-1' })).toBe(true);
    expect(service.record({ kind: 'output', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, sessionId, launchEpoch: 0, sequence: 0, data: 'early' })).toBe(true);
    await pending;
    expect(service.get(sessionId)).toMatchObject({ state: 'starting', nextSequence: 1 });
  });

  it('retains accepted server events for a late attachment without duplicate output', async () => {
    const service = new TerminalSessionService({
      token: 'token',
      signingKey: 'key',
      execute: async (command) => [
        { kind: 'accepted' as const, protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, commandId: command.commandId, sessionId, launchEpoch: 0, hostSessionId: 'host-1' },
        { kind: 'started' as const, protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, sessionId, launchEpoch: 0, pid: 123 }
      ]
    });
    await service.execute(start());
    service.record({ kind: 'output', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, sessionId, launchEpoch: 0, sequence: 0, data: 'one' });
    service.record({ kind: 'output', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, sessionId, launchEpoch: 0, sequence: 0, data: 'duplicate' });
    service.record({ kind: 'output', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, sessionId, launchEpoch: 0, sequence: 1, data: 'two' });

    expect(service.eventsSince(sessionId).map((event) => event.kind)).toEqual([
      'accepted', 'started', 'output', 'output'
    ]);
    expect(service.eventsSince(sessionId, 0)).toEqual([
      expect.objectContaining({ kind: 'accepted' }),
      expect.objectContaining({ kind: 'started' }),
      expect.objectContaining({ kind: 'output', sequence: 1, data: 'two' })
    ]);
  });

  it('replays server-accepted events after the terminal authority restarts', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'zcc-terminal-session-')), 'runtime.sqlite');
    const command = start();
    const repository = createRuntimeDatabase(file);
    const execution = {
      token: 'token',
      signingKey: 'key',
      execute: async () => [
        { kind: 'accepted' as const, protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, commandId: command.commandId, sessionId, launchEpoch: 0, hostSessionId: 'host-1' },
        { kind: 'started' as const, protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, sessionId, launchEpoch: 0, pid: 123 }
      ]
    };
    const first = new TerminalSessionService(execution, repository);
    await first.execute(command);
    first.record({ kind: 'output', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, sessionId, launchEpoch: 0, sequence: 0, data: 'persisted' });
    repository.close();

    const restarted = new TerminalSessionService(execution, createRuntimeDatabase(file));
    expect(restarted.get(sessionId)).toMatchObject({ state: 'running', nextSequence: 1 });
    expect(restarted.eventsSince(sessionId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'output', sequence: 0, data: 'persisted' })
    ]));
  });

  it('rejects an event from a replaced host connection lease', async () => {
    const service = new TerminalSessionService({
      token: 'token',
      signingKey: 'key',
      binding,
      connect: async () => Date.now() + 30_000,
      execute: async (command) => [
        { kind: 'accepted' as const, protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, binding, commandId: command.commandId, sessionId, launchEpoch: 0, hostSessionId: 'host-1' },
        { kind: 'started' as const, protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, binding, sessionId, launchEpoch: 0, pid: 123 }
      ]
    });
    await service.refreshHostConnection();
    await service.execute(start());
    expect(service.record({
      kind: 'output', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
      binding: { ...binding, hostConnectionId: randomUUID() },
      sessionId, launchEpoch: 0, sequence: 0, data: 'stale lease'
    })).toBe(false);
    expect(service.record({
      kind: 'output', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
      binding, sessionId, launchEpoch: 0, sequence: 0, data: 'current lease'
    })).toBe(true);
  });
});
