/**
 * Pure decision for the Inbox detail pane's "answer surface" — the region under
 * the Open/Reopen button where the user replies to (or answers a question from)
 * an inbox entry.
 *
 * Extracted from InboxDetail.tsx so the load-bearing invariant is unit-testable
 * without a DOM/`@testing-library/react` (not a dependency of this repo):
 *
 *   An entry that reads like a QUESTION must NEVER render a blank/null answer
 *   surface while its project is still alive.
 *
 * Previously the pane keyed its answer box purely on session liveness
 * (`aliveSession` / `sessionTombstoned && aliveProject`) and fell through to
 * `null` for a question-shaped entry that had no live session and no
 * tombstone match (a manual push phrased as a question with no `sessionId`, or
 * one whose tombstone didn't resolve). That was the true dead-end: the user saw
 * a question with no way to answer it. This helper collapses the decision into
 * one deterministic mode so the "never null while a project is alive" property
 * can be asserted directly.
 *
 * Delivery modes:
 *  - `'live'`   — the originating (or a reopened) session is alive: inject the
 *                 answer into its pty.
 *  - `'reopen'` — no live session but the project still exists: deliver by
 *                 reopening the agent (resume the transcript, or spawn a fresh
 *                 seeded agent) with the answer as its opening turn. Covers BOTH
 *                 the tombstoned-session case AND the no-`sessionId` prose-question
 *                 case the old ternary dropped.
 *  - `'none'`   — the project is gone: there is no agent to route an answer to.
 *                 The pane shows an honest explanatory panel, never a blank node.
 *
 * `showBox` decides whether the answer input is shown *immediately*. In
 * `'reopen'` mode we only auto-open the box for entries that actually read as a
 * question (`answerable`); a plain report instead gets a quiet "reply again"
 * affordance the user can expand, so every report doesn't sprout a textarea.
 * This function is pure and framework-agnostic; the component owns the toggle
 * state for the collapsed case.
 */

export type AnswerDeliveryMode = 'live' | 'reopen' | 'none';

export interface AnswerSurfaceInputs {
  /** An originating or reopened session is alive and can be injected into. */
  hasLiveSession: boolean;
  /** The entry's project still exists (so a reopen has somewhere to land). */
  hasAliveProject: boolean;
  /**
   * The entry reads as a question the user should answer — either it carries a
   * structured question (`classifyEntry(entry) === 'question'`) or the display
   * layer resolved a question set. Drives whether the box auto-opens in
   * `'reopen'` mode. Ignored in `'live'` mode (a live session always shows the
   * box) and irrelevant in `'none'` mode.
   */
  answerable: boolean;
}

export interface AnswerSurface {
  mode: AnswerDeliveryMode;
  /**
   * Show the answer input immediately. True whenever a live session exists (the
   * originating tab is right there to reply into) and, in reopen mode, only for
   * question-shaped entries. Always false in `'none'` mode — there's nowhere to
   * deliver, so the pane shows the explanatory panel instead.
   */
  showBox: boolean;
}

/**
 * Resolve the answer surface for an inbox entry. Pure; see the module doc for
 * the never-null-while-alive invariant this exists to make testable.
 */
export function resolveAnswerSurface(inputs: AnswerSurfaceInputs): AnswerSurface {
  const { hasLiveSession, hasAliveProject, answerable } = inputs;
  if (hasLiveSession) {
    // The originating (or reopened) tab is live — always offer the reply box.
    return { mode: 'live', showBox: true };
  }
  if (hasAliveProject) {
    // No live session but the project survives: we can always reopen the agent.
    // Auto-open the box for question-shaped entries; a plain report gets a quiet
    // expandable affordance instead (component-owned), so showBox tracks
    // `answerable`.
    return { mode: 'reopen', showBox: answerable };
  }
  // Project gone — nowhere to route an answer. The pane renders an honest
  // disabled panel; never a blank/null surface.
  return { mode: 'none', showBox: false };
}
