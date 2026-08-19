import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TerminalHostCommandSchema, TerminalHostEventSchema } from './terminal-execution.js';

const commandId = randomUUID();
const sessionId = randomUUID();
const projectId = randomUUID();
const deadlineAt = new Date(Date.now() + 30_000).toISOString();

describe('terminal host contract', () => {
  it('accepts a bounded server-issued local terminal start command', () => {
    expect(TerminalHostCommandSchema.parse({
      kind: 'start', commandId, sessionId, projectId, launchEpoch: 0, deadlineAt,
      launch: { argv: ['zsh'], cwd: '/tmp', env: { PATH: '/usr/bin' }, cols: 120, rows: 40, mode: 'local-pty' }
    })).toMatchObject({ kind: 'start', sessionId, projectId });
  });

  it('requires ordered output and an exit sequence', () => {
    expect(TerminalHostEventSchema.parse({ kind: 'output', sessionId, launchEpoch: 2, sequence: 4, data: 'ready' }))
      .toMatchObject({ kind: 'output', sequence: 4 });
    expect(() => TerminalHostEventSchema.parse({ kind: 'exited', sessionId, launchEpoch: 2, code: 0, expected: true }))
      .toThrow();
  });
});
