import { isThreadPendingInboxClone, type InboxEntry } from '@zana-ai/zcc-domain/product';
import type { IInboxStore } from '../inbox/inbox-store.js';

export { PENDING_INTERACTION_INBOX_DEDUPE_PREFIX as PENDING_INTERACTION_DEDUPE_PREFIX } from '@zana-ai/zcc-domain/product';

export function isPendingInteractionInboxCopy(
  entry: Pick<InboxEntry, 'dedupeKey' | 'question' | 'questions'> | { dedupeKey?: string }
): boolean {
  return isThreadPendingInboxClone(entry);
}

/**
 * One-shot cleanup of leftover Inbox clones of in-thread pending decisions.
 * New pending interactions no longer fan into Inbox; this drops rows that
 * already exist so they stop pinning "Needs your answer".
 */
export async function prunePendingInteractionInboxCopies(
  inbox: IInboxStore | null | undefined
): Promise<number> {
  if (!inbox) return 0;
  try {
    const { entries } = await inbox.read({ limit: 5000 });
    const ids = entries.filter((e) => isThreadPendingInboxClone(e)).map((e) => e.id);
    if (ids.length === 0) return 0;
    return await inbox.deleteMany(ids);
  } catch {
    return 0;
  }
}
