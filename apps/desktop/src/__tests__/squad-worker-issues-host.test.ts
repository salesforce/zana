import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQUAD_START_REFUSED_PREFIX } from '@zana-ai/zcc-contracts/runtime';
import type {
  SquadMemberControlRequest, SquadMemberDeliveryCompletion, SquadMemberDeliveryRequest, SquadMemberDeliveryResult, SquadMemberRuntimeRequest, SquadMemberStatus, SquadRuntimePreflightRequest,
  SquadRuntimePreflightResult
} from '@zana-ai/zcc-contracts/runtime';
import type { TeamLifecycleRecord } from '@zana-ai/zcc-server/services/launch/team-lifecycle-store';
import { registerThreadProvider } from '@zana-ai/zcc-server/services/threads/thread-provider-catalog';

/**
 * Drives host.ts `authorizeTeamLaunch` / `launchTeam` through their real paths with
 * a faked pty layer and in-memory team/persona stores. Covers native-recovery
 * projection, squad worktree/cohort propagation, preauthorization binding checks,
 * idempotent replay, cold-start cancel, and failure responses.
 */
const h = vi.hoisted(() => {
  const root = (require('node:fs') as typeof import('node:fs')).mkdtempSync(
    require('node:path').join(require('node:os').tmpdir(), 'squad-worker-issues-host-')
  );
  return {
    root,
    projects: [] as any[],
    config: {} as any,
    teams: [] as any[],
    personas: [] as any[],
    creates: [] as any[],
    createImpl: null as null | ((opts: any) => any),
    sessions: new Map<string, any>(),
    dispatchReady: null as null | ((...args: any[]) => any),
    modernMembers: new Map<string, SquadMemberRuntimeRequest>(),
    modernStopped: new Set<string>(),
    closed: [] as string[],
    addWorkerFail: null as null | { slotId: string; message: string },
    reserveOverride: null as null | ((reservation: any) => any),
    afterModernAck: null as null | ((recordId: string, slotId: string, acknowledged: boolean) => Promise<void>),
    squadOpts: undefined as any,
    drainOpts: undefined as any,
    runtime: {
      preflightSquadRuntime: vi.fn<(request: SquadRuntimePreflightRequest) => Promise<SquadRuntimePreflightResult>>(),
      createSquadMember: vi.fn<(request: SquadMemberRuntimeRequest) => Promise<{ threadId: string }>>(),
      activateSquadMember: vi.fn<(request: SquadMemberRuntimeRequest) => Promise<{ threadId: string }>>(),
      getSquadMemberStatus: vi.fn<(request: SquadMemberControlRequest) => Promise<SquadMemberStatus>>(),
      isSquadMemberLive: vi.fn<(threadId: string, projectId: string, generation: number) => Promise<boolean>>(),
      stopSquadMember: vi.fn<(threadId: string, projectId: string, generation: number) => Promise<boolean>>(),
      deliverSquadMember: vi.fn<(request: SquadMemberDeliveryRequest) => Promise<SquadMemberDeliveryResult>>(),
      completeSquadMemberDelivery: vi.fn<(request: SquadMemberDeliveryCompletion) => Promise<SquadMemberDeliveryResult>>(),
      resumeSquadMember: vi.fn<(request: any) => Promise<any>>()
    }
  };
});

vi.stubEnv('ZCC_DATA_DIR', h.root);
vi.stubEnv('ZCC_EXECUTION_STORE', 'json');

vi.mock('@zana-ai/zcc-host-daemon/pty', () => ({
  PtyManager: class {
    setMcpBaseUrl() {}
    setProjectRoots() {}
    setRulesResolver() {}
    create(opts: any) {
      h.creates.push(opts);
      if (h.createImpl) return h.createImpl(opts);
      const session = { id: opts.preallocatedSessionId ?? opts.sessionId ?? `s${h.creates.length}`, status: 'running', projectId: opts.projectId, cohort: opts.cohort };
      h.sessions.set(session.id, session);
      return session;
    }
    getSession(id: string) { return h.sessions.get(id) ?? null; }
    list() { return [...h.sessions.values()]; }
    reply() {}
    setRestoreCapabilityId() {}
    async waitForReady(id: string) { return h.sessions.get(id); }
    on() { return this; }
    closeExpected(id: string) { h.closed.push(id); }
    close(id: string) { h.closed.push(id); return true; }
  },
  isClaudeProfile: (p: string) => p === 'claude'
}));

vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: {
    listProjects: () => h.projects,
    getConfig: () => h.config,
    getProjectSettings: () => ({}),
    createScratchSubfolder: () => '/tmp/scratch',
    ensureRemoteProjectLocalDir: (project: unknown) => project
  },
  scratchWorkspaceRoot: () => '/tmp/scratch-root',
  worktreeRoot: () => '/tmp/zcc-worktrees',
  worktreeTargetDir: (_p: unknown, slug: string) => `/tmp/zcc-worktrees/${slug}`
}));

vi.mock('@zana-ai/zcc-server/services/agents/persona-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/agents/persona-store')>();
  class FakePersonaStore extends actual.PersonaStore {
    list() { return h.personas; }
    start() {}
    stop() {}
    refresh() {}
    rebindProjects() {}
  }
  return { ...actual, PersonaStore: FakePersonaStore };
});

vi.mock('@zana-ai/zcc-server/services/agents/team-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/agents/team-store')>();
  class FakeTeamStore extends actual.TeamStore {
    list() { return h.teams; }
    start() {}
    stop() {}
    refresh() {}
    rebindProjects() {}
  }
  return { ...actual, TeamStore: FakeTeamStore };
});

vi.mock('@zana-ai/zcc-server/services/launch/team-lifecycle-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/launch/team-lifecycle-store')>();
  return {
    ...actual,
    createTeamLifecycleStore: (...args: Parameters<typeof actual.createTeamLifecycleStore>) => {
      const store = actual.createTeamLifecycleStore(...args);
      const acknowledge = store.acknowledgeModernWorker;
      // Test seam: run a hook strictly after main's acknowledge commits and before activation.
      store.acknowledgeModernWorker = async (recordId, slotId, generation, threadId) => {
        const acknowledged = await acknowledge(recordId, slotId, generation, threadId);
        await h.afterModernAck?.(recordId, slotId, acknowledged);
        return acknowledged;
      };
      const addWorker = store.addWorker;
      // Test seam: a rejected lifecycle write for one slot makes the CLI seat launch reject (not return failed).
      store.addWorker = async (...addArgs: Parameters<typeof addWorker>) => {
        if (h.addWorkerFail && (addArgs[1] as { slotId: string }).slotId === h.addWorkerFail.slotId) throw new Error(h.addWorkerFail.message);
        return addWorker(...addArgs);
      };
      const reserve = store.reserveModernWorker;
      // Test seam: let a test reshape the reservation main receives (e.g. a fenced, non-creatable one).
      store.reserveModernWorker = async (...reserveArgs: Parameters<typeof reserve>) => {
        const reservation = await reserve(...reserveArgs);
        return h.reserveOverride ? h.reserveOverride(reservation) : reservation;
      };
      return store;
    }
  };
});

// Capture main's wiring callbacks so the Modern delivery/settlement/status seams run directly.
vi.mock('@zana-ai/zcc-server/services/execution/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/execution/service')>();
  const Wrapped = new Proxy(actual.SquadExecutionService, {
    construct(target, args, newTarget) { h.squadOpts = args[0]; return Reflect.construct(target, args, newTarget); }
  });
  return { ...actual, SquadExecutionService: Wrapped };
});
vi.mock('@zana-ai/zcc-server/services/execution/execution-delivery-drain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/execution/execution-delivery-drain')>();
  const Wrapped = new Proxy(actual.ExecutionDeliveryDrainService, {
    construct(target, args, newTarget) { h.drainOpts = args[0]; return Reflect.construct(target, args, newTarget); }
  });
  return { ...actual, ExecutionDeliveryDrainService: Wrapped };
});

// These suites drive launches, not plugin admission (covered in dispatch-admission tests): admit everything.
vi.mock('../runtime/dispatch-admission.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../runtime/dispatch-admission.js')>()), createMainDispatchAdmission: () => async () => null }));
vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: {
    on: () => {},
    whenReady: () => new Promise(() => {}),
    getPath: () => h.root,
    setName: () => {},
    requestSingleInstanceLock: () => true,
    quit: () => {}
  },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: {}, shell: {}, screen: {},
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({}) },
  powerMonitor: { on: () => {} }
}));
vi.mock('../updater.js', () => ({ createUpdater: () => ({}) }));
vi.mock('../runtime/runtime-supervisor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime/runtime-supervisor.js')>();
  return { ...actual, createProductRouteSquadRuntime: vi.fn(() => h.runtime) };
});
vi.mock('@zana-ai/zcc-host-daemon/mcp-config', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureMcpConfigForProject: () => '/tmp/p1/.mcp.json',
  ensureMcpConfigForProjectSync: () => '/tmp/p1/.mcp.json',
  alwaysOnPluginMcpAllowlist: () => []
}));

const host = await import('../host.js');
const { authorizeTeamLaunch, launchTeam } = host;

const projectDir = realpathSync(mkdtempSync(join(h.root, 'proj-')));
mkdirSync(projectDir, { recursive: true });

const persona = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), baseProfile: 'claude', ...extra });
let seq = 0;
let threadProviderHandles: Array<{ unregister(): void }> = [];

beforeEach(() => {
  threadProviderHandles.forEach(handle => handle.unregister());
  threadProviderHandles = [
    registerThreadProvider('test', { id: 'claude-code', displayName: 'Claude Code',
      capabilities: { supportsServiceTier: false, fork: 'none', supportsThreadArchive: false,
        supportsThreadRename: false, permissionModes: ['accept-edits', 'auto', 'full'], reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max'] }, composerActions: [] }),
    registerThreadProvider('test', { id: 'acp-opencode', displayName: 'OpenCode',
      capabilities: { supportsServiceTier: false, fork: 'none', supportsThreadArchive: false,
        supportsThreadRename: false, permissionModes: ['accept-edits', 'full'], reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max'] }, composerActions: [] })
  ];
  seq += 1;
  h.projects = [{ id: 'p1', name: 'Proj', path: projectDir }];
  h.config = { version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null };
  h.personas = [persona('orch'), persona('w1'), persona('w2')];
  h.teams = [{
    id: 'team1', name: 'Team One', orchestratorPersonaId: 'orch',
    slots: [{ personaId: 'w1', quantity: 2 }, { personaId: 'w2', label: 'Second' }]
  }];
  h.creates.length = 0;
  h.sessions.clear();
  h.createImpl = null;
  h.closed.length = 0;
  h.addWorkerFail = null;
  h.afterModernAck = null;
  h.reserveOverride = null;
});

afterAll(() => {
  threadProviderHandles.forEach(handle => handle.unregister());
  vi.unstubAllEnvs();
  rmSync(h.root, { recursive: true, force: true });
});

const SLOT_IDS = ['0:w1:0', '0:w1:1', '1:w2:0', 'orchestrator:orch'];
let reqSeq = 0;
const reqId = () => `swi-req-${seq}-${(reqSeq += 1)}`;
const structuredReq = (extra: Record<string, unknown> = {}) => ({
  callerPrincipalId: 'owner',
  launchRequestId: reqId(),
  slots: SLOT_IDS.map((slotId) => ({ slotId, initialTask: `task ${slotId}` })),
  ...extra
});

/** Throws on the Nth create (1-based) only, so the other workers still start. */
function throwOnCreate(n: number, message: string) {
  let count = 0;
  h.createImpl = (opts: any) => {
    count += 1;
    if (count === n) throw new Error(message);
    const session = { id: opts.preallocatedSessionId ?? opts.sessionId ?? `s${count}`, status: 'running', projectId: opts.projectId, cohort: opts.cohort };
    h.sessions.set(session.id, session);
    return session;
  };
}

// REQ-6, REQ-7: a worker spawn throw on CLI transport is contained and bounded.
describe('CLI worker spawn throw is contained (REQ-6, REQ-7)', () => {
  it('launches the other workers and lists the failed slot when worker 2 of 3 throws', async () => {
    h.addWorkerFail = { slotId: '0:w1:1', message: 'spawn boom' };
    const result = await launchTeam('team1', 'p1', structuredReq({ coordinationMode: 'structured', jobContext: { objective: 'obj' } }) as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.failedSlots).toHaveLength(1);
    expect(result.value.failedSlots[0]).toMatchObject({ slotId: '0:w1:1' });
    expect(result.value.failedSlots[0].reason).toContain('spawn boom');
    expect(result.value.workerSessionIds.length).toBe(2);
    expect(result.value.orchestratorSessionId).toBeTruthy();
  });

  it('bounds and sanitizes a 5000-character spawn error in failedSlots', async () => {
    h.addWorkerFail = { slotId: '0:w1:1', message: `${'x'.repeat(5000)}\u0000\u001b[31m at /Users/alice/private/spawn.js` };
    const result = await launchTeam('team1', 'p1', structuredReq({ coordinationMode: 'structured', jobContext: { objective: 'obj' } }) as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const failed of result.value.failedSlots) {
      expect(failed.reason.length).toBeLessThanOrEqual(2048);
      expect(failed.reason).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
      expect(failed.reason).not.toContain('/Users/alice');
    }
  });

  it('Q-5: the E2E spawn-fault seam makes the chosen worker spawn throw, and only under an E2E home', async () => {
    vi.stubEnv('ZCC_TEST_THROW_SPAWN_ORDINAL', '2');
    try {
      const plain = await launchTeam('team1', 'p1', structuredReq({ coordinationMode: 'structured', jobContext: { objective: 'obj' } }) as never);
      expect(plain).toMatchObject({ ok: true, value: { failedSlots: [] } });
      vi.stubEnv('ZCC_E2E_HOME', '/tmp/e2e-home');
      const faulted = await launchTeam('team1', 'p1', structuredReq({ coordinationMode: 'structured', jobContext: { objective: 'obj' } }) as never);
      expect(faulted).toMatchObject({ ok: true, value: { failedSlots: [{ slotId: '0:w1:1', reason: expect.stringContaining('injected spawn failure') }] } });
    } finally {
      vi.stubEnv('ZCC_TEST_THROW_SPAWN_ORDINAL', '');
      vi.stubEnv('ZCC_E2E_HOME', '');
    }
  });

  it('keeps a launch with no throw unchanged (existing-user path)', async () => {
    const result = await launchTeam('team1', 'p1', structuredReq({ coordinationMode: 'structured', jobContext: { objective: 'obj' } }) as never);
    expect(result).toMatchObject({ ok: true, value: { failedSlots: [] } });
  });
});

// REQ-8: a throw in the launchTeam tail closes started workers by session id and surfaces the original error.
describe('launchTeam tail throw closes started workers (REQ-8)', () => {
  const FAULT = 'ZCC_TEST_FAIL_LAUNCH_COMPLETE';

  it('closes every started session, leaves none live and rethrows the original error', async () => {
    vi.stubEnv(FAULT, '1');
    vi.stubEnv('ZCC_E2E_HOME', '/tmp/e2e-home');
    try {
      const outcome = await launchTeam('team1', 'p1', structuredReq({ coordinationMode: 'structured', jobContext: { objective: 'obj' } }) as never)
        .then((value) => ({ value }), (error: unknown) => ({ error }));
      const started = h.creates.map((create: any) => create.preallocatedSessionId ?? create.sessionId).filter(Boolean);
      expect('error' in outcome || (outcome.value as { ok: boolean }).ok === false).toBe(true);
      expect(started.length).toBeGreaterThan(0);
      for (const id of [...h.sessions.keys()]) expect(h.closed).toContain(id);
    } finally {
      vi.stubEnv(FAULT, '');
      vi.stubEnv('ZCC_E2E_HOME', '');
    }
  });

  it('A4: ignores the fault outside an E2E home, so a production launch cannot be failed from the environment', async () => {
    vi.stubEnv(FAULT, '1');
    try {
      const result = await launchTeam('team1', 'p1', structuredReq({ coordinationMode: 'structured', jobContext: { objective: 'obj' } }) as never);
      expect(result.ok).toBe(true);
      expect(h.closed).toEqual([]);
    } finally {
      vi.stubEnv(FAULT, '');
    }
  });

  it('does not close anything when the fault is off (existing-user path)', async () => {
    const result = await launchTeam('team1', 'p1', structuredReq({ coordinationMode: 'structured', jobContext: { objective: 'obj' } }) as never);
    expect(result.ok).toBe(true);
    expect(h.closed).toEqual([]);
  });

  it('closes only the sessions of its own launch request', async () => {
    const other = await launchTeam('team1', 'p1', structuredReq({ coordinationMode: 'structured', jobContext: { objective: 'obj' } }) as never);
    expect(other.ok).toBe(true);
    const otherSessions = new Set(h.sessions.keys());
    vi.stubEnv('ZCC_TEST_FAIL_LAUNCH_COMPLETE', '1');
    vi.stubEnv('ZCC_E2E_HOME', '/tmp/e2e-home');
    try {
      await launchTeam('team1', 'p1', structuredReq({ coordinationMode: 'structured', jobContext: { objective: 'obj' } }) as never).catch(() => undefined);
    } finally {
      vi.stubEnv('ZCC_TEST_FAIL_LAUNCH_COMPLETE', '');
      vi.stubEnv('ZCC_E2E_HOME', '');
    }
    for (const id of otherSessions) expect(h.closed).not.toContain(id);
  });
});

// REQ-19: CLI transport launch with unresolved personas.
describe('CLI launch with unresolved personas (REQ-19)', () => {
  it('refuses the launch when every worker slot is unresolved', async () => {
    h.personas = [persona('orch')];
    const result = await launchTeam('team1', 'p1', structuredReq() as never);
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_PERSONA' });
    expect(result.ok ? '' : result.message).toMatch(/^unknown persona: w[12]$/);
    expect(h.creates).toHaveLength(0);
  });

  it('warns and skips only the unresolved slots when some are resolved', async () => {
    h.personas = [persona('orch'), persona('w1')];
    const result = await launchTeam('team1', 'p1', structuredReq() as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.failedSlots).toEqual([expect.objectContaining({ slotId: '1:w2:0', reason: 'unknown persona: w2' })]);
    expect(result.value.workerSessionIds).toHaveLength(2);
  });

  it('launches normally when every persona resolves (existing-user path)', async () => {
    const result = await launchTeam('team1', 'p1', structuredReq() as never);
    expect(result).toMatchObject({ ok: true, value: { failedSlots: [] } });
  });
});

// REQ-4 at the host: the non-window preview branch throws the admission error with the parser's plan error.
describe('resolveSquadComposerPreview non-window plan error (REQ-4, REQ-5)', () => {
  const { resolveSquadComposerPreview } = host;
  const previewInput = (over: Record<string, unknown> = {}) => ({ teamId: 'team1', projectId: 'p1', goal: 'Do the work', coordinationMode: 'structured', ...over }) as never;

  it('throws a SquadPreviewAdmissionError carrying the plan error for a shared-owner caller', async () => {
    const error = await resolveSquadComposerPreview(previewInput(), { kind: 'shared-owner' }).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('SquadPreviewAdmissionError');
    expect((error as Error).message).toBe('no executable steps found');
    expect((error as Error).message).not.toContain(projectDir);
  });

  it('keeps the unavailable-project failure generic (REQ-5)', async () => {
    const error = await resolveSquadComposerPreview(previewInput({ projectId: 'missing' }), { kind: 'shared-owner' }).then(() => undefined, (e: unknown) => e);
    expect((error as Error).message).toBe('TARGET_UNAVAILABLE');
    expect((error as Error).name).not.toBe('SquadPreviewAdmissionError');
  });
});

// QA obligation OBL-014 (REQ-7): unknown-persona reasons must obey the slot bounds.
describe('unknown-persona failed slot reasons are bounded (REQ-7)', () => {
  it('Q-2: sanitizes the reason for an unresolved persona id that holds an absolute path', async () => {
    const badId = `/Users/alice/private/${'p'.repeat(40)}\u0000`;
    h.personas = [persona('orch'), persona('w1')];
    h.teams = [{ id: 'team1', name: 'Team One', orchestratorPersonaId: 'orch', slots: [{ personaId: 'w1', quantity: 1 }, { personaId: badId, quantity: 1 }] }];
    const result = await launchTeam('team1', 'p1', structuredReq({ slots: [{ slotId: '0:w1:0', initialTask: 't' }, { slotId: `1:${badId}:0`, initialTask: 't' }, { slotId: 'orchestrator:orch', initialTask: 't' }] }) as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.failedSlots.length).toBeGreaterThan(0);
    for (const failed of result.value.failedSlots) {
      expect(failed.reason.length).toBeLessThanOrEqual(2048);
      expect(failed.reason).not.toContain('/Users/alice');
      expect(failed.reason).not.toMatch(/\u0000/);
    }
  });
});
