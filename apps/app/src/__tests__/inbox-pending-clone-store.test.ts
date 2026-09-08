import { describe, expect, it } from 'vitest';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import { useInbox } from '../store.js';

function entry(overrides: Partial<InboxEntry> & Pick<InboxEntry, 'id'>): InboxEntry {
  return {
    ts: 1,
    projectId: 'p1',
    comments: 'hello',
    ...overrides
  };
}

describe('useInbox pending clones', () => {
  it('drops thread-approval clones on load and live prepend', () => {
    const clone = entry({
      id: 'c1',
      comments: 'Approval needed',
      dedupeKey: 'pending-interaction:pint',
      question: { options: [{ id: 'A', label: 'Open thread' }], blocking: true }
    });
    const keep = entry({
      id: 'k1',
      comments: 'Ship it?',
      question: { options: [{ id: 'yes', label: 'Yes' }], blocking: true }
    });
    useInbox.getState().setEntries([clone, keep]);
    expect(useInbox.getState().entries.map((e) => e.id)).toEqual(['k1']);
    useInbox.getState().prepend(clone);
    expect(useInbox.getState().entries.map((e) => e.id)).toEqual(['k1']);
  });
});
