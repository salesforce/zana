import {
  hasBlockingQuestion,
  inboxQuestions,
  type InboxEntry
} from '@zana-ai/zcc-domain/product';
import { mdToPlainText } from './plainText.js';

/** Questions older than this drop off the pinned band / landing (still reachable inline). */
export const PINNED_QUESTION_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Primary inbox heading shown across list/overview/detail.
 * Priority: explicit subject -> captured origin title -> compact preview.
 */
export function inboxPrimaryTitle(entry: InboxEntry): string {
  const subject = entry.subject?.trim();
  if (subject) return subject;
  const originTitle = entry.origin?.title?.trim();
  if (originTitle) return originTitle;
  return inboxPreview(entry);
}

/**
 * One-line CONTEXT ("what the agent/user was trying to achieve") for an entry.
 * Priority: explicit author-set `intent` -> captured origin title (the session's
 * task title, so every entry still carries context) -> '' when neither exists.
 * Display-only; callers decide where to render it (detail "Context" line, the
 * pinned questions section, overview rows).
 */
export function inboxIntent(entry: InboxEntry): string {
  const intent = entry.intent?.trim();
  if (intent) return intent;
  return entry.origin?.title?.trim() ?? '';
}

/**
 * Context line for display, SUPPRESSED when it would merely echo the heading
 * (e.g. no explicit intent and the title already fell back to `origin.title`).
 * Use this wherever the title is shown right next to the context so the two
 * don't duplicate; use {@link inboxIntent} when the title isn't adjacent.
 */
export function inboxContextLine(entry: InboxEntry): string {
  const ctx = inboxIntent(entry);
  if (!ctx) return '';
  return ctx === inboxPrimaryTitle(entry) ? '' : ctx;
}

/**
 * One-line secondary text for list rows. Hidden when it would duplicate title.
 */
export function inboxSecondaryLine(entry: InboxEntry): string {
  const preview = inboxPreview(entry);
  return preview === inboxPrimaryTitle(entry) ? '' : preview;
}

/** Editable session context for a new agent opened from an Inbox entry. */
export function buildInboxAgentPrompt(entry: InboxEntry, opening = 'Act on the following inbox message from this project.'): string {
  const parts = [opening];
  if (entry.docs?.length) {
    parts.push('', 'Related documents (paths relative to the project root):');
    for (const doc of entry.docs) parts.push(`- ${doc.path}`);
  }
  const comments = entry.comments?.trim();
  if (comments) {
    parts.push('', 'Message:', comments.length > 4000 ? `${comments.slice(0, 4000)}\n…(truncated)` : comments);
  }
  return parts.join('\n');
}

/**
 * Compact title form for chips/buttons where long titles are noisy.
 */
export function inboxShortTitle(entry: InboxEntry, max = 120): string {
  return inboxPrimaryTitle(entry).slice(0, max);
}

const TABLE_SEPARATOR_LINE = /^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

/** A GFM table row (`| a | b |`) or its `|---|---|` separator; not a readable one-liner. */
function isMarkdownTableLine(line: string): boolean {
  return line.trimStart().startsWith('|') || TABLE_SEPARATOR_LINE.test(line);
}

/**
 * Build a compact preview from comments/docs. Markdown table rows are skipped.
 */
export function inboxPreview(entry: InboxEntry): string {
  const c = (entry.comments ?? '').trim();
  const firstLine = c.split('\n').find((l) => l.trim().length > 0 && !isMarkdownTableLine(l));
  if (firstLine) return mdToPlainText(firstLine);
  // A table-only comment has no one-line summary: fall through to docs / nothing.
  if (c && !entry.docs?.length) return '';
  if (entry.docs && entry.docs.length > 0) {
    const d = entry.docs[0];
    if (d) {
      const suffix = entry.docs.length > 1 ? ` · +${entry.docs.length - 1} more` : '';
      return `📄 ${d.path}${suffix}`;
    }
  }
  return '';
}

/** True when the entry still has a structured question the user hasn't answered. */
export function isUnansweredQuestion(
  entry: InboxEntry,
  answeredIds: Record<string, true>
): boolean {
  return inboxQuestions(entry).length > 0 && !answeredIds[entry.id];
}

export function inboxOffersAgentFix(entry: InboxEntry): boolean {
  return entry.offerAgentFix === true && !!entry.extensionSource && !entry.hostActionRequired;
}

/**
 * Fresh unanswered BLOCKING question — the pin-band / attention-landing set.
 * Soft questions stay inline and answerable; they don't take a pinned slot.
 */
export function isPinnedBlockingQuestion(
  entry: InboxEntry,
  answeredIds: Record<string, true>,
  now = Date.now()
): boolean {
  return (
    entry.ts >= now - PINNED_QUESTION_MAX_AGE_MS &&
    isUnansweredQuestion(entry, answeredIds) &&
    hasBlockingQuestion(entry)
  );
}
