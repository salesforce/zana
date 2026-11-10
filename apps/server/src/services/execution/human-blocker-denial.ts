import { MAX_INBOX_SUBJECT_CHARS } from '../inbox/inbox-store.js';
import type { ExecutionRecord } from './store.js';

type Blocker = NonNullable<ExecutionRecord['blockers']>[number];

/** Subject of the owner's Inbox card for a blocked run; the card and the denial must agree. */
export function blockerCardSubject(record: Pick<ExecutionRecord, 'jobTitle'>): string {
  return record.jobTitle || 'Job Execution Blocked';
}

/** Subject as the Inbox shows it: one line, capped like the Inbox heading. */
function displayedSubject(record: Pick<ExecutionRecord, 'jobTitle'>): string {
  return blockerCardSubject(record).replace(/\s+/g, ' ').trim().slice(0, MAX_INBOX_SUBJECT_CHARS);
}

/**
 * Denial text for a coordinator that tries to answer a human blocker: names the
 * Inbox card the owner answers. Only a notice that is still PENDING means the
 * card is not there yet; a blocker with no notice intent (kickoff / API-error
 * blockers) has its card appended at once, so the card is named without an id.
 */
export function humanBlockerDenial(record: ExecutionRecord, blocker: Pick<Blocker, 'id'>): string {
  const intent = record.noticeIntents?.find((candidate) => candidate.blockerId === blocker.id);
  const prefix = 'blocker requires owner resolution: the owner answers it in the Inbox';
  const subject = displayedSubject(record);
  const ids = `blocker ${blocker.id}, execution ${record.id}`;
  // Same answer path as the Execution board's respond (ExecutionJobDetails -> executionBoard.respond -> respondToBlocker).
  const board = `if there is none, answer blocker ${blocker.id} from the Squad's Execution board`;
  if (intent?.inboxItemId) return `${prefix} card "${subject}" (Inbox entry ${intent.inboxItemId}, ${ids}). Tell the owner to answer that card; do not retry.`;
  if (intent?.status === 'PENDING') return `${prefix} once its card appears (${ids}). Tell the owner to answer that card when it shows up; ${board}; do not retry.`;
  return `${prefix}: look for the card "${subject}" (${ids}); ${board}. Tell the owner this; do not retry.`;
}
