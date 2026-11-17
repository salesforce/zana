import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boundReason, createExecutionStore } from '../store.js';

// QA obligations from CodeNod correctness Gate 1 (OBL-004, OBL-013). Tests marked it.fails assert the
// REQUIRED behaviour; the Q-findings (see .zana/reviews/qa-1.md) are fixed and these are plain `it`.

const storeRequest = {
  callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship feature',
  requestDigest: 'digest-1', launchRequestId: 'request-1', resolvedModels: [],
  request: { version: 1 as const, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] }
};

describe('boundReason code-point safety (REQ-3)', () => {
  it('never splits a surrogate pair at the limit', () => {
    const text = `${'a'.repeat(9)}\u{1F600}tail`;
    const bounded = boundReason(text, 10);
    expect(bounded).toBe('a'.repeat(9));
    expect(bounded).not.toMatch(/[\ud800-\udbff]$/);
    expect(boundReason(`${'a'.repeat(8)}\u{1F600}tail`, 10)).toBe(`${'a'.repeat(8)}\u{1F600}`);
  });
});

describe('boundReason path sanitization (REQ-3, OBL-013)', () => {
  it('reduces a plain absolute path and a Windows drive path', () => {
    expect(boundReason('failed at /home/alice/private/token.txt now')).toBe('failed at token.txt now');
    expect(boundReason('failed at C:\\Users\\alice\\token.txt now')).toBe('failed at token.txt now');
  });

  it('does not leak a POSIX path glued to a colon (open:/home/alice/private/token.txt)', () => {
    expect(boundReason('open:/home/alice/private/token.txt')).not.toContain('/home/alice');
  });

  it('R-1: reduces a path after a digit and colon, and one with spaces in a directory name', () => {
    expect(boundReason('exit 1:/Users/alice/private/w.js')).not.toContain('alice');
    expect(boundReason('read /Users/a b/private/c.js failed')).toBe('read c.js failed');
    expect(boundReason('see https://example.com/docs')).toContain('example.com');
  });

  it('Q-1: reduces a Windows UNC path', () => {
    expect(boundReason('read \\\\server\\private\\token.txt failed')).not.toContain('private');
  });
});

describe('warning events keep their kind (REQ-11, REQ-20, OBL-004)', () => {
  it('Q-3: launch-warning and worker-warning stay distinguishable in the durable event stream', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-swi-qa-'));
    try {
      const store = createExecutionStore({ filePath: join(dir, 'executions.json'), id: () => 'execution-1' });
      let record = (await store.claim(storeRequest)).record;
      record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
      record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
      await store.warning(record.id, { kind: 'launch-warning', summary: 'partial launch', slotId: 'slot-1' });
      await store.warning(record.id, { kind: 'worker-warning', summary: 'worker exited', slotId: 'slot-1' });
      const { events } = await store.events('session-1', 'project-1', record.id);
      const warnings = events.filter((event) => event.severity === 'warning');
      expect(warnings).toHaveLength(2);
      expect(JSON.stringify(warnings[0])).toContain('launch-warning');
      expect(JSON.stringify(warnings[1])).toContain('worker-warning');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
