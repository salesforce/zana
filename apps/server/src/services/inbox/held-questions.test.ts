import { describe, it, expect, vi } from 'vitest';
import { HeldQuestionService, type HeldQuestionDeps } from './held-questions.js';
import type { InboxInput } from '@zana-ai/zcc-server';
import type { AgentState, InboxQuestion } from '@zana-ai/zcc-domain/product';

/**
 * A controllable fake clock built on the injected setTimer/clearTimer (same
 * shape as idle-triage.test.ts / heartbeat.test.ts). Each armed max-hold timer
 * gets an integer handle; `fireNext()` runs the most-recently armed pending
 * timer. Keeps the deadline tests deterministic without vitest global fakes.
 */
function makeClock() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const setTimer = vi.fn((fn: () => void) => {
    const id = nextId++;
    pending.set(id, fn);
    return id as unknown as NodeJS.Timeout;
  });
  const clearTimer = vi.fn((handle: NodeJS.Timeout) => {
    pending.delete(handle as unknown as number);
  });
  return {
    setTimer,
    clearTimer,
    fireNext() {
      const ids = [...pending.keys()];
      if (ids.length === 0) throw new Error('no pending timer to fire');
      const id = ids[ids.length - 1];
      const fn = pending.get(id)!;
      pending.delete(id);
      fn();
    },
    pendingCount: () => pending.size
  };
}

/** A structured question with a chosen blocking flag. */
function question(blocking: boolean | undefined): InboxQuestion {
  return {
    options: [
      { id: 'A', label: 'Yes' },
      { id: 'B', label: 'No' }
    ],
    ...(blocking === undefined ? {} : { blocking })
  };
}

function blockingInput(): InboxInput {
  return { projectId: 'p1', comments: 'Proceed?', question: question(true) };
}
function softInput(): InboxInput {
  return { projectId: 'p1', comments: 'Done — open a PR?', question: question(false) };
}
function reportInput(): InboxInput {
  return { projectId: 'p1', comments: 'Finished the audit.' };
}

describe('HeldQuestionService', () => {
  function makeDeps(over: Partial<HeldQuestionDeps> = {}) {
    const clock = makeClock();
    const appended: InboxInput[] = [];
    const state = { value: 'working' as AgentState };
    const deps: HeldQuestionDeps = {
      isEnabled: () => true,
      getAgentState: () => state.value,
      append: vi.fn(async (input: InboxInput) => {
        appended.push(input);
        return { id: 'x' };
      }),
      maxHoldMs: () => 10 * 60 * 1000,
      now: () => 1000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      ...over
    };
    return { deps, clock, appended, state };
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('holds a blocking question while the agent is working', () => {
    const { deps } = makeDeps();
    const svc = new HeldQuestionService(deps);
    expect(svc.maybeHold('s1', blockingInput())).toBe(true);
    expect(svc.heldCount('s1')).toBe(1);
    expect(deps.append).not.toHaveBeenCalled();
  });

  it('does NOT hold a soft (non-blocking) question — it surfaces now', () => {
    const { deps } = makeDeps();
    const svc = new HeldQuestionService(deps);
    expect(svc.maybeHold('s1', softInput())).toBe(false);
    expect(svc.heldCount('s1')).toBe(0);
  });

  it('does NOT hold a plain report (no question)', () => {
    const { deps } = makeDeps();
    const svc = new HeldQuestionService(deps);
    expect(svc.maybeHold('s1', reportInput())).toBe(false);
  });

  it('does NOT hold when the agent is not working (idle/blocked/done/unknown)', () => {
    for (const st of ['idle', 'blocked', 'done', 'unknown'] as AgentState[]) {
      const { deps, state } = makeDeps();
      state.value = st;
      const svc = new HeldQuestionService(deps);
      expect(svc.maybeHold('s1', blockingInput())).toBe(false);
    }
  });

  it('does NOT hold when there is no sessionId (project-only push)', () => {
    const { deps } = makeDeps();
    const svc = new HeldQuestionService(deps);
    expect(svc.maybeHold(undefined, blockingInput())).toBe(false);
  });

  it('does NOT hold when the feature is disabled', () => {
    const { deps } = makeDeps({ isEnabled: () => false });
    const svc = new HeldQuestionService(deps);
    expect(svc.maybeHold('s1', blockingInput())).toBe(false);
  });

  it('flushes held questions on the working→idle edge', () => {
    const { deps, appended } = makeDeps();
    const svc = new HeldQuestionService(deps);
    svc.maybeHold('s1', blockingInput());
    svc.observe('s1', 'idle');
    expect(appended).toHaveLength(1);
    expect(svc.heldCount('s1')).toBe(0);
  });

  it('flushes held questions on the working→blocked edge', () => {
    const { deps, appended } = makeDeps();
    const svc = new HeldQuestionService(deps);
    svc.maybeHold('s1', blockingInput());
    svc.observe('s1', 'blocked');
    expect(appended).toHaveLength(1);
  });

  it('does not flush while the agent keeps working', () => {
    const { deps, appended } = makeDeps();
    const svc = new HeldQuestionService(deps);
    svc.maybeHold('s1', blockingInput());
    svc.observe('s1', 'working');
    expect(appended).toHaveLength(0);
    expect(svc.heldCount('s1')).toBe(1);
  });

  it('flushes all held questions for a session at once', () => {
    const { deps, appended } = makeDeps();
    const svc = new HeldQuestionService(deps);
    svc.maybeHold('s1', blockingInput());
    svc.maybeHold('s1', blockingInput());
    expect(svc.heldCount('s1')).toBe(2);
    svc.observe('s1', 'idle');
    expect(appended).toHaveLength(2);
  });

  it('flushes a held question after the max-hold deadline even if never idle', () => {
    const { deps, appended, clock } = makeDeps();
    const svc = new HeldQuestionService(deps);
    svc.maybeHold('s1', blockingInput());
    expect(clock.pendingCount()).toBe(1);
    clock.fireNext();
    expect(appended).toHaveLength(1);
    expect(svc.heldCount('s1')).toBe(0);
  });

  it('clears the deadline timer once flushed on idle', () => {
    const { deps, clock } = makeDeps();
    const svc = new HeldQuestionService(deps);
    svc.maybeHold('s1', blockingInput());
    expect(clock.pendingCount()).toBe(1);
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(0);
  });

  it('drops held questions (and timers) on session exit — self-resolve', () => {
    const { deps, appended, clock } = makeDeps();
    const svc = new HeldQuestionService(deps);
    svc.maybeHold('s1', blockingInput());
    svc.remove('s1');
    expect(svc.heldCount('s1')).toBe(0);
    expect(clock.pendingCount()).toBe(0);
    // A later idle edge on the forgotten session appends nothing.
    svc.observe('s1', 'idle');
    expect(appended).toHaveLength(0);
  });

  it('swallows a flush-append failure (never throws on the hot path)', async () => {
    const onError = vi.fn();
    const { deps } = makeDeps({
      append: vi.fn(async () => {
        throw new Error('store down');
      }),
      onError
    });
    const svc = new HeldQuestionService(deps);
    svc.maybeHold('s1', blockingInput());
    expect(() => svc.observe('s1', 'idle')).not.toThrow();
    await tick();
    expect(onError).toHaveBeenCalled();
  });

  it('holds a blocking multi-question entry too', () => {
    const { deps } = makeDeps();
    const svc = new HeldQuestionService(deps);
    const input: InboxInput = {
      projectId: 'p1',
      comments: 'A few things',
      questions: [question(true), question(false)]
    };
    expect(svc.maybeHold('s1', input)).toBe(true);
  });
});
