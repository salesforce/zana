import { describe, it, expect } from 'vitest';
import { isThreadLiveInProject } from './thread-liveness.js';
import type { ConversationThreadRow } from '@zana-ai/zcc-db';

function row(over: Partial<ConversationThreadRow> = {}): ConversationThreadRow {
  return {
    id: 'thread-1',
    projectId: 'p1',
    status: 'active',
    archivedAt: null,
    ...over
  } as ConversationThreadRow;
}

describe('isThreadLiveInProject', () => {
  it('accepts a non-archived usable owner thread in the asserted project', () => {
    expect(isThreadLiveInProject(row({ status: 'starting' }), 'p1')).toBe(true);
    expect(isThreadLiveInProject(row({ status: 'active' }), 'p1')).toBe(true);
    expect(isThreadLiveInProject(row({ status: 'idle' }), 'p1')).toBe(true);
    expect(isThreadLiveInProject(row({ status: 'stopping' }), 'p1')).toBe(true);
  });

  it('accepts an errored thread the user is still driving (one past turn failed is not death)', () => {
    // Regression: an `error` owner thread was permanently denied execution.start
    // ("session MCP is not authorized for this live session"). error reflects a
    // past turn/failed, not thread death — the composer stays live and fresh
    // turns run, so the owner must still launch.
    expect(isThreadLiveInProject(row({ status: 'error' }), 'p1')).toBe(true);
  });

  it('rejects a missing thread', () => {
    expect(isThreadLiveInProject(null, 'p1')).toBe(false);
    expect(isThreadLiveInProject(undefined, 'p1')).toBe(false);
  });

  it('rejects a thread in a different project (no cross-project launcher)', () => {
    expect(isThreadLiveInProject(row({ projectId: 'other' }), 'p1')).toBe(false);
  });

  it('rejects an archived thread even while its status still reads live', () => {
    expect(isThreadLiveInProject(row({ archivedAt: 1_700_000_000, status: 'active' }), 'p1')).toBe(false);
    // Archival is the real death signal, and it wins over any live-looking
    // status — including error.
    expect(isThreadLiveInProject(row({ archivedAt: 1_700_000_000, status: 'error' }), 'p1')).toBe(false);
  });
});
