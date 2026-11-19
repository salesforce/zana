// Counter text shared by every find bar (thread search, rendered-content find).

/** Why a partial count may be low: the server could not count unloaded or collapsed messages. */
export const THREAD_SEARCH_PARTIAL_NOTE = 'Some messages weren’t searched';

/** The visible counter: `3/7`, or `0/0` when nothing matches; `+` marks a partial count. */
export function threadSearchCounterText(index: number, count: number, partial = false): string {
  const text = count === 0 ? '0/0' : `${index + 1}/${count}`;
  return partial ? `${text}+` : text;
}

/** What screen readers hear when the counter changes. */
export function threadSearchAnnouncement(index: number, count: number, partial = false): string {
  const text = count === 0
    ? 'No matches'
    : index < 0 ? `${count} ${count === 1 ? 'match' : 'matches'}` : `Match ${index + 1} of ${count}`;
  return partial ? `${text}. ${THREAD_SEARCH_PARTIAL_NOTE}` : text;
}
