import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TerminalSessionService } from './terminal-session-service.js';

const sessionId = randomUUID();

function start() {
  return {
    kind: 'start' as const,
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
        { kind: 'accepted' as const, commandId: command.commandId, sessionId, launchEpoch: 0, hostSessionId: 'host-1' },
        { kind: 'started' as const, sessionId, launchEpoch: 0, pid: 123 }
      ]
    });
    await service.execute(start());

    expect(service.record({ kind: 'output', sessionId, launchEpoch: 0, sequence: 0, data: 'one' })).toBe(true);
    expect(service.record({ kind: 'output', sessionId, launchEpoch: 0, sequence: 0, data: 'duplicate' })).toBe(false);
    expect(service.record({ kind: 'output', sessionId, launchEpoch: 1, sequence: 1, data: 'stale' })).toBe(false);
    expect(service.record({ kind: 'exited', sessionId, launchEpoch: 0, sequence: 1, code: 0, expected: true })).toBe(true);
    expect(service.get(sessionId)).toMatchObject({ state: 'exited', nextSequence: 2, expectedExit: true });
  });

  it('accepts output that races ahead of the start response', async () => {
    const service = new TerminalSessionService({ token: 'token', signingKey: 'key', execute: async () => [] });
    const command = start();
    const pending = service.execute(command);

    expect(service.record({ kind: 'accepted', commandId: command.commandId, sessionId, launchEpoch: 0, hostSessionId: 'host-1' })).toBe(true);
    expect(service.record({ kind: 'output', sessionId, launchEpoch: 0, sequence: 0, data: 'early' })).toBe(true);
    await pending;
    expect(service.get(sessionId)).toMatchObject({ state: 'starting', nextSequence: 1 });
  });

  it('retains accepted server events for a late attachment without duplicate output', async () => {
    const service = new TerminalSessionService({
      token: 'token',
      signingKey: 'key',
      execute: async (command) => [
        { kind: 'accepted' as const, commandId: command.commandId, sessionId, launchEpoch: 0, hostSessionId: 'host-1' },
        { kind: 'started' as const, sessionId, launchEpoch: 0, pid: 123 }
      ]
    });
    await service.execute(start());
    service.record({ kind: 'output', sessionId, launchEpoch: 0, sequence: 0, data: 'one' });
    service.record({ kind: 'output', sessionId, launchEpoch: 0, sequence: 0, data: 'duplicate' });
    service.record({ kind: 'output', sessionId, launchEpoch: 0, sequence: 1, data: 'two' });

    expect(service.eventsSince(sessionId).map((event) => event.kind)).toEqual([
      'accepted', 'started', 'output', 'output'
    ]);
    expect(service.eventsSince(sessionId, 0)).toEqual([
      expect.objectContaining({ kind: 'accepted' }),
      expect.objectContaining({ kind: 'started' }),
      expect.objectContaining({ kind: 'output', sequence: 1, data: 'two' })
    ]);
  });
});
