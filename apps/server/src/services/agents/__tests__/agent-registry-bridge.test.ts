/**
 * Verifies the Phase-0 registry wiring that index.ts hangs off the PtyManager
 * event bridge: auto-seed on `sessionUpdated`, drop on `exit`, and the
 * once-binding invariant (ticket #6 / consensus finding #1) that keeps those
 * handlers from being double-registered when the window is recreated.
 *
 * index.ts itself can't be imported in a unit test (Electron deps), so we
 * exercise the SAME logic: a real PtyManager (node-pty mocked), a real
 * AgentRegistryStore, and a `wireBridge` closure that mirrors index.ts's
 * `wireBridgeListeners` (the `bridgeListenersWired` guard + the seed/drop
 * handlers + the isClaudeProfile gate). If index.ts's wiring drifts from this,
 * the integration tests for the tools still pass but this guards the lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

interface FakeProc {
  pid: number;
  write: () => void;
  onData: (cb: (d: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  resize: () => void;
  kill: () => void;
  exitCb?: (e: { exitCode: number }) => void;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: () => {
    const proc: FakeProc = {
      pid: 3000 + spawned.length,
      write() {},
      onData() {},
      onExit(cb: (e: { exitCode: number }) => void) {
        this.exitCb = cb;
      },
      resize() {},
      kill() {
        this.exitCb?.({ exitCode: 0 });
      }
    };
    spawned.push(proc);
    return proc;
  }
}));

import { PtyManager, isClaudeProfile } from '@zana-ai/zcc-host-daemon/pty';
import { createAgentRegistryStore, type IAgentRegistryStore } from '@zana-ai/zcc-server';
import type { AppConfig, SessionCohort } from '@zana-ai/zcc-domain/product';

const cfg = { shell: '/bin/zsh', claudeBinary: 'claude' } as unknown as AppConfig;

function baseOpts(
  profile: 'claude' | 'shell',
  projectId = 'p1',
  cohort?: SessionCohort
) {
  return { projectId, profile, cwd: '/work/p1', cols: 80, rows: 24, config: cfg, cohort } as const;
}

describe('Phase-0 registry bridge wiring', () => {
  let ptys: PtyManager;
  let registry: IAgentRegistryStore;
  let wiredCount: number;
  // Mirror of index.ts's teamLaunchSessions: sessionId → teamLaunchId, populated
  // by launchTeam AFTER createTerminalConfined returns (the ordering that made
  // the auto-seed miss it — see the regression test below).
  let teamLaunchSessions: Map<string, string>;

  // Mirror of index.ts wireBridgeListeners — the once-binding guard plus the
  // seed-on-sessionUpdated and drop-on-exit handlers we added. The seed sources
  // teamLaunchId from the cohort STAMPED SYNCHRONOUSLY on the session by
  // create() (falling back to the side map), so it's present at the very first
  // synchronous sessionUpdated even though launchTeam fills the map only after
  // create() returns. Keep this in lockstep with index.ts's real handler.
  let bridgeWired = false;
  function wireBridge() {
    if (bridgeWired) return;
    bridgeWired = true;
    wiredCount += 1;
    ptys.on('exit', (sessionId: string) => {
      registry.drop(sessionId);
    });
    ptys.on('sessionUpdated', (session) => {
      if (isClaudeProfile(session.profile)) {
        registry.upsert({
          sessionId: session.id,
          projectId: session.projectId,
          cwd: session.cwd,
          handle: session.title || session.profile,
          teamLaunchId: session.cohort?.cohortId ?? teamLaunchSessions.get(session.id)
        });
      }
    });
  }

  beforeEach(() => {
    spawned.length = 0;
    ptys = new PtyManager();
    registry = createAgentRegistryStore();
    teamLaunchSessions = new Map();
    bridgeWired = false;
    wiredCount = 0;
  });

  it('seeds a claude session into the registry on spawn', () => {
    wireBridge();
    const s = ptys.create(baseOpts('claude'));
    const rec = registry.get(s.id);
    expect(rec).not.toBeNull();
    expect(rec?.projectId).toBe('p1');
    expect(rec?.cwd).toBe('/work/p1');
  });

  it('does NOT seed a shell session (no agent to discover)', () => {
    wireBridge();
    const s = ptys.create(baseOpts('shell'));
    expect(registry.get(s.id)).toBeNull();
  });

  it('seeds teamLaunchId from the cohort stamped on the session at spawn', () => {
    // Regression: a team-launched session's teamLaunchId must be recorded on the
    // FIRST (synchronous) sessionUpdated, not lost. launchTeam fills the
    // teamLaunchSessions map only AFTER create() returns, but create() emits
    // sessionUpdated synchronously — so the side map is still empty at seed time.
    // Sourcing from session.cohort.cohortId (stamped inside create()) fixes it.
    // Without the fix the record's teamLaunchId is undefined → the member drops
    // out of its squad in the Flow view and leaks into the "Solo agents" bucket.
    wireBridge();
    const cohort: SessionCohort = {
      cohortId: 'launch-xyz',
      teamId: 'squad-1',
      teamName: 'Review Squad',
      role: 'worker'
    };
    const s = ptys.create(baseOpts('claude', 'p1', cohort));
    // Mirror launchTeam: the side map is filled only AFTER create() returned.
    teamLaunchSessions.set(s.id, cohort.cohortId);

    expect(registry.get(s.id)?.teamLaunchId).toBe('launch-xyz');
  });

  it('leaves teamLaunchId undefined for a solo (cohort-less) session', () => {
    wireBridge();
    const s = ptys.create(baseOpts('claude'));
    expect(registry.get(s.id)?.teamLaunchId).toBeUndefined();
  });

  it('drops the record when the session exits', () => {
    wireBridge();
    const s = ptys.create(baseOpts('claude'));
    expect(registry.get(s.id)).not.toBeNull();
    ptys.close(s.id); // fake proc.kill → exitCb → ptys emits 'exit'
    expect(registry.get(s.id)).toBeNull();
  });

  it('binds the bridge exactly once across repeated wire calls (no double-register)', () => {
    wireBridge();
    wireBridge(); // simulate a window reopen calling it again
    wireBridge();
    expect(wiredCount).toBe(1);
    // The real leak symptom: listener counts must not climb.
    expect(ptys.listenerCount('exit')).toBe(1);
    expect(ptys.listenerCount('sessionUpdated')).toBe(1);

    // And the drop handler fires exactly once (no duplicate side-effects).
    const dropSpy = vi.spyOn(registry, 'drop');
    const s = ptys.create(baseOpts('claude'));
    ptys.close(s.id);
    expect(dropSpy).toHaveBeenCalledTimes(1);
  });
});
