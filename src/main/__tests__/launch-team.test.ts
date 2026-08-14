import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import type { Project, AppConfig, ProjectSettings, Persona, Team } from '../../shared/types.js';

/**
 * Test plan #7 — launchTeam resolves slots, opens Σ quantity tabs through the
 * confined create path, opens the orchestrator FIRST (carrying the team prompt),
 * skips unknown persona ids, and lets the existing main-side denylist sanitize
 * argv (we route through the real `createTerminalConfined`).
 *
 * The persona/team stores and the project store are mocked so `launchTeam` (which
 * reads the module-level singletons in index.ts) sees a controllable catalogue.
 * `electron` is mocked with a never-resolving whenReady so importing index.ts is
 * side-effect-free.
 */

const PROJECT: Project = { id: 'p1', name: 'Proj', path: '/tmp/proj' } as Project;

// Main launch code canonicalizes registered project paths. Keep this shared
// fixture real rather than depending on a developer's leftover /tmp state.
mkdirSync(PROJECT.path, { recursive: true });

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

const PERSONAS: Persona[] = [
  { id: 'builtin:orchestrator', name: 'Orchestrator', baseProfile: 'claude' },
  { id: 'builtin:reviewer', name: 'Reviewer', baseProfile: 'claude' },
  { id: 'builtin:software-engineer', name: 'Engineer', baseProfile: 'claude' },
  { id: 'builtin:shell-worker', name: 'Shell', baseProfile: 'shell' }
];

let TEAMS: Team[] = [];

// Count create calls so each mock session gets a distinct id, and record the
// opts each one received so we can assert on the cohort stamp threaded through.
let createCount = 0;
let createCalls: Array<{ id: string; opts: Record<string, unknown> }> = [];
let closeCalls: string[] = [];
let readyGate: Promise<void> | undefined;
let failTeamLifecycleWorkerWrite = false;

vi.mock('../harness-routing-migration/storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../harness-routing-migration/storage.js')>();
  return {
    ...actual,
    atomicDurableWrite: (target: string, bytes: Buffer, options?: Parameters<typeof actual.atomicDurableWrite>[2]) => {
      if (failTeamLifecycleWorkerWrite && target.endsWith('team-lifecycle.json')) {
        const state = JSON.parse(bytes.toString('utf8')) as { records?: Array<{ workers?: unknown[] }> };
        if (state.records?.some((record) => (record.workers?.length ?? 0) > 0)) {
          throw new Error('lifecycle disk full');
        }
      }
      return actual.atomicDurableWrite(target, bytes, options);
    }
  };
});

vi.mock('../pty.js', () => {
  class PtyManager {
    setMcpBaseUrl() {}
    setProjectRoots() {}
    setRulesResolver() {}
    create(opts: Record<string, unknown>) {
      const extra = opts.extraArgs as string[] | undefined;
      if (extra?.includes('FAIL-SPAWN')) throw new Error('test spawn failed');
      createCount += 1;
      const id = typeof opts.preallocatedSessionId === 'string' ? opts.preallocatedSessionId : `s${createCount}`;
      createCalls.push({ id, opts });
      return { id };
    }
    async waitForReady(id: string) {
      await readyGate;
      return { id };
    }
    getSession(id: string) {
      return createCalls.some((call) => call.id === id) ? { id, projectId: 'p1' } : null;
    }
    close(id: string) {
      closeCalls.push(id);
    }
    closeExpected(id: string) {
      this.close(id);
      return true;
    }
    async killRemoteTmux() {
      return false;
    }
    setRestoreCapabilityId() {}
  }
  return { PtyManager, isClaudeProfile: (p: string) => p === 'claude' };
});

vi.mock('../store.js', () => ({
  store: {
    listProjects: () => [PROJECT],
    getConfig: () => CONFIG,
    getProjectSettings: () => ({} as ProjectSettings),
    createScratchSubfolder: () => '/tmp/proj/scratch'
  },
  scratchWorkspaceRoot: () => '/tmp/scratch-root',
  worktreeRoot: () => '/tmp/zcc-worktrees',
  worktreeTargetDir: (_p: unknown, slug: string) => `/tmp/zcc-worktrees/${slug}`
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
    getPath: () => '/tmp/zcc-launch-team-test',
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

vi.mock('../updater.js', () => ({ createUpdater: () => ({}) }));
vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProject: () => '/tmp/p1/.mcp.json',
  ensureMcpConfigForProjectSync: () => '/tmp/p1/.mcp.json'
}));

// launchTeam's execution preflight probes each harness's installed CLI version
// via verifyHarnesses (a real `<binary> --version` exec). Pin it to the
// evidence-registry's approved versions so structured-routing assertions are
// deterministic regardless of what's actually installed on the machine
// running the suite (see evidence-registry.ts's per-family cliVersion pins).
vi.mock('../harness/harness-verify.js', () => ({
  verifyHarnesses: async () => ([
    { family: 'claude', label: 'Claude Code', binary: 'claude', enabled: true, alwaysEnabled: true, installed: true, normalizedVersion: '2.1.220' },
    { family: 'cursor', label: 'Cursor', binary: 'cursor', enabled: true, alwaysEnabled: false, installed: true, normalizedVersion: '2026.01.23' },
    { family: 'codex', label: 'Codex', binary: 'codex', enabled: true, alwaysEnabled: false, installed: true, normalizedVersion: '0.140.0' },
    { family: 'pi', label: 'PI', binary: 'pi', enabled: true, alwaysEnabled: false, installed: true, normalizedVersion: '0.52.12' },
    { family: 'opencode', label: 'OpenCode', binary: 'opencode', enabled: true, alwaysEnabled: false, installed: true, normalizedVersion: '1.18.10' }
  ])
}));

// launchTeam routes through the real, module-internal createTerminalConfined →
// ptys.create (mocked above). We assert on the Result's `launched` count.
const { authorizeTeamLaunch, launchTeam, cascadeCloseTeamOnOrchestratorExit } = await import('../index.js');

describe('launchTeam', () => {
  beforeEach(() => {
    rmSync('/tmp/zcc-launch-team-test/team-lifecycle.json', { force: true });
    createCount = 0;
    createCalls = [];
    closeCalls = [];
    readyGate = undefined;
    failTeamLifecycleWorkerWrite = false;
    TEAMS = [];
  });

  // Pull the cohort stamp off each recorded create() call.
  const cohorts = () =>
    createCalls.map((c) => c.opts.cohort as
      | { cohortId: string; teamId: string; teamName: string; role: string; slotLabel?: string; slotId?: string }
      | undefined);

  // createTerminalConfined turns the opening `prompt` into the LAST positional
  // of extraArgs (the claude `[prompt]` convention), so that's where a launched
  // tab's prompt lands by the time ptys.create sees it.
  const promptOf = (call?: { opts: Record<string, unknown> }): string | undefined => {
    const extra = call?.opts.extraArgs as string[] | undefined;
    return extra && extra.length > 0 ? extra[extra.length - 1] : undefined;
  };
  const orchestratorCall = () =>
    createCalls.find((c) => (c.opts.cohort as { role?: string })?.role === 'orchestrator');

  it('returns NOT_FOUND for an unknown team', async () => {
    const res = await launchTeam('nope', 'p1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NOT_FOUND');
  });

  it('opens Σ quantity tabs, skipping unknown persona ids', async () => {
    TEAMS = [
      {
        id: 'squad',
        name: 'Squad',
        orchestratorPersonaId: 'builtin:orchestrator',
        initialPrompt: 'Lead the work.',
        slots: [
          { personaId: 'builtin:orchestrator', quantity: 1 },
          { personaId: 'builtin:software-engineer', quantity: 2 },
          { personaId: 'does-not-exist', quantity: 5 } // skipped
        ]
      }
    ];
    const res = await launchTeam('squad', 'p1');
    expect(res.ok).toBe(true);
    // 1 orchestrator + 2 engineers = 3 tabs; the unknown slot is skipped.
    if (res.ok) expect(res.value.launched).toBe(3);
  });

  it('honors each legacy Team Persona harness profile', async () => {
    PERSONAS.push({ id: 'opencode-worker', name: 'OpenCode Worker', baseProfile: 'opencode' });
    try {
      TEAMS = [{ id: 'opencode-team', name: 'OpenCode Team', slots: [{ personaId: 'opencode-worker' }] }];

      const result = await launchTeam('opencode-team', 'p1');

      expect(result).toMatchObject({ ok: true, value: { launched: 1 } });
      expect(createCalls[0]?.opts.profile).toBe('opencode');
    } finally {
      PERSONAS.pop();
    }
  });

  it.each([
    ['claude', 'claude'],
    ['cursor', 'cursor'],
    ['codex', 'codex'],
    ['pi', 'pi'],
    ['opencode', 'opencode']
  ] as const)('launches Team slots through registered %s adapter profile', async (_adapter, profile) => {
    const personaId = `worker-${profile}`;
    PERSONAS.push({ id: personaId, name: `${profile} worker`, baseProfile: profile });
    try {
      TEAMS = [{ id: `team-${profile}`, name: `${profile} Team`, slots: [{ personaId }] }];

      const result = await launchTeam(`team-${profile}`, 'p1');

      expect(result).toMatchObject({ ok: true, value: { launched: 1 } });
      expect(createCalls[0]?.opts.profile).toBe(profile);
    } finally {
      PERSONAS.pop();
    }
  });

  it('routes a neutral Team Persona through global harness default', async () => {
    const personaId = 'neutral-worker';
    PERSONAS.push({ id: personaId, name: 'Neutral Worker', modelLevel: 'medium' });
    CONFIG.defaultHarness = 'opencode';
    CONFIG.harnessOpenCodeEnabled = true;
    try {
      TEAMS = [{ id: 'neutral-team', name: 'Neutral Team', slots: [{ personaId }] }];

      const result = await launchTeam('neutral-team', 'p1');

      expect(result).toMatchObject({ ok: true, value: { launched: 1 } });
      expect(createCalls[0]?.opts.profile).toBe('opencode');
    } finally {
      delete CONFIG.defaultHarness;
      delete CONFIG.harnessOpenCodeEnabled;
      PERSONAS.pop();
    }
  });

  it('preauthorizes a neutral Team Persona through the same global harness default', async () => {
    PERSONAS.push({ id: 'neutral-preauth', name: 'Neutral Preauth' });
    TEAMS = [{ id: 'neutral-preauth-team', name: 'Neutral', slots: [{ personaId: 'neutral-preauth' }] }];
    CONFIG.defaultHarness = 'opencode';
    CONFIG.harnessOpenCodeEnabled = true;
    try {
      const authorized = authorizeTeamLaunch(
        'caller-neutral', 'neutral-preauth-team', 'p1', 'neutral-request', {}, [{ initialTask: 'review' }]
      );
      expect(authorized.ok).toBe(true);
      if (!authorized.ok) return;
      const result = await launchTeam('neutral-preauth-team', 'p1', {
        callerPrincipalId: 'caller-neutral', launchRequestId: 'neutral-request', requirePreauthorization: true,
        slots: authorized.value.slots.map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }))
      });
      expect(result.ok).toBe(true);
      expect(createCalls[0]?.opts.profile).toBe('opencode');
    } finally {
      delete CONFIG.defaultHarness;
      delete CONFIG.harnessOpenCodeEnabled;
      PERSONAS.pop();
    }
  });

  it('preserves unsupported legacy Persona facets during structured OpenCode Team launch', async () => {
    PERSONAS.push({
      id: 'opencode-structured-worker',
      name: 'OpenCode Structured Worker',
      baseProfile: 'opencode',
      appendSystemPrompt: 'Existing Persona instructions.',
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: {
          opencode: {
            providerTargetId: 'openai',
            modelTargetId: 'aisuite/gpt-5.6-terra',
            executionState: 'autonomous'
          }
        }
      }
    });
    TEAMS = [{
      id: 'opencode-structured-team',
      name: 'OpenCode Structured Team',
      slots: [{ personaId: 'opencode-structured-worker' }]
    }];
    CONFIG.harnessOpenCodeEnabled = true;
    try {
      const authorized = authorizeTeamLaunch(
        'caller-opencode',
        'opencode-structured-team',
        'p1',
        'opencode-structured-request',
        {},
        [{ initialTask: 'Inspect this project.' }]
      );
      expect(authorized.ok).toBe(true);
      if (!authorized.ok) return;

      const result = await launchTeam('opencode-structured-team', 'p1', {
        callerPrincipalId: 'caller-opencode',
        launchRequestId: 'opencode-structured-request',
        requirePreauthorization: true,
        slots: authorized.value.slots.map(({ slotId, initialTask, authorizationId }) => ({
          slotId,
          initialTask,
          authorizationId
        }))
      });

      expect(result).toMatchObject({ ok: true, value: { launched: 1 } });
      expect(createCalls[0]?.opts).toMatchObject({
        profile: 'opencode',
        extraArgs: ['--prompt', 'Inspect this project.']
      });
    } finally {
      delete CONFIG.harnessOpenCodeEnabled;
      PERSONAS.pop();
    }
  });

  it('uses the team defaultProjectId when none is supplied', async () => {
    TEAMS = [
      {
        id: 'squad',
        name: 'Squad',
        defaultProjectId: 'p1',
        slots: [{ personaId: 'builtin:reviewer', quantity: 1 }]
      }
    ];
    const res = await launchTeam('squad');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.launched).toBe(1);
  });

  it('fails with INVALID when no projectId and no defaultProjectId', async () => {
    TEAMS = [{ id: 'squad', name: 'Squad', slots: [{ personaId: 'builtin:reviewer' }] }];
    const res = await launchTeam('squad');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INVALID');
  });

  it('preserves legacy zero-launch compatibility when every unstructured slot persona is unknown', async () => {
    TEAMS = [
      { id: 'squad', name: 'Squad', slots: [{ personaId: 'ghost-1' }, { personaId: 'ghost-2' }] }
    ];
    const res = await launchTeam('squad', 'p1');
    expect(res).toMatchObject({ ok: true, value: { launched: 0, workers: [] } });
  });

  it('caps the total tabs opened by one launch (Rule 5)', async () => {
    TEAMS = [
      {
        id: 'huge',
        name: 'Huge',
        slots: Array.from({ length: 10 }, () => ({
          personaId: 'builtin:reviewer',
          quantity: 16
        }))
      }
    ];
    const res = await launchTeam('huge', 'p1');
    expect(res.ok).toBe(true);
    // 10 * 16 = 160 requested, but bounded to 32.
    if (res.ok) expect(res.value.launched).toBe(32);
  }, 15_000);

  it('enforces structured request total launch budget before spawn', async () => {
    TEAMS = [{ id: 'budgeted', name: 'Budgeted', slots: [
      { personaId: 'builtin:reviewer' }, { personaId: 'builtin:software-engineer' }
    ] }];
    const result = await launchTeam('budgeted', 'p1', {
      callerPrincipalId: 'caller-budget', launchRequestId: 'budget-request',
      policy: { maxConcurrent: 1, maxLaunches: 1 },
      slots: [
        { slotId: '0:builtin:reviewer:0', initialTask: 'review' },
        { slotId: '1:builtin:software-engineer:0', initialTask: 'build' }
      ]
    });

    expect(result).toMatchObject({ ok: false, code: 'RESOURCE_LIMIT' });
    expect(createCalls).toHaveLength(0);
  });

  it('returns the orchestrator + worker session ids (orchestrator opens LAST)', async () => {
    TEAMS = [
      {
        id: 'squad',
        name: 'Squad',
        orchestratorPersonaId: 'builtin:orchestrator',
        initialPrompt: 'Lead the work.',
        slots: [
          { personaId: 'builtin:orchestrator', quantity: 1 },
          { personaId: 'builtin:software-engineer', quantity: 2 }
        ]
      }
    ];
    const res = await launchTeam('squad', 'p1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Workers open first (s1, s2), the orchestrator opens LAST (s3) so it can
      // be handed the workers' session ids in its roster prompt.
      expect(res.value.workerSessionIds).toEqual(createCalls.slice(0, 2).map((call) => call.id));
      expect(res.value.orchestratorSessionId).toBe(createCalls[2].id);
      expect(res.value.launched).toBe(3);
    }
  });

  it('stamps every launched tab with one shared cohortId + the team id/name', async () => {
    TEAMS = [
      {
        id: 'squad',
        name: 'Review Squad',
        orchestratorPersonaId: 'builtin:orchestrator',
        initialPrompt: 'Lead.',
        slots: [
          { personaId: 'builtin:orchestrator', quantity: 1 },
          { personaId: 'builtin:software-engineer', quantity: 2 }
        ]
      }
    ];
    const res = await launchTeam('squad', 'p1');
    expect(res.ok).toBe(true);
    const stamps = cohorts();
    expect(stamps).toHaveLength(3);
    // All non-undefined, one shared cohortId, correct team identity.
    const ids = new Set(stamps.map((c) => c?.cohortId));
    expect(ids.size).toBe(1);
    const cohortId = [...ids][0];
    expect(cohortId).toBeTruthy();
    if (res.ok) expect(res.value.cohortId).toBe(cohortId);
    for (const c of stamps) {
      expect(c?.teamId).toBe('squad');
      expect(c?.teamName).toBe('Review Squad');
    }
  });

  it('accepts an optional goal without breaking launch', async () => {
    TEAMS = [
      {
        id: 'squad',
        name: 'Squad',
        orchestratorPersonaId: 'builtin:orchestrator',
        initialPrompt: 'Lead the work.',
        slots: [{ personaId: 'builtin:orchestrator', quantity: 1 }]
      }
    ];
    const res = await launchTeam('squad', 'p1', { goal: 'Ship feature X' });
    expect(res.ok).toBe(true);
    // Solo orchestrator (no workers) → it's the only tab, s1.
    if (res.ok) expect(res.value.orchestratorSessionId).toBe(createCalls[0].id);
  });

  it('marks exactly the orchestrator tab as role:orchestrator, the rest workers', async () => {
    TEAMS = [
      {
        id: 'squad',
        name: 'Squad',
        orchestratorPersonaId: 'builtin:orchestrator',
        slots: [
          { personaId: 'builtin:orchestrator', quantity: 1 },
          { personaId: 'builtin:software-engineer', quantity: 2 }
        ]
      }
    ];
    await launchTeam('squad', 'p1');
    const roles = cohorts().map((c) => c?.role);
    expect(roles.filter((r) => r === 'orchestrator')).toHaveLength(1);
    expect(roles.filter((r) => r === 'worker')).toHaveLength(2);
    // Orchestrator opens LAST now (workers first), so it can be handed their
    // session ids in its roster prompt.
    expect(roles[roles.length - 1]).toBe('orchestrator');
  });

  it('opens a standalone orchestrator tab (not a slot) as the orchestrator role', async () => {
    TEAMS = [
      {
        id: 'squad',
        name: 'Squad',
        orchestratorPersonaId: 'builtin:orchestrator', // NOT one of the slots
        slots: [{ personaId: 'builtin:software-engineer', quantity: 1 }]
      }
    ];
    const res = await launchTeam('squad', 'p1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.launched).toBe(2); // 1 engineer (worker) + standalone orch
    const roles = cohorts().map((c) => c?.role);
    // Orchestrator opens LAST (after the worker), carrying the roster.
    expect(roles[roles.length - 1]).toBe('orchestrator');
    expect(roles.filter((r) => r === 'orchestrator')).toHaveLength(1);
    expect(roles.filter((r) => r === 'worker')).toHaveLength(1);
  });

  it('carries the slot label into the worker cohort stamp', async () => {
    TEAMS = [
      {
        id: 'squad',
        name: 'Squad',
        slots: [{ personaId: 'builtin:software-engineer', quantity: 1, label: 'Backend' }]
      }
    ];
    await launchTeam('squad', 'p1');
    expect(cohorts()[0]?.slotLabel).toBe('Backend');
    expect(cohorts()[0]?.slotId).toBe('0:builtin:software-engineer:0');
  });

  it("hands the orchestrator a roster of the workers' session ids in its prompt", async () => {
    TEAMS = [
      {
        id: 'squad',
        name: 'Review Squad',
        orchestratorPersonaId: 'builtin:orchestrator',
        initialPrompt: 'Ship the feature.',
        slots: [
          { personaId: 'builtin:orchestrator', quantity: 1 },
          { personaId: 'builtin:software-engineer', quantity: 2 },
          { personaId: 'builtin:reviewer', quantity: 1, label: 'QA' }
        ]
      }
    ];
    await launchTeam('squad', 'p1');
    // The orchestrator opened last; its create() call carries the briefing as
    // the trailing positional arg.
    const prompt = promptOf(orchestratorCall()) ?? '';
    expect(prompt).toContain('Ship the feature.'); // team prompt preserved
    expect(prompt).toContain('orchestrator of the "Review Squad" team');
    expect(prompt).toContain('agent_send');
    // Every worker's session id is addressable in the roster. Workers are s1..s3
    // (opened before the orchestrator).
    const workerIds = createCalls
      .filter((c) => (c.opts.cohort as { role?: string })?.role === 'worker')
      .map((c) => c.id);
    expect(workerIds).toHaveLength(3);
    for (const id of workerIds) expect(prompt).toContain(id);
    // quantity>1 slot is suffixed so the two engineers are distinguishable.
    expect(prompt).toContain('Engineer 1');
    expect(prompt).toContain('Engineer 2');
    expect(prompt).toContain('QA'); // label override used verbatim (quantity 1)
  });

  it('opens an orchestrator-also-a-slot exactly once (not per its slot quantity)', async () => {
    TEAMS = [
      {
        id: 'squad',
        name: 'Squad',
        orchestratorPersonaId: 'builtin:orchestrator',
        slots: [
          { personaId: 'builtin:orchestrator', quantity: 3 }, // only ONE orchestrator opens
          { personaId: 'builtin:reviewer', quantity: 1 }
        ]
      }
    ];
    const res = await launchTeam('squad', 'p1');
    expect(res.ok).toBe(true);
    // 1 reviewer (worker) + 1 orchestrator = 2, NOT 3 orchestrators + 1.
    if (res.ok) expect(res.value.launched).toBe(2);
    const roles = cohorts().map((c) => c?.role);
    expect(roles.filter((r) => r === 'orchestrator')).toHaveLength(1);
  });

  it('a solo orchestrator (no workers) still gets the team prompt verbatim', async () => {
    TEAMS = [
      {
        id: 'solo',
        name: 'Solo',
        orchestratorPersonaId: 'builtin:orchestrator',
        initialPrompt: 'Do it all yourself.',
        slots: [{ personaId: 'builtin:orchestrator', quantity: 1 }]
      }
    ];
    const res = await launchTeam('solo', 'p1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.launched).toBe(1);
    // No workers → no roster appended; the team prompt is passed unchanged
    // (as the trailing positional arg).
    expect(promptOf(createCalls[0])).toBe('Do it all yourself.');
  });

  it('mints a DISTINCT cohortId per launch (per-launch, not per-team)', async () => {
    TEAMS = [
      {
        id: 'squad',
        name: 'Squad',
        slots: [{ personaId: 'builtin:reviewer', quantity: 1 }]
      }
    ];
    const [a, b] = await Promise.all([launchTeam('squad', 'p1'), launchTeam('squad', 'p1')]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.cohortId).not.toBe(b.value.cohortId);
  });

  it('binds structured per-slot tasks and returns host-derived worker identities', async () => {
    TEAMS = [{
      id: 'workers', name: 'Workers', slots: [
        { personaId: 'builtin:software-engineer', label: 'Build' },
        { personaId: 'builtin:reviewer', label: 'Review' }
      ]
    }];
    const res = await launchTeam('workers', 'p1', {
      callerPrincipalId: 'caller-session', launchRequestId: 'request-1',
      slots: [
        { slotId: '0:builtin:software-engineer:0', initialTask: 'implement exact change' },
        { slotId: '1:builtin:reviewer:0', initialTask: 'review exact change' }
      ]
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.workers).toEqual([
      expect.objectContaining({ sessionId: createCalls[0].id, cohortId: res.value.cohortId, slotId: '0:builtin:software-engineer:0', personaId: 'builtin:software-engineer', projectId: 'p1', authorizationId: expect.any(String) }),
      expect.objectContaining({ sessionId: createCalls[1].id, cohortId: res.value.cohortId, slotId: '1:builtin:reviewer:0', personaId: 'builtin:reviewer', projectId: 'p1', authorizationId: expect.any(String) })
    ]);
    expect(promptOf(createCalls[0])).toBe('implement exact change');
    expect(promptOf(createCalls[1])).toBe('review exact change');
  });

  it('rejects structured slots missing host-issued authorization before spawn', async () => {
    TEAMS = [{ id: 'workers-auth', name: 'Workers', slots: [{ personaId: 'builtin:reviewer' }] }];
    const res = await launchTeam('workers-auth', 'p1', {
      callerPrincipalId: 'caller-auth', launchRequestId: 'request-auth-missing',
      slots: [{ slotId: '0:builtin:reviewer:0', initialTask: 'review exact change', authorizationId: '' }],
      requirePreauthorization: true
    });
    expect(res).toMatchObject({ ok: false, code: 'DENIED' });
    expect(createCalls).toHaveLength(0);
  });

  it('durably records each spawned worker before starting the next slot', async () => {
    TEAMS = [{ id: 'workers', name: 'Workers', slots: [
      { personaId: 'builtin:software-engineer' }, { personaId: 'builtin:reviewer' }
    ] }];
    let release!: () => void;
    readyGate = new Promise<void>((resolve) => { release = resolve; });
    const first = launchTeam('workers', 'p1', {
      callerPrincipalId: 'caller-durable', launchRequestId: 'durable-id', slots: [
        { slotId: '0:builtin:software-engineer:0', initialTask: 'build' },
        { slotId: '1:builtin:reviewer:0', initialTask: 'review' }
      ]
    });
    await vi.waitFor(() => expect(createCalls).toHaveLength(1));
    const lifecycle = JSON.parse(readFileSync('/tmp/zcc-launch-team-test/team-lifecycle.json', 'utf8'));
    expect(lifecycle.records[0].workers).toEqual([
      expect.objectContaining({ sessionId: createCalls[0].id, slotId: '0:builtin:software-engineer:0', authorizationId: expect.any(String) })
    ]);
    release();
    await first;
  });

  it('finalizes a lifecycle persistence failure without a later unknown-worker update', async () => {
    TEAMS = [{ id: 'worker', name: 'Worker', slots: [{ personaId: 'builtin:reviewer' }] }];
    failTeamLifecycleWorkerWrite = true;

    const result = await launchTeam('worker', 'p1', {
      callerPrincipalId: 'caller-persist', launchRequestId: 'persist-failure',
      slots: [{ slotId: '0:builtin:reviewer:0', initialTask: 'review exact change' }]
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'TEAM_LAUNCH_FAILED',
      message: expect.stringContaining('lifecycle disk full')
    });
    const lifecycle = JSON.parse(readFileSync('/tmp/zcc-launch-team-test/team-lifecycle.json', 'utf8'));
    expect(lifecycle.records[0]).toMatchObject({
      outcome: { status: 'completed', result: { ok: false, code: 'TEAM_LAUNCH_FAILED' } },
      workers: []
    });
  });

  it('rejects swapped, missing, or extra structured slots before spawn', async () => {
    TEAMS = [{ id: 'workers', name: 'Workers', slots: [
      { personaId: 'builtin:software-engineer' }, { personaId: 'builtin:reviewer' }
    ] }];
    for (const [launchRequestId, slots] of [
      ['swapped', [{ slotId: '1:builtin:reviewer:0', initialTask: 'one' }, { slotId: '0:builtin:software-engineer:0', initialTask: 'two' }]],
      ['missing', [{ slotId: '0:builtin:software-engineer:0', initialTask: 'one' }]],
      ['extra', [{ slotId: '0:builtin:software-engineer:0', initialTask: 'one' }, { slotId: '1:builtin:reviewer:0', initialTask: 'two' }, { slotId: 'extra:0', initialTask: 'three' }]]
    ] as const) {
      const res = await launchTeam('workers', 'p1', { callerPrincipalId: 'caller', launchRequestId, slots: [...slots] });
      expect(res.ok).toBe(false);
    }
    expect(createCalls).toHaveLength(0);
  });

  it('returns failedSlots for unknown personas and spawn failures', async () => {
    TEAMS = [{ id: 'partial', name: 'Partial', slots: [
      { personaId: 'builtin:software-engineer' }, { personaId: 'ghost' }, { personaId: 'builtin:reviewer' }
    ] }];
    const res = await launchTeam('partial', 'p1', {
      callerPrincipalId: 'caller', launchRequestId: 'partial-1', slots: [
        { slotId: '0:builtin:software-engineer:0', initialTask: 'ship' },
        { slotId: '1:ghost:0', initialTask: 'unknown' },
        { slotId: '2:builtin:reviewer:0', initialTask: 'FAIL-SPAWN' }
      ]
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.launched).toBe(1);
      expect(res.value.failedSlots).toEqual([
        expect.objectContaining({ slotId: '1:ghost:0', personaId: 'ghost' }),
        expect.objectContaining({ slotId: '2:builtin:reviewer:0', personaId: 'builtin:reviewer' })
      ]);
    }
  });

  it('does not spawn when the selected adapter cannot bind the initial task at spawn', async () => {
    TEAMS = [{ id: 'unsupported', name: 'Unsupported', slots: [{ personaId: 'builtin:shell-worker' }] }];
    const res = await launchTeam('unsupported', 'p1', {
      callerPrincipalId: 'caller', launchRequestId: 'unsupported-1',
      slots: [{ slotId: '0:builtin:shell-worker:0', initialTask: 'must be bound' }]
    });
    expect(res.ok).toBe(false);
    expect(createCalls).toHaveLength(0);
  });

  it('replays exact structured requests without spawning and rejects changed payload', async () => {
    TEAMS = [{ id: 'solo-worker', name: 'Solo', slots: [{ personaId: 'builtin:reviewer' }] }];
    const input = { callerPrincipalId: 'caller-replay', launchRequestId: 'same-id', slots: [
      { slotId: '0:builtin:reviewer:0', initialTask: 'review one' }
    ] };
    const first = await launchTeam('solo-worker', 'p1', input);
    const replay = await launchTeam('solo-worker', 'p1', input);
    const conflict = await launchTeam('solo-worker', 'p1', {
      ...input, slots: [{ slotId: '0:builtin:reviewer:0', initialTask: 'review two' }]
    });
    expect(first).toEqual(replay);
    expect(createCalls).toHaveLength(1);
    expect(conflict.ok).toBe(false);
  });

  it('replays a completed preauthorized request before checking consumed slot authorizations', async () => {
    TEAMS = [{ id: 'preissued-replay', name: 'Preissued Replay', slots: [{ personaId: 'builtin:reviewer' }] }];
    const authorized = authorizeTeamLaunch(
      'caller-preissued', 'preissued-replay', 'p1', 'preissued-request', {}, [{ initialTask: 'review once' }]
    );
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    const input = {
      callerPrincipalId: 'caller-preissued', launchRequestId: 'preissued-request', requirePreauthorization: true,
      slots: authorized.value.slots.map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }))
    };

    const first = await launchTeam('preissued-replay', 'p1', input);
    const replay = await launchTeam('preissued-replay', 'p1', input);

    expect(first).toEqual(replay);
    expect(first.ok).toBe(true);
    expect(createCalls).toHaveLength(1);
  });

  it('accepts a preauthorized request with the same deadline policy', async () => {
    TEAMS = [{ id: 'deadline-preissued', name: 'Deadline Preissued', slots: [{ personaId: 'builtin:reviewer' }] }];
    const policy = { deadlineMs: 60_000, maxConcurrent: 1, maxLaunches: 1 };
    const authorized = authorizeTeamLaunch(
      'caller-deadline-preissued',
      'deadline-preissued',
      'p1',
      'deadline-preissued-request',
      policy,
      [{ initialTask: 'review once' }]
    );
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;

    const result = await launchTeam('deadline-preissued', 'p1', {
      callerPrincipalId: 'caller-deadline-preissued',
      launchRequestId: 'deadline-preissued-request',
      requirePreauthorization: true,
      policy,
      slots: authorized.value.slots.map(({ slotId, initialTask, authorizationId }) => ({
        slotId,
        initialTask,
        authorizationId
      }))
    });

    expect(result.ok, result.ok ? undefined : result.message).toBe(true);
    if (!result.ok) return;
    expect(result.value.launched).toBe(1);
    expect(createCalls).toHaveLength(1);
  });

  it('replays a completed request with freshly issued equivalent authorizations', async () => {
    TEAMS = [{ id: 'fresh-replay', name: 'Fresh Replay', slots: [{ personaId: 'builtin:reviewer' }] }];
    const firstAuth = authorizeTeamLaunch('caller-fresh', 'fresh-replay', 'p1', 'fresh-request', {}, [{ initialTask: 'review once' }]);
    expect(firstAuth.ok).toBe(true);
    if (!firstAuth.ok) return;
    const request = (slots: typeof firstAuth.value.slots) => ({
      callerPrincipalId: 'caller-fresh', launchRequestId: 'fresh-request', requirePreauthorization: true,
      slots: slots.map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }))
    });
    const first = await launchTeam('fresh-replay', 'p1', request(firstAuth.value.slots));
    const secondAuth = authorizeTeamLaunch('caller-fresh', 'fresh-replay', 'p1', 'fresh-request', {}, [{ initialTask: 'review once' }]);
    expect(secondAuth.ok).toBe(true);
    if (!secondAuth.ok) return;

    const replay = await launchTeam('fresh-replay', 'p1', request(secondAuth.value.slots));

    expect(replay).toEqual(first);
    expect(createCalls).toHaveLength(1);
  });

  it('returns IN_PROGRESS for an exact retry while first launch is unfinished', async () => {
    TEAMS = [{ id: 'solo-worker', name: 'Solo', slots: [{ personaId: 'builtin:reviewer' }] }];
    let release!: () => void;
    readyGate = new Promise<void>((resolve) => { release = resolve; });
    const input = { callerPrincipalId: 'caller-active', launchRequestId: 'active-id', slots: [
      { slotId: '0:builtin:reviewer:0', initialTask: 'review one' }
    ] };
    const first = launchTeam('solo-worker', 'p1', input);
    await vi.waitFor(() => expect(createCalls).toHaveLength(1));
    const retry = await launchTeam('solo-worker', 'p1', input);
    expect(retry).toMatchObject({ ok: false, code: 'IN_PROGRESS' });
    release();
    expect((await first).ok).toBe(true);
  });

  it('closes a spawned session when the Team deadline elapses before readiness', async () => {
    TEAMS = [{ id: 'deadline-worker', name: 'Deadline', slots: [{ personaId: 'builtin:reviewer' }] }];
    readyGate = new Promise<void>(() => {});
    const authorized = authorizeTeamLaunch(
      'caller-deadline', 'deadline-worker', 'p1', 'deadline-request', { deadlineMs: 500 }, [{ initialTask: 'review' }]
    );
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;

    const result = await launchTeam('deadline-worker', 'p1', {
      callerPrincipalId: 'caller-deadline', launchRequestId: 'deadline-request', requirePreauthorization: true,
      policy: { deadlineMs: 500 },
      slots: authorized.value.slots.map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }))
    });

    expect(result).toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED' });
    expect(closeCalls).toEqual([createCalls[0].id]);
  });

  it('replays a no-worker failure as the same error', async () => {
    TEAMS = [{ id: 'missing', name: 'Missing', slots: [{ personaId: 'ghost' }] }];
    const input = { callerPrincipalId: 'caller-failed', launchRequestId: 'failed-id', slots: [
      { slotId: '0:ghost:0', initialTask: 'cannot run' }
    ] };
    const first = await launchTeam('missing', 'p1', input);
    const replay = await launchTeam('missing', 'p1', input);
    expect(first).toEqual(replay);
    expect(replay).toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED' });
  });

  it('uses row and repeat indexes for duplicate persona slot identities and tasks', async () => {
    TEAMS = [{ id: 'duplicates', name: 'Duplicates', slots: [
      { personaId: 'builtin:reviewer' }, { personaId: 'builtin:reviewer' }
    ] }];
    const res = await launchTeam('duplicates', 'p1', {
      callerPrincipalId: 'caller-duplicate', launchRequestId: 'duplicate-id', slots: [
        { slotId: '0:builtin:reviewer:0', initialTask: 'first row' },
        { slotId: '1:builtin:reviewer:0', initialTask: 'second row' }
      ]
    });
    expect(res.ok).toBe(true);
    expect(cohorts().map((cohort) => cohort?.slotId)).toEqual(['0:builtin:reviewer:0', '1:builtin:reviewer:0']);
    expect(createCalls.map((call) => promptOf(call))).toEqual(['first row', 'second row']);
  });

  it('reports invalid slots only within bounded authoritative roster', async () => {
    TEAMS = [{ id: 'invalid-huge', name: 'Invalid Huge', slots: Array.from({ length: 3 }, () => ({
      personaId: 'ghost', quantity: 16
    })) }];
    const slots = Array.from({ length: 32 }, (_, index) => ({
      slotId: `${Math.floor(index / 16)}:ghost:${index % 16}`, initialTask: `task ${index}`
    }));
    const res = await launchTeam('invalid-huge', 'p1', {
      callerPrincipalId: 'caller-cap', launchRequestId: 'cap-id', slots
    });
    expect(res).toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED' });
    if (!res.ok) expect(res.message.split('; ')).toHaveLength(32);
  });
});

describe('cascadeCloseTeamOnOrchestratorExit', () => {
  type S = import('../../shared/types.js').TerminalSession;
  const mk = (
    id: string,
    role: 'orchestrator' | 'worker' | null,
    cohortId = 'c1',
    status: 'running' | 'exited' = 'running'
  ): S =>
    ({
      id,
      status,
      cohort: role ? { cohortId, teamId: 't1', teamName: 'Squad', role } : undefined
    }) as unknown as S;

  const run = (exitedSessionId: string, sessions: S[]) => {
    const closed: string[] = [];
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const result = cascadeCloseTeamOnOrchestratorExit({
      exitedSessionId,
      getSession: (id) => byId.get(id) ?? null,
      listAll: () => sessions,
      close: (id) => {
        closed.push(id);
        return true;
      }
    });
    return { result, closed };
  };

  it('closes every other live member of the cohort when the orchestrator exits', () => {
    const sessions = [
      mk('orch', 'orchestrator'),
      mk('w1', 'worker'),
      mk('w2', 'worker')
    ];
    const { result, closed } = run('orch', sessions);
    expect(closed.sort()).toEqual(['w1', 'w2']);
    expect(result?.closed.sort()).toEqual(['w1', 'w2']);
    expect(result?.teamName).toBe('Squad');
  });

  it('does NOTHING when a worker exits (only the lead tears down the team)', () => {
    const sessions = [mk('orch', 'orchestrator'), mk('w1', 'worker'), mk('w2', 'worker')];
    const { result, closed } = run('w1', sessions);
    expect(closed).toEqual([]);
    expect(result).toBeNull();
  });

  it('never closes the exiting orchestrator itself, and skips already-exited + other cohorts', () => {
    const sessions = [
      mk('orch', 'orchestrator', 'c1'),
      mk('w1', 'worker', 'c1'),
      mk('w2', 'worker', 'c1', 'exited'), // already gone → skipped
      mk('other', 'worker', 'c2'), // different cohort → untouched
      mk('solo', null) // non-team session → untouched
    ];
    const { closed } = run('orch', sessions);
    expect(closed).toEqual(['w1']);
  });

  it('returns null for a non-team session exit', () => {
    const { result, closed } = run('solo', [mk('solo', null)]);
    expect(result).toBeNull();
    expect(closed).toEqual([]);
  });
});
