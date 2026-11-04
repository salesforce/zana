/**
 * Copy for Close with follow-up on a conversation thread, shared by the thread
 * header menu (ThreadDetailOverflow) and the thread card menu (threadCardActions)
 * so the two entry points always say the same thing.
 */

/** The confirm text; with "Wrap up before closing" on, it says what happens first. */
export function threadCloseFollowupConfirm(title: string, wrapUp: boolean): string {
  return wrapUp
    ? `Close “${title}” with follow-up? The agent first saves what it learnt and tidies up, then closes with a summary in your inbox. If it asks you something, it stays open.`
    : `Close “${title}” and file a follow-up if work is left?`;
}

/**
 * The toast for a close that left the thread in place: it already waits on the
 * user, or it is wrapping up in the background. Null when the thread closed now.
 */
export function threadCloseFollowupToast(
  title: string,
  result: { keptOpen?: unknown; wrappingUp?: unknown } | null | undefined
): string | null {
  if (result?.keptOpen) return `“${title}” is waiting on your answer, so it was left open (see your inbox).`;
  if (result?.wrappingUp) return `Wrapping up… “${title}” closes when it finishes.`;
  return null;
}
