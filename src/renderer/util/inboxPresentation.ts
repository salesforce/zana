import type { InboxEntry } from '@shared/types';
import { mdToPlainText } from './plainText';

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

/**
 * Compact title form for chips/buttons where long titles are noisy.
 */
export function inboxShortTitle(entry: InboxEntry, max = 120): string {
  return inboxPrimaryTitle(entry).slice(0, max);
}

/**
 * Build a compact preview from comments/docs.
 */
export function inboxPreview(entry: InboxEntry): string {
  const c = (entry.comments ?? '').trim();
  if (c) {
    const firstLine = c.split('\n').find((l) => l.trim().length > 0) ?? '';
    return mdToPlainText(firstLine);
  }
  if (entry.docs && entry.docs.length > 0) {
    const d = entry.docs[0];
    if (d) {
      const suffix = entry.docs.length > 1 ? ` · +${entry.docs.length - 1} more` : '';
      return `📄 ${d.path}${suffix}`;
    }
  }
  return '';
}
