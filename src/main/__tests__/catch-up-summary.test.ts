import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CatchUpSummaryService,
  type CatchUpSummaryDeps,
  type CatchUpSessionInfo
} from '../catch-up-summary.js';
import type { CatchUpSummaryResult, LlmRunResult, AgentState } from '../../shared/types.js';

/**
 * A controllable fake clock built on the injected setTimer/clearTimer (mirrors
 * idle-triage.test.ts and heartbeat.test.ts). Each armed dwell timer gets an
 * integer handle; `fireNext()` runs the most-recently armed, still-pending
 * timer (the service only ever has one dwell armed per session at a time). Keeps
 * the dwell tests deterministic without vitest's global fake timers.
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
    /** Run the latest pending timer (mirrors the single-armed-timer invariant). */
    fireNext() {
      const ids = [...pending.keys()];
      if (ids.length === 0) throw new Error('no pending dwell timer to fire');
      const id = ids[ids.length - 1];
      const fn = pending.get(id)!;
      pending.delete(id);
      fn();
    },
    pendingCount: () => pending.size
  };
}

describe('CatchUpSummaryService', () => {
  const baseSession: CatchUpSessionInfo = {
    projectId: 'p1',
    profile: 'claude',
    cwd: '/proj',
    claudeSessionId: 'sess-1',
    status: 'running'
  };

  const okResult = (text: string): LlmRunResult => ({ ok: true, text, provider: 'claude-cli', ms: 10 });

  function makeDeps(over: Partial<CatchUpSummaryDeps> = {}) {
    const clock = makeClock();
    const deps: CatchUpSummaryDeps = {
      isEnabled: () => true,
      delaySeconds: () => 20,
      getSession: () => baseSession,
      hasTranscript: (p) => p === 'claude',
      readDigest: vi.fn(async () => 'User: do task\n\nAssistant: working on it'),
      runSummary: vi.fn(async () => okResult('**Summary**\n\n- Did the thing')),
      now: () => 1000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      ...over
    };
    return { deps, clock };
  }

  // Helper: wait out the fired-and-forgotten async summary chain.
  const tick = () => new Promise((r) => setTimeout(r, 0));

  describe('observe → idle trigger', () => {
    it('fires exactly once per idle spell after the dwell delay', async () => {
      const { deps, clock } = makeDeps();
      const svc = new CatchUpSummaryService(deps);
      const emitted: CatchUpSummaryResult[] = [];
      svc.on('summary', (r) => emitted.push(r));

      svc.observe('s', 'working');
      svc.observe('s', 'idle'); // edge → arm dwell
      expect(clock.pendingCount()).toBe(1);
      expect(deps.runSummary).not.toHaveBeenCalled();

      clock.fireNext(); // dwell elapses while still idle
      await tick();

      expect(deps.runSummary).toHaveBeenCalledTimes(1);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        sessionId: 's',
        projectId: 'p1',
        ok: true,
        text: '**Summary**\n\n- Did the thing',
        trigger: 'idle',
        generatedAt: 1000
      });
    });

    it('does not re-fire while the agent stays idle (one-shot per spell)', async () => {
      const { deps, clock } = makeDeps();
      const svc = new CatchUpSummaryService(deps);

      svc.observe('s', 'idle'); // arm dwell
      svc.observe('s', 'idle'); // repeated idle frame — no fresh edge, no second timer
      expect(clock.pendingCount()).toBe(1);
      clock.fireNext();
      await tick();
      svc.observe('s', 'idle'); // still idle after firing — must not re-arm
      expect(clock.pendingCount()).toBe(0);
      expect(deps.runSummary).toHaveBeenCalledTimes(1);
    });

    it('re-arms after the agent leaves idle and re-enters (new spell)', async () => {
      const { deps, clock } = makeDeps();
      const svc = new CatchUpSummaryService(deps);

      svc.observe('s', 'idle');
      clock.fireNext();
      await tick();
      expect(deps.runSummary).toHaveBeenCalledTimes(1);

      svc.observe('s', 'working'); // left idle → re-arm
      svc.observe('s', 'idle'); // fresh spell
      expect(clock.pendingCount()).toBe(1);
      clock.fireNext();
      await tick();
      expect(deps.runSummary).toHaveBeenCalledTimes(2);
    });

    it('cancels the dwell if the agent leaves idle before it elapses (no summary)', async () => {
      const { deps, clock } = makeDeps();
      const svc = new CatchUpSummaryService(deps);

      svc.observe('s', 'idle'); // arm dwell
      expect(clock.pendingCount()).toBe(1);
      svc.observe('s', 'working'); // leaves idle before dwell → cancel
      expect(clock.pendingCount()).toBe(0);
      expect(clock.clearTimer).toHaveBeenCalledTimes(1);
      await tick();

      expect(deps.runSummary).not.toHaveBeenCalled();
    });
  });

  describe('observe → blocked trigger', () => {
    it('fires on entering blocked with trigger=blocked', async () => {
      const { deps, clock } = makeDeps();
      const svc = new CatchUpSummaryService(deps);
      const emitted: CatchUpSummaryResult[] = [];
      svc.on('summary', (r) => emitted.push(r));

      svc.observe('s', 'working');
      svc.observe('s', 'blocked'); // edge → arm dwell, trigger='blocked'
      expect(clock.pendingCount()).toBe(1);

      clock.fireNext();
      await tick();

      expect(deps.runSummary).toHaveBeenCalledTimes(1);
      // Verify the trigger was passed correctly
      expect((deps.runSummary as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('blocked');
      expect(emitted).toHaveLength(1);
      expect(emitted[0].trigger).toBe('blocked');
    });

    it('re-arms after leaving blocked and re-entering', async () => {
      const { deps, clock } = makeDeps();
      const svc = new CatchUpSummaryService(deps);

      svc.observe('s', 'blocked');
      clock.fireNext();
      await tick();
      expect(deps.runSummary).toHaveBeenCalledTimes(1);

      svc.observe('s', 'working'); // left trigger
      svc.observe('s', 'blocked'); // fresh spell
      expect(clock.pendingCount()).toBe(1);
      clock.fireNext();
      await tick();
      expect(deps.runSummary).toHaveBeenCalledTimes(2);
    });

    it('updates entry.trigger when state changes from idle→blocked (or reverse) before dwell fires', async () => {
      const { deps, clock } = makeDeps();
      const svc = new CatchUpSummaryService(deps);

      svc.observe('s', 'working');
      svc.observe('s', 'idle'); // arm dwell with trigger='idle'
      expect(clock.pendingCount()).toBe(1);

      // Agent enters blocked BEFORE the dwell timer fires
      svc.observe('s', 'blocked');

      // Now fire the dwell
      clock.fireNext();
      await tick();

      // The trigger passed to runSummary should be 'blocked' (the current state),
      // not 'idle' (the state that armed the timer).
      expect(deps.runSummary).toHaveBeenCalledTimes(1);
      expect((deps.runSummary as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('blocked');
    });
  });

  describe('delaySeconds configuration', () => {
    it('uses the injected delaySeconds for the dwell length (live setting)', () => {
      const { deps, clock } = makeDeps({ delaySeconds: () => 45 });
      const svc = new CatchUpSummaryService(deps);
      svc.observe('s', 'idle');
      expect(clock.setTimer).toHaveBeenCalledWith(expect.any(Function), 45_000);
    });

    it('clamps negative or zero delays to 1 second minimum', () => {
      const { deps, clock } = makeDeps({ delaySeconds: () => -5 });
      const svc = new CatchUpSummaryService(deps);
      svc.observe('s', 'idle');
      expect(clock.setTimer).toHaveBeenCalledWith(expect.any(Function), 1_000);
    });
  });

  describe('cost discipline — enabled checks', () => {
    it('spends nothing when disabled at construction', async () => {
      const { deps, clock } = makeDeps({ isEnabled: () => false });
      const svc = new CatchUpSummaryService(deps);

      svc.observe('s', 'idle');
      clock.fireNext();
      await tick();

      expect(deps.readDigest).not.toHaveBeenCalled();
      expect(deps.runSummary).not.toHaveBeenCalled();
    });

    it('re-checks isEnabled AFTER readDigest and BEFORE runSummary (toggle-off scenario)', async () => {
      let enabledCalls = 0;
      const isEnabled = vi.fn(() => {
        enabledCalls++;
        // First call (at construction/dwell-elapsed) → true
        // Second call (after digest read) → false
        return enabledCalls === 1;
      });
      const { deps, clock } = makeDeps({ isEnabled });
      const svc = new CatchUpSummaryService(deps);
      const emitted: CatchUpSummaryResult[] = [];
      svc.on('summary', (r) => emitted.push(r));

      svc.observe('s', 'idle');
      clock.fireNext();
      await tick();

      // Should have called isEnabled at least twice
      expect(isEnabled).toHaveBeenCalled();
      expect(isEnabled.mock.calls.length).toBeGreaterThanOrEqual(2);
      // Should have read the digest (cheap check)
      expect(deps.readDigest).toHaveBeenCalled();
      // Should NOT have called runSummary (costly call blocked by second check)
      expect(deps.runSummary).not.toHaveBeenCalled();
      // Should emit a failure result
      expect(emitted).toHaveLength(0);
    });
  });

  describe('session eligibility', () => {
    it('skips scheduled/headless (background) sessions — no timer, no runSummary', async () => {
      const scheduled = makeDeps({ getSession: () => ({ ...baseSession, scheduled: true }) });
      const svcScheduled = new CatchUpSummaryService(scheduled.deps);
      svcScheduled.observe('s', 'idle');
      scheduled.clock.fireNext();
      await tick();
      expect(scheduled.deps.runSummary).not.toHaveBeenCalled();

      const headless = makeDeps({ getSession: () => ({ ...baseSession, headless: true }) });
      const svcHeadless = new CatchUpSummaryService(headless.deps);
      svcHeadless.observe('s', 'idle');
      headless.clock.fireNext();
      await tick();
      expect(headless.deps.runSummary).not.toHaveBeenCalled();
    });

    it('skips non-claude sessions', async () => {
      const { deps, clock } = makeDeps({ getSession: () => ({ ...baseSession, profile: 'shell' }) });
      const svc = new CatchUpSummaryService(deps);

      svc.observe('s', 'idle');
      clock.fireNext();
      await tick();

      expect(deps.runSummary).not.toHaveBeenCalled();
    });

    it('skips when the session is gone or exited', async () => {
      const gone = makeDeps({ getSession: () => null });
      const svcGone = new CatchUpSummaryService(gone.deps);
      svcGone.observe('s', 'idle');
      gone.clock.fireNext();
      await tick();
      expect(gone.deps.runSummary).not.toHaveBeenCalled();

      const exited = makeDeps({ getSession: () => ({ ...baseSession, status: 'exited' }) });
      const svcExited = new CatchUpSummaryService(exited.deps);
      svcExited.observe('s', 'idle');
      exited.clock.fireNext();
      await tick();
      expect(exited.deps.runSummary).not.toHaveBeenCalled();
    });

    it('does not spend a call when the digest is empty', async () => {
      const { deps, clock } = makeDeps({ readDigest: vi.fn(async () => '   ') });
      const svc = new CatchUpSummaryService(deps);

      svc.observe('s', 'idle');
      clock.fireNext();
      await tick();

      expect(deps.runSummary).not.toHaveBeenCalled();
    });
  });

  describe('LLM failure handling', () => {
    it('emits CatchUpSummaryResult with ok:false when runSummary returns ok:false', async () => {
      const { deps, clock } = makeDeps({
        runSummary: vi.fn(
          async (): Promise<LlmRunResult> => ({
            ok: false,
            text: '',
            error: 'timeout',
            provider: 'claude-cli',
            ms: 15
          })
        )
      });
      const svc = new CatchUpSummaryService(deps);
      const emitted: CatchUpSummaryResult[] = [];
      svc.on('summary', (r) => emitted.push(r));

      svc.observe('s', 'idle');
      clock.fireNext();
      await tick();

      // Fix #1: Terminal failures (model errors, empty digest) ARE now emitted
      // for automatic path, so the renderer can show its error state.
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        sessionId: 's',
        ok: false,
        error: 'timeout',
        ms: 15
      });
      // The service does not throw
    });

    it('does not throw on runSummary failure (graceful degradation)', async () => {
      const { deps, clock } = makeDeps({
        runSummary: vi.fn(
          async (): Promise<LlmRunResult> => ({
            ok: false,
            text: '',
            error: 'spawn-failed',
            provider: 'claude-cli',
            ms: 0
          })
        )
      });
      const svc = new CatchUpSummaryService(deps);

      svc.observe('s', 'idle');
      clock.fireNext();
      await tick();
      // No exception thrown — test passes if we reach here
      expect(deps.runSummary).toHaveBeenCalled();
    });
  });

  describe('concurrency limiting', () => {
    it('bounds concurrent summaries at MAX_CONCURRENT_SUMMARIES (5)', async () => {
      let inFlight = 0;
      let peak = 0;
      const { deps, clock } = makeDeps({
        getSession: (id) => ({ ...baseSession, projectId: id }),
        runSummary: vi.fn(async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 1));
          inFlight--;
          return okResult('- summary');
        })
      });
      const svc = new CatchUpSummaryService(deps);

      // Arm 10 sessions in parallel
      for (let i = 0; i < 10; i++) {
        svc.observe(`s${i}`, 'idle');
      }
      expect(clock.pendingCount()).toBe(10);

      // Fire all 10 dwells at once
      for (let i = 0; i < 10; i++) {
        clock.fireNext();
      }
      await tick();
      // Wait for all summaries to complete
      await new Promise((r) => setTimeout(r, 50));

      // Peak should never exceed 5
      expect(peak).toBeLessThanOrEqual(5);
    });

    it('drops summaries beyond the concurrency cap (automatic fire is best-effort)', async () => {
      const { deps, clock } = makeDeps({
        runSummary: vi.fn(async () => {
          // Never resolve — keeps the slot occupied
          return new Promise<LlmRunResult>(() => {});
        })
      });
      const svc = new CatchUpSummaryService(deps);

      // Arm 6 sessions (cap is 5)
      for (let i = 0; i < 6; i++) {
        svc.observe(`s${i}`, 'idle');
      }

      // Fire all 6 dwells
      for (let i = 0; i < 6; i++) {
        clock.fireNext();
      }
      await tick();

      // Only 5 should have spawned
      expect(deps.runSummary).toHaveBeenCalledTimes(5);
    });
  });

  describe('generateOne (on-demand)', () => {
    it('generates a summary on demand and returns it directly', async () => {
      const { deps } = makeDeps();
      const svc = new CatchUpSummaryService(deps);

      const result = await svc.generateOne('s');

      expect(result).toMatchObject({
        sessionId: 's',
        ok: true,
        text: '**Summary**\n\n- Did the thing',
        trigger: 'idle'
      });
      expect(deps.runSummary).toHaveBeenCalledTimes(1);
    });

    it('bypasses the dwell timer and one-shot gate', async () => {
      const { deps, clock } = makeDeps();
      const svc = new CatchUpSummaryService(deps);

      // Fire once automatically
      svc.observe('s', 'idle');
      clock.fireNext();
      await tick();
      expect(deps.runSummary).toHaveBeenCalledTimes(1);

      // generateOne should still fire even though the one-shot gate is claimed
      const result = await svc.generateOne('s');
      expect(result.ok).toBe(true);
      expect(deps.runSummary).toHaveBeenCalledTimes(2);
    });

    it('respects concurrency cap by waiting (not dropping)', async () => {
      let resolvers: Array<(r: LlmRunResult) => void> = [];
      const { deps } = makeDeps({
        runSummary: vi.fn(async () => {
          return new Promise<LlmRunResult>((res) => resolvers.push(res));
        })
      });
      const svc = new CatchUpSummaryService(deps);

      // Start 5 on-demand calls (fills the cap)
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(svc.generateOne(`s${i}`));
      }
      await tick();
      expect(deps.runSummary).toHaveBeenCalledTimes(5);

      // Start a 6th — should wait, not drop
      const p6 = svc.generateOne('s6');
      await tick();
      // Still 5 in flight
      expect(deps.runSummary).toHaveBeenCalledTimes(5);

      // Resolve one to free a slot
      resolvers[0](okResult('- done'));
      await tick();
      await new Promise((r) => setTimeout(r, 150)); // Wait for the polling loop

      // Now the 6th should have started
      expect(deps.runSummary).toHaveBeenCalledTimes(6);

      // Clean up
      for (const res of resolvers.slice(1)) {
        res(okResult('- done'));
      }
      await Promise.all([...promises, p6]);
    });

    it('returns a failure result when the session is ineligible', async () => {
      const { deps } = makeDeps({ getSession: () => null });
      const svc = new CatchUpSummaryService(deps);

      const result = await svc.generateOne('s');

      expect(result).toMatchObject({
        ok: false,
        error: 'ineligible'
      });
      expect(deps.runSummary).not.toHaveBeenCalled();
    });
  });

  describe('remove (cleanup)', () => {
    it('clears any pending dwell timer when a session is removed', () => {
      const { deps, clock } = makeDeps();
      const svc = new CatchUpSummaryService(deps);

      svc.observe('s', 'idle');
      expect(clock.pendingCount()).toBe(1);

      svc.remove('s');
      expect(clock.pendingCount()).toBe(0);
      expect(clock.clearTimer).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for an unknown session', () => {
      const { deps, clock } = makeDeps();
      const svc = new CatchUpSummaryService(deps);

      expect(() => svc.remove('unknown')).not.toThrow();
      expect(clock.clearTimer).not.toHaveBeenCalled();
    });
  });

  describe('state-change suppression (automatic fire only)', () => {
    it('suppresses the emit if the agent left the trigger state during the call', async () => {
      let resolveCall: (r: LlmRunResult) => void = () => {};
      const { deps, clock } = makeDeps({
        runSummary: vi.fn(
          () =>
            new Promise<LlmRunResult>((res) => {
              resolveCall = res;
            })
        )
      });
      const svc = new CatchUpSummaryService(deps);
      const emitted: CatchUpSummaryResult[] = [];
      svc.on('summary', (r) => emitted.push(r));

      svc.observe('s', 'idle');
      clock.fireNext();
      await tick();

      // Agent moves to working mid-call
      svc.observe('s', 'working');
      resolveCall(okResult('- summary'));
      await tick();

      // Should not emit (stale summary)
      expect(emitted).toHaveLength(0);
    });

    it('still returns the result for on-demand even if state changed', async () => {
      let resolveCall: (r: LlmRunResult) => void = () => {};
      const { deps } = makeDeps({
        runSummary: vi.fn(
          () =>
            new Promise<LlmRunResult>((res) => {
              resolveCall = res;
            })
        )
      });
      const svc = new CatchUpSummaryService(deps);

      const resultPromise = svc.generateOne('s');
      await tick();

      // Agent moves to working mid-call
      svc.observe('s', 'idle');
      svc.observe('s', 'working');

      resolveCall(okResult('- summary'));
      const result = await resultPromise;

      // On-demand should still return the result
      expect(result.ok).toBe(true);
    });
  });
});
