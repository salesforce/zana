import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../connection.js';
import { createEnvironment } from './environments.js';
import { upsertHost } from './hosts.js';
import { createConversationThread } from './conversation-threads.js';
import {
  clearDispatchAdmissionGeneration,
  consumeDispatchAdmissionOverride,
  getDispatchAdmissionGeneration,
  recordDispatchAdmissionWait
} from './dispatch-admission-generations.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-dispatch-admission-'));
  const db = openDatabase(join(dir, 'runtime.sqlite'));
  const host = upsertHost(db, { name: 'host', hostKeyHash: 'hash' });
  const environment = createEnvironment(db, { projectId: 'project', hostId: host.id });
  const thread = createConversationThread(db, {
    projectId: 'project',
    hostId: host.id,
    environmentId: environment.id,
    providerId: 'claude-code'
  });
  return {
    db,
    threadId: thread.id,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

describe('dispatch admission generations', () => {
  it('starts a fresh thread at generation 1 and increments on repeated waits', () => {
    const f = fixture();
    try {
      const first = recordDispatchAdmissionWait(f.db, { threadId: f.threadId, overrideable: true, reason: 'busy' });
      expect(first.generation).toBe(1);
      const second = recordDispatchAdmissionWait(f.db, { threadId: f.threadId, overrideable: true, reason: 'still busy' });
      expect(second.generation).toBe(2);
      expect(getDispatchAdmissionGeneration(f.db, f.threadId)).toMatchObject({ generation: 2, reason: 'still busy' });
    } finally { f.cleanup(); }
  });

  it('consumes the current generation exactly once (CAS)', () => {
    const f = fixture();
    try {
      const recorded = recordDispatchAdmissionWait(f.db, { threadId: f.threadId, overrideable: true, reason: 'busy' });
      expect(consumeDispatchAdmissionOverride(f.db, { threadId: f.threadId, generation: recorded.generation })).toBe(true);
      // A second click (duplicate) on the same generation finds nothing left to consume.
      expect(consumeDispatchAdmissionOverride(f.db, { threadId: f.threadId, generation: recorded.generation })).toBe(false);
    } finally { f.cleanup(); }
  });

  it('rejects a stale generation when a newer wait superseded it', () => {
    const f = fixture();
    try {
      const first = recordDispatchAdmissionWait(f.db, { threadId: f.threadId, overrideable: true, reason: 'busy' });
      recordDispatchAdmissionWait(f.db, { threadId: f.threadId, overrideable: true, reason: 'busy again' });
      expect(consumeDispatchAdmissionOverride(f.db, { threadId: f.threadId, generation: first.generation })).toBe(false);
    } finally { f.cleanup(); }
  });

  it('rejects a forged/invented generation that was never recorded', () => {
    const f = fixture();
    try {
      expect(consumeDispatchAdmissionOverride(f.db, { threadId: f.threadId, generation: 999 })).toBe(false);
    } finally { f.cleanup(); }
  });

  it('never consumes a non-overrideable wait, even with the matching generation', () => {
    const f = fixture();
    try {
      const recorded = recordDispatchAdmissionWait(f.db, { threadId: f.threadId, overrideable: false, reason: 'policy' });
      expect(consumeDispatchAdmissionOverride(f.db, { threadId: f.threadId, generation: recorded.generation })).toBe(false);
    } finally { f.cleanup(); }
  });

  it('clearing on proceed starts the next wait lineage fresh at generation 1', () => {
    const f = fixture();
    try {
      recordDispatchAdmissionWait(f.db, { threadId: f.threadId, overrideable: true, reason: 'busy' });
      clearDispatchAdmissionGeneration(f.db, f.threadId);
      expect(getDispatchAdmissionGeneration(f.db, f.threadId)).toBeNull();
      const next = recordDispatchAdmissionWait(f.db, { threadId: f.threadId, overrideable: true, reason: 'busy again' });
      expect(next.generation).toBe(1);
    } finally { f.cleanup(); }
  });
});
