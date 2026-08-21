import { describe, it, expect } from 'vitest';
import { resolveAnswerSurface, type AnswerSurfaceInputs } from '../answerSurface.js';

/**
 * The load-bearing invariant: an entry that reads as a QUESTION must never
 * render a blank/null answer surface. In the component that means either an
 * answer box (`showBox`) or, when the project is gone, mode `'none'` (which the
 * pane renders as an honest explanatory panel — never null). This test asserts
 * the pure decision so the invariant holds without a DOM.
 */

const all = <T,>(xs: readonly T[]) => xs;

describe('resolveAnswerSurface', () => {
  it('live session → mode live, box shown regardless of answerable', () => {
    for (const answerable of [true, false]) {
      const r = resolveAnswerSurface({ hasLiveSession: true, hasAliveProject: true, answerable });
      expect(r.mode).toBe('live');
      expect(r.showBox).toBe(true);
    }
  });

  it('a live session even without a project still injects (project liveness ignored when live)', () => {
    const r = resolveAnswerSurface({ hasLiveSession: true, hasAliveProject: false, answerable: false });
    expect(r.mode).toBe('live');
    expect(r.showBox).toBe(true);
  });

  it('no live session but project alive → reopen; box auto-opens only for questions', () => {
    const q = resolveAnswerSurface({ hasLiveSession: false, hasAliveProject: true, answerable: true });
    expect(q.mode).toBe('reopen');
    expect(q.showBox).toBe(true);

    const report = resolveAnswerSurface({ hasLiveSession: false, hasAliveProject: true, answerable: false });
    expect(report.mode).toBe('reopen');
    // A plain report gets the quiet expandable affordance, not an auto-open box.
    expect(report.showBox).toBe(false);
  });

  it('project gone → mode none, never a box (pane shows an explanation instead)', () => {
    for (const answerable of [true, false]) {
      const r = resolveAnswerSurface({ hasLiveSession: false, hasAliveProject: false, answerable });
      expect(r.mode).toBe('none');
      expect(r.showBox).toBe(false);
    }
  });

  it('NEVER-NULL invariant: an answerable entry always yields a non-blank surface across every state', () => {
    // For a question (answerable === true), the component must render *something*
    // interactive: an answer box (showBox) in live/reopen, or the honest
    // project-gone panel (mode 'none'). It must never fall through to null.
    const states: AnswerSurfaceInputs[] = [];
    for (const hasLiveSession of all([true, false])) {
      for (const hasAliveProject of all([true, false])) {
        states.push({ hasLiveSession, hasAliveProject, answerable: true });
      }
    }
    for (const s of states) {
      const r = resolveAnswerSurface(s);
      const rendersSomething = r.showBox || r.mode === 'none';
      expect(rendersSomething).toBe(true);
    }
  });

  it('the tombstoned + no-sessionId prose-question case (old null dead-end) now resolves to reopen+box', () => {
    // Previously the pane keyed on `sessionTombstoned && aliveProject`, so a
    // question-shaped entry with no live session AND no sessionId fell to null.
    // Now: no live session + alive project + answerable → reopen with the box.
    const r = resolveAnswerSurface({ hasLiveSession: false, hasAliveProject: true, answerable: true });
    expect(r.mode).toBe('reopen');
    expect(r.showBox).toBe(true);
  });
});
