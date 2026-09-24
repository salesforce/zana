import { describe, expect, it } from 'vitest';
import type { ZccDatabase } from '@zana-ai/zcc-db';
import { withConversationSend, withConversationSendCancellation, type ConversationSendLease } from './conversation-send-guard.js';

describe('conversation send admission', () => {
  it('cancels retained acceptance callbacks after HTTP preparation has returned', async () => {
    const db = {} as ZccDatabase;
    let lease!: ConversationSendLease;
    let release!: () => void;
    await withConversationSend(db, 'a', async current => { lease = current; release = current.retain(); });
    expect(lease.cancelled).toBe(false);
    await withConversationSendCancellation(db, 'a', async () => {
      expect(() => lease.assertCurrent()).toThrow('cancelled');
      await expect(withConversationSend(db, 'a', async () => {})).rejects.toMatchObject({ code: 'stopping' });
      await withConversationSend(db, 'b', async other => other.assertCurrent());
      await withConversationSend({} as ZccDatabase, 'a', async other => other.assertCurrent());
    });
    release(); release();
    await withConversationSend(db, 'a', async next => next.assertCurrent());
  });

  it('releases cancellation barriers after failures and nested cancellation', async () => {
    const db = {} as ZccDatabase;
    await expect(withConversationSendCancellation(db, 'a', async () => {
      await withConversationSendCancellation(db, 'a', async () => {});
      await expect(withConversationSend(db, 'a', async () => {})).rejects.toMatchObject({ code: 'stopping' });
      throw new Error('stop failed');
    })).rejects.toThrow('stop failed');
    await expect(withConversationSend(db, 'a', async () => { throw new Error('prepare failed'); })).rejects.toThrow('prepare failed');
    await withConversationSend(db, 'a', async lease => lease.assertCurrent());
  });
});
