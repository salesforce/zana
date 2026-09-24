import { describe, it, expect, vi } from 'vitest';
import { IdleGatedInjector, suppressesInteractiveBlocked } from '../idle-gated-injector.js';

function makeInjector(initialState = 'idle') {
  const states = new Map<string, string>();
  const reply = vi.fn((_sessionId: string, _text: string) => true);
  const clock = { t: 0 };
  const injector = new IdleGatedInjector({
    getState: (sessionId) => states.get(sessionId) ?? initialState,
    reply,
    now: () => clock.t
  });
  const setState = (sessionId: string, state: string) => states.set(sessionId, state);
  const advance = (ms: number) => { clock.t += ms; };
  return { injector, reply, setState, advance };
}

describe('IdleGatedInjector', () => {
  it('delivers immediately when the worker is already idle', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'idle');
    expect(injector.deliver('w1', 'task A')).toBe(true);
    expect(reply).toHaveBeenCalledWith('w1', 'task A');
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('queues an assignment while a freshly spawned worker state is unknown', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'unknown');
    injector.deliver('w1', 'task A');
    expect(reply).not.toHaveBeenCalled();
    expect(injector.pendingCount('w1')).toBe(1);
    injector.onState('w1', 'idle');
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
  });

  it('queues instead of injecting into a mid-turn (working) worker', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'working');
    expect(injector.deliver('w1', 'task A')).toBe(true); // accepted (queued)
    expect(reply).not.toHaveBeenCalled();
    expect(injector.pendingCount('w1')).toBe(1);
  });

  it('flushes the queued task on the transition into idle', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'working');
    injector.deliver('w1', 'task A');
    // non-idle transitions never flush
    injector.onState('w1', 'working');
    expect(reply).not.toHaveBeenCalled();
    // idle edge flushes
    injector.onState('w1', 'idle');
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('does not queue for other sessions and never cross-delivers', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'working');
    setState('w2', 'idle');
    injector.deliver('w1', 'for-w1');
    injector.deliver('w2', 'for-w2');
    expect(reply).toHaveBeenCalledExactlyOnceWith('w2', 'for-w2');
    // an idle edge on the unrelated w2 must not flush w1's queue
    injector.onState('w2', 'idle');
    expect(injector.pendingCount('w1')).toBe(1);
  });

  it('delivers a pile-up one idle-edge at a time (no back-to-back paste)', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'working');
    injector.deliver('w1', 'task A');
    injector.deliver('w1', 'task B');
    expect(injector.pendingCount('w1')).toBe(2);
    injector.onState('w1', 'idle');
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
    expect(injector.pendingCount('w1')).toBe(1);
    injector.onState('w1', 'idle');
    expect(reply).toHaveBeenLastCalledWith('w1', 'task B');
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('forget() drops a queued task so an exited worker never receives it', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'working');
    injector.deliver('w1', 'task A');
    injector.forget('w1');
    injector.onState('w1', 'idle');
    expect(reply).not.toHaveBeenCalled();
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('an idle edge with nothing queued is a no-op', () => {
    const { injector, reply } = makeInjector();
    injector.onState('w1', 'idle');
    expect(reply).not.toHaveBeenCalled();
  });

  it('flushes on any non-busy edge, not only idle (deliver()-symmetric safety net)', () => {
    // A worker that comes to rest in a non-busy, non-idle state must not strand
    // its queue — the flush gate mirrors deliver()'s `!BUSY_STATES.has(state)`.
    for (const restState of ['done']) {
      const { injector, reply, setState } = makeInjector();
      setState('w1', 'working');
      injector.deliver('w1', `task-${restState}`);
      expect(reply).not.toHaveBeenCalled();
      injector.onState('w1', restState);
      expect(reply).toHaveBeenCalledExactlyOnceWith('w1', `task-${restState}`);
      expect(injector.pendingCount('w1')).toBe(0);
    }
  });

  it('a blocked edge never flushes (still a busy state)', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'working');
    injector.deliver('w1', 'task A');
    injector.onState('w1', 'blocked');
    expect(reply).not.toHaveBeenCalled();
    expect(injector.pendingCount('w1')).toBe(1);
  });
});

describe('IdleGatedInjector.flushStale', () => {
  const STALE_MS = 45_000;

  it('does not flush an item that has not waited long enough', () => {
    const { injector, reply, setState, advance } = makeInjector();
    setState('w1', 'unknown'); // never yields a deliverable idle edge
    injector.deliver('w1', 'task A');
    advance(STALE_MS - 1);
    expect(injector.flushStale(STALE_MS)).toEqual([]);
    expect(reply).not.toHaveBeenCalled();
    expect(injector.pendingCount('w1')).toBe(1);
  });

  it('force-flushes a stranded item once the wait exceeds the bound (no idle edge ever)', () => {
    const { injector, reply, setState, advance } = makeInjector();
    setState('w1', 'unknown'); // telemetry gap: onState never fires a non-busy edge
    injector.deliver('w1', 'task A');
    advance(STALE_MS);
    expect(injector.flushStale(STALE_MS)).toEqual(['w1']);
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('flushes only ONE item per call and re-stamps the remainder for the next window', () => {
    const { injector, reply, setState, advance } = makeInjector();
    setState('w1', 'unknown');
    injector.deliver('w1', 'task A');
    injector.deliver('w1', 'task B');
    advance(STALE_MS);
    expect(injector.flushStale(STALE_MS)).toEqual(['w1']);
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
    expect(injector.pendingCount('w1')).toBe(1);
    // remainder was re-stamped: it must wait a FRESH window before force-flushing
    expect(injector.flushStale(STALE_MS)).toEqual([]);
    expect(injector.pendingCount('w1')).toBe(1);
    advance(STALE_MS);
    expect(injector.flushStale(STALE_MS)).toEqual(['w1']);
    expect(reply).toHaveBeenLastCalledWith('w1', 'task B');
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('a normal idle-edge flush pre-empts the stale timer', () => {
    const { injector, reply, setState, advance } = makeInjector();
    setState('w1', 'working');
    injector.deliver('w1', 'task A');
    advance(STALE_MS - 5_000);
    injector.onState('w1', 'idle'); // worker signalled normally before the bound
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
    advance(STALE_MS);
    expect(injector.flushStale(STALE_MS)).toEqual([]); // nothing left to force
  });

  it('is a no-op when there is nothing queued', () => {
    const { injector, reply, advance } = makeInjector();
    advance(STALE_MS * 10);
    expect(injector.flushStale(STALE_MS)).toEqual([]);
    expect(reply).not.toHaveBeenCalled();
  });

  it('force-flushes independently per session', () => {
    const { injector, reply, setState, advance } = makeInjector();
    setState('w1', 'unknown');
    setState('w2', 'unknown');
    injector.deliver('w1', 'for-w1');
    advance(30_000);
    injector.deliver('w2', 'for-w2'); // queued 30s later
    advance(STALE_MS - 30_000); // w1 hits bound, w2 has waited only 15s
    expect(injector.flushStale(STALE_MS)).toEqual(['w1']);
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'for-w1');
    expect(injector.pendingCount('w2')).toBe(1);
  });

  it('does NOT force-inject into an actively-working worker even past the bound (no mid-turn paste)', () => {
    const { injector, reply, setState, advance } = makeInjector();
    setState('w1', 'working'); // a genuine long turn — emits no deliverable edge while it runs
    injector.deliver('w1', 'next assignment');
    advance(STALE_MS * 3); // way past the bound
    // Skipped: a working TUI must never be pasted into mid-turn. Item stays queued.
    expect(injector.flushStale(STALE_MS)).toEqual([]);
    expect(reply).not.toHaveBeenCalled();
    expect(injector.pendingCount('w1')).toBe(1);
    // Turn ends → worker leaves `working`. queuedAt was preserved (not re-stamped),
    // so the very next sweep flushes immediately with no fresh wait window.
    setState('w1', 'idle');
    expect(injector.flushStale(STALE_MS)).toEqual(['w1']);
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'next assignment');
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('still force-flushes a silent `waiting` standby past the bound (escape hatch stays intact)', () => {
    const { injector, reply, setState, advance } = makeInjector();
    setState('w1', 'waiting'); // busy under the interactive contract, but never self-resolves to idle
    injector.deliver('w1', 'task A');
    advance(STALE_MS);
    expect(injector.flushStale(STALE_MS)).toEqual(['w1']);
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
    expect(injector.pendingCount('w1')).toBe(0);
  });
});

describe('IdleGatedInjector — headless worker (deliverableWhenSilent)', () => {
  // A headless worker with no interactive user: once it has BOOTED (reached a
  // rest state at least once), silence ('unknown'/'waiting') means "resting in
  // standby, ready", so those states are DELIVERABLE. Only active-output
  // 'working' still gates (mid-turn paste protection). This is the delivery twin
  // of suppressesInteractiveBlocked and the fix for a no-telemetry remote worker
  // stranding at 'unknown' until the 45s force-flush. BEFORE its first rest edge
  // the worker is still booting, so its 'unknown' QUEUES (boot-race fix).
  function makeHeadless(initialState = 'unknown') {
    const states = new Map<string, string>();
    const reply = vi.fn((_sessionId: string, _text: string) => true);
    const clock = { t: 0 };
    const headless = new Set<string>(['w1']); // w1 is a headless worker; others are not
    const injector = new IdleGatedInjector({
      getState: (sessionId) => states.get(sessionId) ?? initialState,
      reply,
      now: () => clock.t,
      deliverableWhenSilent: (sessionId) => headless.has(sessionId)
    });
    const setState = (sessionId: string, state: string) => states.set(sessionId, state);
    const advance = (ms: number) => { clock.t += ms; };
    return { injector, reply, setState, advance, headless };
  }

  it('BOOT RACE: queues (does NOT inject) for a freshly-spawned headless worker still at unknown', () => {
    // Regression for live run 2cfc03e7: the kickoff assignment was dispatched
    // ~2s after spawn while opencode was still booting (state 'unknown'). The
    // old deliverableWhenSilent injected it into a not-ready TUI → lost → the
    // unit stranded for a full lease window until the attempt-2 re-dispatch.
    const { injector, reply, setState } = makeHeadless();
    setState('w1', 'unknown'); // still booting — never rested
    expect(injector.deliver('w1', 'verify-upstream assignment')).toBe(true); // accepted
    expect(reply).not.toHaveBeenCalled(); // NOT injected into the booting TUI
    expect(injector.pendingCount('w1')).toBe(1);
    // Boots, runs its standby --prompt turn, settles at waiting → delivers now.
    injector.onState('w1', 'waiting');
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'verify-upstream assignment');
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('delivers immediately to a headless worker resting at unknown ONCE booted (recovered / no-telemetry)', () => {
    const { injector, reply, setState } = makeHeadless();
    // Worker booted earlier (a rest edge was observed), then its telemetry went
    // quiet back to 'unknown' — the f0f44413 no-telemetry strand case.
    setState('w1', 'idle');
    injector.onState('w1', 'idle'); // latches booted
    setState('w1', 'unknown');
    expect(injector.deliver('w1', 'task A')).toBe(true);
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('delivers immediately to a headless worker resting at waiting (rest state proves boot on deliver)', () => {
    // deliver() sees the live state is a rest state ('waiting'), which itself
    // latches booted — so a first delivery to an already-resting worker (no prior
    // onState edge) is trusted immediately rather than queued.
    const { injector, reply, setState } = makeHeadless();
    setState('w1', 'waiting');
    injector.deliver('w1', 'task A');
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('STILL queues for a headless worker that is actively working (mid-turn paste guard preserved)', () => {
    const { injector, reply, setState } = makeHeadless();
    setState('w1', 'working');
    expect(injector.deliver('w1', 'task A')).toBe(true);
    expect(reply).not.toHaveBeenCalled();
    expect(injector.pendingCount('w1')).toBe(1);
    // The settle edge into a silent state flushes it (no 45s force-flush needed).
    injector.onState('w1', 'waiting');
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('an unknown edge on a NOT-yet-booted headless worker does NOT flush (still booting)', () => {
    const { injector, reply, setState } = makeHeadless();
    setState('w1', 'working');
    injector.deliver('w1', 'task A');
    expect(reply).not.toHaveBeenCalled();
    injector.onState('w1', 'unknown'); // not a rest state; worker hasn't proven boot
    expect(reply).not.toHaveBeenCalled();
    expect(injector.pendingCount('w1')).toBe(1);
    // A genuine rest edge boots it and flushes.
    injector.onState('w1', 'idle');
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('flushes on the unknown settle edge ONCE the worker has booted', () => {
    const { injector, reply, setState } = makeHeadless();
    setState('w1', 'working');
    injector.deliver('w1', 'task A');
    injector.onState('w1', 'waiting'); // boots + flushes task A
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
    // A later assignment while its telemetry has gone quiet back to unknown
    // delivers immediately now that the worker is proven booted.
    setState('w1', 'unknown');
    injector.deliver('w1', 'task B');
    expect(injector.pendingCount('w1')).toBe(0); // booted headless: unknown deliverable → immediate
    expect(reply).toHaveBeenLastCalledWith('w1', 'task B');
  });

  it('flushStale still force-delivers a never-booted headless worker after the bound (safety net)', () => {
    const { injector, reply, setState, advance } = makeHeadless();
    setState('w1', 'unknown'); // spawns and never emits a rest edge
    injector.deliver('w1', 'task A');
    expect(reply).not.toHaveBeenCalled();
    advance(45_000);
    expect(injector.flushStale(45_000)).toEqual(['w1']);
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
  });

  it('does NOT change the interactive contract for a non-headless session in the same injector', () => {
    const { injector, reply, setState } = makeHeadless();
    setState('interactive-1', 'unknown'); // not in the headless set
    injector.deliver('interactive-1', 'task A');
    expect(reply).not.toHaveBeenCalled(); // unknown stays busy for an interactive session
    expect(injector.pendingCount('interactive-1')).toBe(1);
    injector.onState('interactive-1', 'idle');
    expect(reply).toHaveBeenCalledExactlyOnceWith('interactive-1', 'task A');
  });
});

describe('suppressesInteractiveBlocked', () => {
  it('suppresses the blocked overlay for a headless team worker', () => {
    expect(suppressesInteractiveBlocked({ headless: true, cohort: { role: 'worker' } })).toBe(true);
  });

  it('keeps the overlay for a visible (non-headless) worker', () => {
    expect(suppressesInteractiveBlocked({ headless: false, cohort: { role: 'worker' } })).toBe(false);
  });

  it('keeps the overlay for a headless non-worker (e.g. orchestrator or solo run)', () => {
    expect(suppressesInteractiveBlocked({ headless: true, cohort: { role: 'orchestrator' } })).toBe(false);
    expect(suppressesInteractiveBlocked({ headless: true })).toBe(false);
  });

  it('is safe on a missing session', () => {
    expect(suppressesInteractiveBlocked(null)).toBe(false);
    expect(suppressesInteractiveBlocked(undefined)).toBe(false);
  });
});
