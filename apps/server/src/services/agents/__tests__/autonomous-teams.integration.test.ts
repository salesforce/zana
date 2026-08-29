import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Project, AppConfig, ProjectSettings, Persona, Team } from '@zana-ai/zcc-domain/product';

/**
 * Full-lifecycle integration ("e2e") test for autonomous teams. Drives the REAL
 * launchAutonomousTeam / stopAutonomousRun handler bodies + the REAL
 * AutonomousRunSupervisor (constructed inside index.ts, bound to the real ptys
 * deps) + the REAL launchTeam. Only the pty and inbox boundaries are faked.
 *
 * The supervisor's observe()/onSessionExit() are normally driven from the
 * agent-status edge / pty-exit handler (wireBridgeListeners, not run in tests),
 * so we call them directly on the exported supervisor instance — it is the real
 * one, wired to the real ptys.reply/ptys.close mocks below.
 */

const PROJECT: Project = { id: 'p1', name: 'Proj', path: '/tmp/proj' } as Project;

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
  // Autonomous backstops: tiny nudge delay (fake timers), small round cap, no timeout.
  autonomousNudgeDelaySeconds: 1,
  autonomousMaxRounds: 3,
  autonomousTimeoutMs: 0
} as AppConfig;

const PERSONAS: Persona[] = [
  { id: 'builtin:orchestrator', name: 'Orchestrator', baseProfile: 'claude' },
  { id: 'builtin:software-engineer', name: 'Engineer', baseProfile: 'claude' }
];

let TEAMS: Team[] = [];

// --- pty mock: track live sessions so getSession/close behave realistically ---
let createCount = 0;
const liveSessions = new Set<string>();
const replySpy = vi.fn((_id: string, _text: string) => true);
const closeSpy = vi.fn((id: string) => {
  liveSessions.delete(id);
});

vi.mock('../pty.js', () => {
  class PtyManager {
    create() {
      createCount += 1;
      const id = `s${createCount}`;
      liveSessions.add(id);
      return { id };
    }
    waitForReady(id: string) { return { id }; }
    getSession(id: string) {
      return liveSessions.has(id) ? ({ id, status: 'running' } as unknown) : null;
    }
    reply(id: string, text: string) {
      return replySpy(id, text);
    }
    close(id: string) {
      return closeSpy(id);
    }
    // Injected once at boot by index.ts (spawn-time cwd confinement, Rule 2).
    // A no-op here keeps the mock's surface in step with the real PtyManager.
    setProjectRoots() {}
    // Injected once at boot by index.ts (WARP-C5 layered RULES.md).
    setRulesResolver() {}
    on() {}
  }
  return { PtyManager, isClaudeProfile: (p: string) => p === 'claude' };
});

vi.mock('../store.js', () => ({
  store: {
    listProjects: () => [PROJECT],
    getConfig: () => CONFIG,
    getProjectSettings: () => ({} as ProjectSettings),
    createScratchSubfolder: () => '/tmp/proj/scratch'
  }
}));

// --- inbox mock: capture the run-ended notice ---
const inboxAppendSpy = vi.fn(async (_input: { projectId: string; comments?: string }) => ({
  id: 'inbox-1'
}));
vi.mock('@zana-ai/zcc-server', () => ({
  createInboxStore: () => ({
    append: inboxAppendSpy,
    read: () => [],
    delete: () => {},
    deleteMany: () => {},
    onAppended: () => {},
    onRemoved: () => {},
    onUpdated: () => {},
    onPruned: () => {}
  })
}));

vi.mock('../persona-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../persona-store.js')>();
  return {
    ...actual,
    PersonaStore: class {
      list() {
        return PERSONAS;
      }
      on() {}
      start() {}
      stop() {}
      rebindProjects() {}
    }
  };
});

vi.mock('../team-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../team-store.js')>();
  return {
    ...actual,
    TeamStore: class {
      list() {
        return TEAMS;
      }
      on() {}
      start() {}
      stop() {}
      rebindProjects() {}
    }
  };
});

vi.mock('electron', () => ({
  // index.ts constructs the harness credential store at module scope, which
  // reads `safeStorage`; isEncryptionAvailable:false routes it to its plaintext
  // fallback so no encrypt/decrypt stub is needed.
  safeStorage: { isEncryptionAvailable: () => false },
  app: {
    on: () => {},
    whenReady: () => new Promise(() => {}),
    getPath: () => '/tmp/zcc-autonomous-team-test',
    setName: () => {},
    requestSingleInstanceLock: () => true,
    quit: () => {}
  },
  BrowserWindow: class {
    static getAllWindows() {
      return [];
    }
    static getFocusedWindow() {
      return null;
    }
  },
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: {},
  shell: {},
  screen: {},
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({}) },
  powerMonitor: { on: () => {} }
}));

vi.mock('../../../../../desktop/src/updater.js', () => ({ createUpdater: () => ({}) }));
vi.mock('-ai/zcc-host-daemon/mcp-config', () => ({
  ensureMcpConfigForProject: () => '/tmp/p1/.mcp.json',
  ensureMcpConfigForProjectSync: () => '/tmp/p1/.mcp.json'
}));

const { launchAutonomousTeam, stopAutonomousRun, autonomousRuns } = await import('../../../../../desktop/src/host.js');

const TEAM: Team = {
  id: 'eng',
  name: 'Engineering Squad',
  orchestratorPersonaId: 'builtin:orchestrator',
  initialPrompt: 'Coordinate the build.',
  slots: [
    { personaId: 'builtin:orchestrator', quantity: 1 },
    { personaId: 'builtin:software-engineer', quantity: 2 }
  ]
};

describe('autonomous teams — full lifecycle', () => {
  beforeEach(() => {
    createCount = 0;
    liveSessions.clear();
    replySpy.mockClear();
    closeSpy.mockClear();
    inboxAppendSpy.mockClear();
    TEAMS = [TEAM];
    // Defensive: ensure no leftover running run from a prior test.
    for (const r of autonomousRuns.list()) {
      if (r.state === 'running') autonomousRuns.stop(r.runId, 'manual');
    }
    replySpy.mockClear();
    closeSpy.mockClear();
    inboxAppendSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects an empty goal before opening any tabs', async () => {
    const res = await launchAutonomousTeam('eng', 'p1', '   ');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INVALID');
    expect(createCount).toBe(0);
  });

  it('rejects a team with no orchestrator', async () => {
    TEAMS = [{ id: 'noorch', name: 'No Orch', slots: [{ personaId: 'builtin:software-engineer' }] }];
    const res = await launchAutonomousTeam('noorch', 'p1', 'do the thing');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NO_ORCHESTRATOR');
  });

  it('launches orchestrator + workers and registers a running run', async () => {
    const res = await launchAutonomousTeam('eng', 'p1', 'Ship feature X');
    expect(res.ok).toBe(true);
    // Workers open FIRST (2 engineers → s1, s2), orchestrator LAST (s3).
    expect(createCount).toBe(3);
    const run = autonomousRuns.list().find((r) => r.state === 'running');
    expect(run).toBeTruthy();
    expect(run!.orchestratorSessionId).toBe('s3');
    expect(run!.workerSessionIds).toEqual(['s1', 's2']);
    expect(run!.goal).toBe('Ship feature X');
    // clean up
    stopAutonomousRun(run!.runId);
  });

  it('nudges an idle worker toward the goal via the real ptys.reply', async () => {
    vi.useFakeTimers();
    const res = await launchAutonomousTeam('eng', 'p1', 'Ship feature X');
    expect(res.ok).toBe(true);
    // Drive the worker idle (normally the agent-status edge does this).
    autonomousRuns.observe('s2', 'idle');
    expect(replySpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000); // nudgeDelaySeconds = 1
    expect(replySpy).toHaveBeenCalledTimes(1);
    const [sid, text] = replySpy.mock.calls[0];
    expect(sid).toBe('s2');
    expect(text).toContain('Ship feature X');
    // clean up
    const run = autonomousRuns.list().find((r) => r.state === 'running');
    if (run) stopAutonomousRun(run.runId);
  });

  it('completes the run when the orchestrator exits, closing workers + notifying inbox', async () => {
    const res = await launchAutonomousTeam('eng', 'p1', 'Ship feature X');
    expect(res.ok).toBe(true);
    const runId = res.ok ? res.value.runId : '';

    // Orchestrator (s3) declares the goal met via complete_autonomous_run.
    autonomousRuns.complete('s3', 'Shipped X: added the endpoint, wired the UI, tests green.');

    const run = autonomousRuns.list().find((r) => r.runId === runId);
    expect(run!.state).toBe('completed');
    expect(run!.stopReason).toBe('goal-reached');
    expect(run!.summary).toContain('Shipped X');
    // Workers (s1, s2) torn down via the real ptys.close; orchestrator tab LEFT OPEN.
    expect(closeSpy).toHaveBeenCalledWith('s1');
    expect(closeSpy).toHaveBeenCalledWith('s2');
    expect(closeSpy).not.toHaveBeenCalledWith('s3');
    // Exactly one consolidated inbox overview, carrying the summary.
    expect(inboxAppendSpy).toHaveBeenCalledTimes(1);
    expect(inboxAppendSpy.mock.calls[0][0].comments ?? '').toContain('Shipped X');
  });

  it('treats an orchestrator pty exit without complete as orchestrator-gone failure', async () => {
    const res = await launchAutonomousTeam('eng', 'p1', 'Ship feature X');
    expect(res.ok).toBe(true);
    const runId = res.ok ? res.value.runId : '';

    autonomousRuns.onSessionExit('s3'); // orchestrator died without declaring done
    const run = autonomousRuns.list().find((r) => r.runId === runId);
    expect(run!.state).toBe('failed');
    expect(run!.stopReason).toBe('orchestrator-gone');
    expect(closeSpy).toHaveBeenCalledWith('s1');
    expect(closeSpy).toHaveBeenCalledWith('s2');
  });

  it('manual stop tears down all sessions and notifies', async () => {
    const res = await launchAutonomousTeam('eng', 'p1', 'Ship feature X');
    expect(res.ok).toBe(true);
    const runId = res.ok ? res.value.runId : '';

    const stop = stopAutonomousRun(runId);
    expect(stop.ok).toBe(true);
    const run = autonomousRuns.list().find((r) => r.runId === runId);
    expect(run!.state).toBe('stopped');
    expect(run!.stopReason).toBe('manual');
    expect(closeSpy).toHaveBeenCalledWith('s1');
    expect(closeSpy).toHaveBeenCalledWith('s2');
    expect(closeSpy).toHaveBeenCalledWith('s3');
    expect(inboxAppendSpy).toHaveBeenCalledTimes(1);
  });

  it('stopAutonomousRun returns NOT_FOUND for an unknown run', () => {
    const stop = stopAutonomousRun('does-not-exist');
    expect(stop.ok).toBe(false);
    if (!stop.ok) expect(stop.code).toBe('NOT_FOUND');
  });

  it('timeoutMs=0 in AppConfig disables timeout at integration level', async () => {
    // This test verifies that the AppConfig.autonomousTimeoutMs=0 setting
    // (line 28 above) correctly disables the timeout at launch time.
    vi.useFakeTimers();
    const res = await launchAutonomousTeam('eng', 'p1', 'Ship feature X');
    expect(res.ok).toBe(true);
    const runId = res.ok ? res.value.runId : '';

    // Simulate a very long passage of time with no activity
    vi.advanceTimersByTime(100_000_000); // ~28 hours

    // The run should still be alive (no timeout fired)
    const run = autonomousRuns.list().find((r) => r.runId === runId);
    expect(run!.state).toBe('running');
    expect(run!.limits.timeoutMs).toBe(0);

    // Clean up
    stopAutonomousRun(runId);
  });
});
