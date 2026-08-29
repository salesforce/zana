import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  TERMINAL_HOST_PROTOCOL_VERSION,
  TerminalHostCommandSchema,
  TerminalHostEventSchema
} from './terminal-execution.js';

const commandId = randomUUID();
const sessionId = randomUUID();
const projectId = randomUUID();
const deadlineAt = new Date(Date.now() + 30_000).toISOString();
const binding = { hostId: randomUUID(), instanceId: randomUUID(), hostConnectionId: randomUUID() };

describe('terminal host contract', () => {
  it('accepts a bounded server-issued local terminal start command', () => {
    expect(TerminalHostCommandSchema.parse({
      kind: 'start', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, binding, commandId, sessionId, projectId, launchEpoch: 0, deadlineAt,
      launch: { argv: ['zsh'], cwd: '/tmp', env: { PATH: '/usr/bin' }, cols: 120, rows: 40, mode: 'local-pty' }
    })).toMatchObject({ kind: 'start', sessionId, projectId });
  });

  it('requires ordered output and an exit sequence', () => {
    expect(TerminalHostEventSchema.parse({ kind: 'output', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, binding, sessionId, launchEpoch: 2, sequence: 4, data: 'ready' }))
      .toMatchObject({ kind: 'output', sequence: 4 });
    expect(() => TerminalHostEventSchema.parse({ kind: 'exited', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, binding, sessionId, launchEpoch: 2, code: 0, expected: true }))
      .toThrow();
  });

  it('rejects an incompatible server-to-host protocol version', () => {
    expect(TerminalHostCommandSchema.safeParse({
      kind: 'write',
      protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION + 1,
      binding,
      commandId,
      sessionId,
      launchEpoch: 0,
      deadlineAt,
      data: 'input'
    }).success).toBe(false);
  });

  it('requires a complete host binding on commands and events', () => {
    expect(TerminalHostCommandSchema.safeParse({
      kind: 'write', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, commandId, sessionId,
      launchEpoch: 0, deadlineAt, data: 'input'
    }).success).toBe(false);
    expect(TerminalHostEventSchema.safeParse({
      kind: 'rejected', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, commandId,
      sessionId, launchEpoch: 0, reason: 'stale'
    }).success).toBe(false);
  });
});
