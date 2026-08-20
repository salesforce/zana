import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TERMINAL_HOST_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/terminal-execution';
import { createRuntimeDatabase } from './runtime-database.js';

describe('runtime database', () => {
  it('migrates once and restores accepted terminal sessions and replay events after restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zcc-runtime-db-'));
    const file = join(directory, 'runtime.sqlite');
    const sessionId = randomUUID();
    const repository = createRuntimeDatabase(file);
    repository.saveSession({
      sessionId,
      launchEpoch: 2,
      state: 'running',
      accepted: true,
      pid: 4321,
      nextSequence: 2
    });
    repository.appendEvent({
      kind: 'accepted',
      protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
      commandId: randomUUID(),
      sessionId,
      launchEpoch: 2,
      hostSessionId: 'host-1'
    });
    repository.appendEvent({
      kind: 'output',
      protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
      sessionId,
      launchEpoch: 2,
      sequence: 0,
      data: 'first'
    });
    repository.appendEvent({
      kind: 'output',
      protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
      sessionId,
      launchEpoch: 2,
      sequence: 1,
      data: 'second'
    });
    repository.close();

    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    const reopened = createRuntimeDatabase(file);
    expect(reopened.getSession(sessionId)).toEqual({
      sessionId,
      launchEpoch: 2,
      state: 'running',
      accepted: true,
      pid: 4321,
      nextSequence: 2
    });
    expect(reopened.eventsSince(sessionId, 0)).toEqual([
      expect.objectContaining({ kind: 'accepted' }),
      expect.objectContaining({ kind: 'output', sequence: 1, data: 'second' })
    ]);
    reopened.close();
  });

  it('bounds per-session durable replay without touching another session', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'zcc-runtime-db-')), 'nested', 'runtime.sqlite');
    const primarySessionId = randomUUID();
    const otherSessionId = randomUUID();
    const repository = createRuntimeDatabase(file);
    for (const sessionId of [primarySessionId, otherSessionId]) {
      repository.saveSession({
        sessionId,
        launchEpoch: 0,
        state: 'running',
        accepted: true,
        nextSequence: 0
      });
    }
    for (let sequence = 0; sequence <= 1_000; sequence++) {
      repository.appendEvent({
        kind: 'output',
        protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
        sessionId: primarySessionId,
        launchEpoch: 0,
        sequence,
        data: String(sequence)
      });
    }
    repository.appendEvent({
      kind: 'output',
      protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
      sessionId: otherSessionId,
      launchEpoch: 0,
      sequence: 0,
      data: 'other'
    });

    const primary = repository.eventsSince(primarySessionId, -1);
    expect(primary).toHaveLength(1_000);
    expect(primary.at(0)).toMatchObject({ sequence: 1, data: '1' });
    expect(repository.eventsSince(otherSessionId, -1)).toEqual([
      expect.objectContaining({ sequence: 0, data: 'other' })
    ]);
    repository.close();
  });

  it('replaces an existing host connection lease and rejects the old lease', () => {
    const repository = createRuntimeDatabase(join(mkdtempSync(join(tmpdir(), 'zcc-runtime-db-')), 'runtime.sqlite'));
    const hostId = randomUUID();
    const first = { hostId, instanceId: randomUUID(), hostConnectionId: randomUUID() };
    const second = { hostId, instanceId: randomUUID(), hostConnectionId: randomUUID() };
    repository.activateHostConnection(first, Date.now() + 30_000);
    expect(repository.isActiveHostConnection(first)).toBe(true);
    repository.activateHostConnection(second, Date.now() + 30_000);
    expect(repository.isActiveHostConnection(first)).toBe(false);
    expect(repository.isActiveHostConnection(second)).toBe(true);
    repository.close();
  });
});
