import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  IdleTriageService,
  parseTriage,
  MAX_CONCURRENT_TRIAGES,
  MAX_TRIAGES_PER_SESSION,
  type IdleTriageDeps,
  type TriageSessionInfo
} from './idle-triage.js';
import type { IdleTriageResult, LlmRunResult } from '@zana-ai/zcc-domain/product';

describe('parseTriage', () => {
  it('parses a clean JSON reply', () => {
    expect(parseTriage('{"resolution":"done","summary":"Committed the fix","confidence":0.9}')).toEqual({
      resolution: 'done',
      summary: 'Committed the fix',
      confidence: 0.9
    });
  });

  it('tolerates surrounding prose / code fences (extracts the first object)', () => {
    const out = parseTriage('Sure!\n```json\n{"resolution":"awaiting-reply","summary":"asks to confirm"}\n```');
    expect(out?.resolution).toBe('awaiting-reply');
    expect(out?.summary).toBe('asks to confirm');
  });

  it('clamps confidence to 0..1 and caps summary length', () => {
    const out = parseTriage(`{"resolution":"paused","summary":"${'x'.repeat(200)}","confidence":5}`);
    expect(out?.confidence).toBe(1);
    expect(out?.summary.length).toBe(80);
  });

  it('parses a detail body and caps it at 400 chars', () => {
    const out = parseTriage(
      '{"resolution":"awaiting-reply","summary":"Commit?","detail":"Finished 3-part feature; tests pass. Commit now or keep iterating?"}'
    );
    expect(out?.detail).toBe('Finished 3-part feature; tests pass. Commit now or keep iterating?');
    const long = parseTriage(`{"resolution":"paused","summary":"x","detail":"${'y'.repeat(600)}"}`);
    expect(long?.detail?.length).toBe(400);
  });

  it('leaves detail undefined when absent or empty', () => {
    expect(parseTriage('{"resolution":"done","summary":"x"}')?.detail).toBeUndefined();
    expect(parseTriage('{"resolution":"done","summary":"x","detail":"  "}')?.detail).toBeUndefined();
  });

  it('parses offered options, capping count at 6 and each label at 60 chars', () => {
    const labels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const out = parseTriage(
      `{"resolution":"awaiting-reply","summary":"pick","options":${JSON.stringify(labels)}}`
    );
    expect(out?.options).toEqual(['a', 'b', 'c', 'd', 'e', 'f']); // capped to 6
    const longLabel = parseTriage(
      `{"resolution":"awaiting-reply","summary":"x","options":["${'z'.repeat(120)}"]}`
    );
    expect(longLabel?.options?.[0].length).toBe(60);
  });

  it('drops empty/whitespace options and omits the field when none remain', () => {
    const out = parseTriage(
      '{"resolution":"awaiting-reply","summary":"x","options":["  ","",  "Yes"]}'
    );
    expect(out?.options).toEqual(['Yes']);
    expect(parseTriage('{"resolution":"awaiting-reply","summary":"x","options":["  ",""]}')?.options).toBeUndefined();
  });

  it('omits options when absent, non-array, or holding non-strings (badge preserved)', () => {
    // Absent → field omitted, resolution still parses (never a null return).
    const absent = parseTriage('{"resolution":"awaiting-reply","summary":"x"}');
    expect(absent?.resolution).toBe('awaiting-reply');
    expect(absent?.options).toBeUndefined();
    // Non-array options → ignored, no crash.
    expect(parseTriage('{"resolution":"done","summary":"x","options":"nope"}')?.options).toBeUndefined();
    // Non-string members are filtered out.
    expect(parseTriage('{"resolution":"done","summary":"x","options":[1,2,{"a":1}]}')?.options).toBeUndefined();
  });

  it('returns null on unparsable JSON even when options look present (badge not dropped by options)', () => {
    // A resolution that never parses stays null exactly as before — options
    // parsing can never rescue OR sink an otherwise-invalid verdict.
    expect(parseTriage('{"resolution":"sleeping","summary":"x","options":["a"]}')).toBeNull();
  });

  it('rejects an unknown resolution value', () => {
    expect(parseTriage('{"resolution":"sleeping","summary":"x"}')).toBeNull();
  });

  it('rejects non-JSON / empty', () => {
    expect(parseTriage('not json')).toBeNull();
    expect(parseTriage('')).toBeNull();
  });
});

/**
 * A controllable fake clock built on the injected setTimer/clearTimer (same
 * shape as heartbeat.test.ts). Each armed dwell timer gets an integer handle;
 * `fireNext()` runs the most-recently armed, still-pending timer (the service
 * only ever has one dwell armed per session at a time). Keeps the dwell tests
 * deterministic without vitest's global fake timers.
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
    /** Fire every timer armed as of THIS call (a snapshot), simulating simultaneous transitions. */
    fireAll() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
    pendingCount: () => pending.size
  };
}

describe('IdleTriageService', () => {
  const baseSession: TriageSessionInfo = {
    profile: 'claude',
    cwd: '/proj',
    claudeSessionId: 'sess-1',
    status: 'running'
  };

  const okResult = (text: string): LlmRunResult => ({ ok: true, text, provider: 'claude-cli', ms: 1 });

  function makeDeps(over: Partial<IdleTriageDeps> = {}) {
    const clock = makeClock();
    const deps: IdleTriageDeps = {
      isEnabled: () => true,
      delaySeconds: () => 20,
      getSession: () => baseSession,
      hasTranscript: (p) => p === 'claude',
      readLastTurn: vi.fn(async () => 'Done — want me to commit?'),
      runTriage: vi.fn(async () => okResult('{"resolution":"done","summary":"finished","confidence":0.8}')),
      now: () => 1000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      ...over
    };
    return { deps, clock };
  }

  // Helper: wait out the fired-and-forgotten async triage chain.
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('fires once after the dwell elapses and emits a parsed result', async () => {
    const { deps, clock } = makeDeps();
    const svc = new IdleTriageService(deps);
    const emitted: IdleTriageResult[] = [];
    svc.on('triage', (r) => emitted.push(r));

    svc.observe('s', 'working');
    svc.observe('s', 'idle');
    // Dwell armed but not yet elapsed → no call.
    expect(deps.runTriage).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(1);

    clock.fireNext(); // dwell elapses while still idle
    await tick();

    expect(deps.runTriage).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual([
      { sessionId: 's', at: 1000, resolution: 'done', summary: 'finished', confidence: 0.8 }
    ]);
  });

  it('fires once after the dwell elapses on working→waiting too (non-OSC harnesses rest in waiting, not idle)', async () => {
    const { deps, clock } = makeDeps();
    const svc = new IdleTriageService(deps);
    const emitted: IdleTriageResult[] = [];
    svc.on('triage', (r) => emitted.push(r));

    svc.observe('s', 'working');
    svc.observe('s', 'waiting');
    // Dwell armed but not yet elapsed → no call.
    expect(deps.runTriage).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(1);

    clock.fireNext(); // dwell elapses while still waiting
    await tick();

    expect(deps.runTriage).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual([
      { sessionId: 's', at: 1000, resolution: 'done', summary: 'finished', confidence: 0.8 }
    ]);
  });

  it('cancels the dwell if the agent leaves idle before it elapses (no triage)', async () => {
    const { deps, clock } = makeDeps();
    const svc = new IdleTriageService(deps);

    svc.observe('s', 'idle'); // arm dwell
    expect(clock.pendingCount()).toBe(1);
    svc.observe('s', 'working'); // leaves idle before dwell → cancel
    expect(clock.pendingCount()).toBe(0);
    expect(clock.clearTimer).toHaveBeenCalledTimes(1);
    await tick();

    expect(deps.runTriage).not.toHaveBeenCalled();
  });

  it('does not re-arm or re-fire while the agent stays idle (one-shot per spell)', async () => {
    const { deps, clock } = makeDeps();
    const svc = new IdleTriageService(deps);
    svc.observe('s', 'idle');
    svc.observe('s', 'idle'); // repeated idle frame — no fresh edge, no second timer
    expect(clock.pendingCount()).toBe(1);
    clock.fireNext();
    await tick();
    svc.observe('s', 'idle'); // still idle after firing — must not re-arm
    expect(clock.pendingCount()).toBe(0);
    expect(deps.runTriage).toHaveBeenCalledTimes(1);
  });

  it('re-arms after the agent leaves and re-enters idle', async () => {
    const { deps, clock } = makeDeps();
    const svc = new IdleTriageService(deps);
    svc.observe('s', 'idle');
    clock.fireNext();
    await tick();
    svc.observe('s', 'working'); // left idle → re-arm
    svc.observe('s', 'idle'); // fresh spell
    clock.fireNext();
    await tick();
    expect(deps.runTriage).toHaveBeenCalledTimes(2);
  });

  it('uses the injected delaySeconds for the dwell length (live setting)', () => {
    const { deps, clock } = makeDeps({ delaySeconds: () => 45 });
    const svc = new IdleTriageService(deps);
    svc.observe('s', 'idle');
    expect(clock.setTimer).toHaveBeenCalledWith(expect.any(Function), 45_000);
  });

  it('spends nothing when the add-on is disabled', async () => {
    const { deps, clock } = makeDeps({ isEnabled: () => false });
    const svc = new IdleTriageService(deps);
    svc.observe('s', 'idle');
    clock.fireNext();
    await tick();
    expect(deps.runTriage).not.toHaveBeenCalled();
  });

  it('skips non-claude sessions', async () => {
    const { deps, clock } = makeDeps({ getSession: () => ({ ...baseSession, profile: 'shell' }) });
    const svc = new IdleTriageService(deps);
    svc.observe('s', 'idle');
    clock.fireNext();
    await tick();
    expect(deps.runTriage).not.toHaveBeenCalled();
  });

  it('skips background sessions — headless team workers never get triaged', async () => {
    const { deps, clock } = makeDeps({ getSession: () => ({ ...baseSession, headless: true }) });
    const svc = new IdleTriageService(deps);
    svc.observe('s', 'idle');
    clock.fireNext();
    await tick();
    expect(deps.runTriage).not.toHaveBeenCalled();
  });

  it('skips scheduled sessions too', async () => {
    const { deps, clock } = makeDeps({ getSession: () => ({ ...baseSession, scheduled: true }) });
    const svc = new IdleTriageService(deps);
    svc.observe('s', 'idle');
    clock.fireNext();
    await tick();
    expect(deps.runTriage).not.toHaveBeenCalled();
  });

  it('skips a job-team worker via the immutable cohort role even when headless was cleared', async () => {
    // A worker spawns headless, but a user opening its card clears the bit;
    // the immutable cohort.role stamp must still suppress triage.
    const { deps, clock } = makeDeps({
      getSession: () => ({ ...baseSession, scheduled: undefined, headless: undefined, cohortRole: 'worker' })
    });
    const svc = new IdleTriageService(deps);
    svc.observe('s', 'idle');
    clock.fireNext();
    await tick();
    expect(deps.runTriage).not.toHaveBeenCalled();
  });

  it('does not spend a call when there is no last turn to classify', async () => {
    const { deps, clock } = makeDeps({ readLastTurn: vi.fn(async () => '') });
    const svc = new IdleTriageService(deps);
    svc.observe('s', 'idle');
    clock.fireNext();
    await tick();
    expect(deps.runTriage).not.toHaveBeenCalled();
  });

  it('suppresses the emit if the agent left idle during the call', async () => {
    let resolveCall: (r: LlmRunResult) => void = () => {};
    const { deps, clock } = makeDeps({
      runTriage: vi.fn(() => new Promise<LlmRunResult>((res) => { resolveCall = res; }))
    });
    const svc = new IdleTriageService(deps);
    const emitted: IdleTriageResult[] = [];
    svc.on('triage', (r) => emitted.push(r));

    svc.observe('s', 'idle');
    clock.fireNext();
    await tick();
    svc.observe('s', 'working'); // agent moved on mid-call
    resolveCall(okResult('{"resolution":"done","summary":"x"}'));
    await tick();

    expect(emitted).toHaveLength(0);
  });

  it('does not emit on a failed LLM call', async () => {
    const { deps, clock } = makeDeps({
      runTriage: vi.fn(
        async (): Promise<LlmRunResult> => ({ ok: false, text: '', error: 'timeout', provider: 'claude-cli', ms: 1 })
      )
    });
    const svc = new IdleTriageService(deps);
    const emitted: IdleTriageResult[] = [];
    svc.on('triage', (r) => emitted.push(r));
    svc.observe('s', 'idle');
    clock.fireNext();
    await tick();
    expect(emitted).toHaveLength(0);
  });

  it('forgetting a session clears its pending dwell timer', () => {
    const { deps, clock } = makeDeps();
    const svc = new IdleTriageService(deps);
    svc.observe('s', 'idle');
    expect(clock.pendingCount()).toBe(1);
    svc.remove('s');
    expect(clock.pendingCount()).toBe(0);
    expect(clock.clearTimer).toHaveBeenCalledTimes(1);
  });

  describe('bounded concurrency and per-session budget', () => {
    /** Per-session info keyed off sessionId, so a multi-session burst can be modeled. */
    function makeMultiSessionDeps(over: Partial<IdleTriageDeps> = {}) {
      const clock = makeClock();
      const sessions = new Map<string, TriageSessionInfo>();
      const deps: IdleTriageDeps = {
        isEnabled: () => true,
        delaySeconds: () => 20,
        getSession: (id) => sessions.get(id) ?? null,
        hasTranscript: (p) => p === 'claude',
        readLastTurn: vi.fn(async () => 'Done — want me to commit?'),
        runTriage: vi.fn(async () => okResult('{"resolution":"done","summary":"finished"}')),
        now: () => 1000,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        ...over
      };
      return { deps, clock, sessions };
    }

    it(`caps concurrent in-flight triage calls at MAX_CONCURRENT_TRIAGES (${MAX_CONCURRENT_TRIAGES}) under a simultaneous burst`, async () => {
      const burstSize = MAX_CONCURRENT_TRIAGES + 2; // deliberately over the cap
      // Each call gets its own controllable resolver so we can hold calls "in flight".
      const resolvers: Array<(r: LlmRunResult) => void> = [];
      const runTriage = vi.fn(
        () =>
          new Promise<LlmRunResult>((res) => {
            resolvers.push(res);
          })
      );
      const { deps, clock, sessions } = makeMultiSessionDeps({ runTriage });
      const svc = new IdleTriageService(deps);

      for (let i = 0; i < burstSize; i++) {
        const id = `s${i}`;
        sessions.set(id, { profile: 'claude', cwd: '/proj', claudeSessionId: id, status: 'running' });
        svc.observe(id, 'working');
        svc.observe(id, 'idle'); // arms one dwell timer per session
      }
      expect(clock.pendingCount()).toBe(burstSize);

      // All sessions settle at rest simultaneously — fire every armed dwell at once.
      clock.fireAll();
      await tick();

      // Only the cap's worth actually spent a call; the rest backed off to a retry timer.
      expect(runTriage).toHaveBeenCalledTimes(MAX_CONCURRENT_TRIAGES);
      expect(clock.pendingCount()).toBe(burstSize - MAX_CONCURRENT_TRIAGES);

      // Resolve the in-flight calls and let the deferred sessions retry.
      for (const resolve of resolvers) resolve(okResult('{"resolution":"done","summary":"x"}'));
      await tick();
      clock.fireAll(); // fire the retry timers armed for the deferred sessions
      await tick();

      expect(runTriage).toHaveBeenCalledTimes(burstSize);
    });

    it(`stops triaging a session once it hits MAX_TRIAGES_PER_SESSION (${MAX_TRIAGES_PER_SESSION}) even if it keeps cycling idle`, async () => {
      const { deps, clock, sessions } = makeMultiSessionDeps();
      sessions.set('s', { profile: 'claude', cwd: '/proj', claudeSessionId: 's', status: 'running' });
      const svc = new IdleTriageService(deps);

      for (let i = 0; i < MAX_TRIAGES_PER_SESSION; i++) {
        svc.observe('s', 'working');
        svc.observe('s', 'idle');
        clock.fireNext();
        await tick();
      }
      expect(deps.runTriage).toHaveBeenCalledTimes(MAX_TRIAGES_PER_SESSION);

      // One more full working→idle cycle: dwell still arms, but the budget is spent.
      svc.observe('s', 'working');
      svc.observe('s', 'idle');
      expect(clock.pendingCount()).toBe(1); // dwell arms regardless of budget
      clock.fireNext();
      await tick();

      expect(deps.runTriage).toHaveBeenCalledTimes(MAX_TRIAGES_PER_SESSION); // unchanged — budget exhausted
    });

    it('removing a session that has an in-flight triage does not leak the global concurrency slot', async () => {
      let resolveCall: (r: LlmRunResult) => void = () => {};
      const runTriage = vi.fn(() => new Promise<LlmRunResult>((res) => { resolveCall = res; }));
      const { deps, clock, sessions } = makeMultiSessionDeps({ runTriage });
      sessions.set('s', { profile: 'claude', cwd: '/proj', claudeSessionId: 's', status: 'running' });
      const svc = new IdleTriageService(deps);

      svc.observe('s', 'working');
      svc.observe('s', 'idle');
      clock.fireNext();
      await tick(); // triage in flight, pending slot held

      svc.remove('s'); // session torn down mid-call (pty exit)
      resolveCall(okResult('{"resolution":"done","summary":"x"}'));
      await tick(); // the .finally() must still release the pending slot

      // A fresh burst up to the cap should all fire immediately — proves no slot leaked.
      for (let i = 0; i < MAX_CONCURRENT_TRIAGES; i++) {
        const id = `fresh-${i}`;
        sessions.set(id, { profile: 'claude', cwd: '/proj', claudeSessionId: id, status: 'running' });
        svc.observe(id, 'working');
        svc.observe(id, 'idle');
      }
      clock.fireAll();
      await tick();
      expect(runTriage).toHaveBeenCalledTimes(1 + MAX_CONCURRENT_TRIAGES); // the first + the full fresh burst, none deferred
    });
  });
});
