import type { ExecutionRecord } from './store.js';

type Blocker = NonNullable<ExecutionRecord['blockers']>[number];

/** Subject of the owner's Inbox card for a blocked run; the card and the denial must agree. */
export function blockerCardSubject(record: Pick<ExecutionRecord, 'jobTitle'>): string {
  return record.jobTitle || 'Job Execution Blocked';
}

/**
 * Denial text for a coordinator that tries to answer a human blocker: names the
 * Inbox card the owner answers, or says the card has not appeared yet.
 */
export function humanBlockerDenial(record: ExecutionRecord, blocker: Pick<Blocker, 'id'>): string {
  const key = `execution-blocker:${record.id}:${blocker.id}`;
  const inboxItemId = record.noticeIntents?.find((intent) => intent.key === key)?.inboxItemId;
  const prefix = 'blocker requires owner resolution: the owner answers it in the Inbox';
  if (!inboxItemId) return `${prefix} once its card appears (blocker ${blocker.id}). Tell the owner to answer that card when it shows up; do not retry.`;
  return `${prefix} card "${blockerCardSubject(record)}" (Inbox entry ${inboxItemId}). Tell the owner to answer that card; do not retry.`;
}
