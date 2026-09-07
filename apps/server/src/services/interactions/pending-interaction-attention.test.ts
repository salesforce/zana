import { describe, expect, it } from 'vitest';
import type { IInboxStore } from '../inbox/inbox-store.js';
import {
  isPendingInteractionInboxCopy,
  PENDING_INTERACTION_DEDUPE_PREFIX,
  prunePendingInteractionInboxCopies
} from './pending-interaction-attention.js';

function inboxStub(args: {
  entries?: Array<{
    id: string;
    dedupeKey?: string;
    subject?: string;
    question?: { options: Array<{ id: string; label: string }>; blocking?: boolean };
  }>;
  read?: IInboxStore['read'];
  deleteMany?: IInboxStore['deleteMany'];
}): IInboxStore {
  return {
    read: args.read ?? (async () => ({ entries: args.entries ?? [], hasMore: false })),
    deleteMany: args.deleteMany ?? (async (ids) => ids.length),
    append: async () => {
      throw new Error('append should not run');
    },
    delete: async () => false,
    onAppended: () => () => undefined,
    onRemoved: () => () => undefined,
    onUpdated: () => () => undefined,
    onPruned: () => () => undefined
  } as IInboxStore;
}

describe('pending interaction inbox copies', () => {
  it('matches leftover clones by prefix or Open-thread-only question', () => {
    expect(isPendingInteractionInboxCopy({ dedupeKey: `${PENDING_INTERACTION_DEDUPE_PREFIX}pint_1` })).toBe(true);
    expect(isPendingInteractionInboxCopy({
      question: { options: [{ id: 'A', label: 'Open thread' }], blocking: true }
    })).toBe(true);
    expect(isPendingInteractionInboxCopy({ dedupeKey: 'inbox-ask:q1' })).toBe(false);
    expect(isPendingInteractionInboxCopy({})).toBe(false);
  });

  it('prunes leftover pending-interaction clones and leaves inbox_ask questions', async () => {
    const deleted: string[] = [];
    const inbox = inboxStub({
      entries: [
        { id: 'c1', dedupeKey: `${PENDING_INTERACTION_DEDUPE_PREFIX}pint_attn`, subject: 'Approval needed' },
        {
          id: 'c2',
          subject: 'Approval needed',
          question: { options: [{ id: 'A', label: 'Open thread' }], blocking: true }
        },
        { id: 'keep', subject: 'Ready to ship?' }
      ],
      deleteMany: async (ids) => {
        deleted.push(...ids);
        return ids.length;
      }
    });

    const removed = await prunePendingInteractionInboxCopies(inbox);
    expect(removed).toBe(2);
    expect(deleted).toEqual(['c1', 'c2']);
  });

  it('does not throw when inbox read fails', async () => {
    const removed = await prunePendingInteractionInboxCopies(inboxStub({
      read: async () => {
        throw new Error('boom');
      }
    }));
    expect(removed).toBe(0);
  });

  it('returns 0 when inbox is absent or already clean', async () => {
    expect(await prunePendingInteractionInboxCopies(null)).toBe(0);
    expect(await prunePendingInteractionInboxCopies(undefined)).toBe(0);
    const deleteMany = async () => {
      throw new Error('deleteMany should not run');
    };
    expect(await prunePendingInteractionInboxCopies(inboxStub({ entries: [{ id: 'keep' }], deleteMany }))).toBe(0);
  });
});
