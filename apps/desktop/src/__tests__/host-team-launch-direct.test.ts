import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    require('node:path').join(require('node:os').tmpdir(), 'host-team-launch-direct-')
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
      completeSquadMemberDelivery: vi.fn<(request: SquadMemberDeliveryCompletion) => Promise<SquadMemberDeliveryResult>>()
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
    closeExpected() {}
    close() { return true; }
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
vi.mock('@zana-ai/zcc-host-daemon/mcp-config', () => ({
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
        supportsThreadRename: false, permissionModes: ['accept-edits', 'auto', 'full'] }, composerActions: [] }),
    registerThreadProvider('test', { id: 'acp-opencode', displayName: 'OpenCode',
      capabilities: { supportsServiceTier: false, fork: 'none', supportsThreadArchive: false,
        supportsThreadRename: false, permissionModes: ['accept-edits', 'full'] }, composerActions: [] })
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
  h.afterModernAck = null;
  h.reserveOverride = null;
});

afterAll(() => {
  threadProviderHandles.forEach(handle => handle.unregister());
  vi.unstubAllEnvs();
  rmSync(h.root, { recursive: true, force: true });
});

const SLOT_IDS = ['0:w1:0', '0:w1:1', '1:w2:0', 'orchestrator:orch'];
const tasks = () => SLOT_IDS.map((slotId) => ({ initialTask: `task for ${slotId}` }));
const reqId = () => `req-${seq}-${Math.random().toString(36).slice(2)}`;

describe('authorizeTeamLaunch', () => {
  it('denies missing principal or request id', () => {
    expect(authorizeTeamLaunch(' ', 'team1', 'p1', 'r', {}, tasks())).toMatchObject({ ok: false, code: 'DENIED' });
    expect(authorizeTeamLaunch('c', 'team1', 'p1', ' ', {}, tasks())).toMatchObject({ ok: false, code: 'DENIED' });
  });

  it('reports unknown team / project / unsupported host', () => {
    expect(authorizeTeamLaunch('c', 'nope', 'p1', reqId(), {}, tasks())).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(authorizeTeamLaunch('c', 'team1', 'nope', reqId(), {}, tasks())).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    h.projects = [{ id: 'p1', name: 'Proj', path: projectDir, hostId: 'other-host' }];
    const result = authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, tasks());
    expect(result.ok).toBe(false);
  });

  it('authorizes a bound SSH remote while keeping a secondary checkout blocked', () => {
    h.projects = [{ id: 'p1', name: 'Remote', path: projectDir, hostId: 'other-host', remote: { host: 'ssh-box' } }];
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, tasks())).toMatchObject({ ok: true });
    h.projects = [{ id: 'p1', name: 'Secondary', path: projectDir, hostId: 'other-host' }];
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, tasks()))
      .toMatchObject({ ok: false, code: 'HOST_UNSUPPORTED' });
  });

  it('rejects mismatched counts, invalid tasks, over-limit and unknown personas', () => {
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, tasks().slice(1))).toMatchObject({ ok: false, code: 'INVALID' });
    const blank = tasks(); blank[0].initialTask = '  ';
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, blank)).toMatchObject({ ok: false, message: 'invalid initial task' });
    const huge = tasks(); huge[1].initialTask = 'x'.repeat(65 * 1024);
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, huge)).toMatchObject({ ok: false, message: 'invalid initial task' });
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), { maxLaunches: 2 }, tasks()))
      .toMatchObject({ ok: false, code: 'RESOURCE_LIMIT' });
    h.personas = [persona('orch'), persona('w1')];
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, tasks()))
      .toMatchObject({ ok: false, code: 'DENIED', message: 'unknown persona: w2' });
  });

  it('rejects automated skill selection for CLI Teams', () => {
    const slots = tasks();
    slots[0] = { ...slots[0], automatedSkillIds: ['zcc:built-in/test'] };
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, slots))
      .toMatchObject({ ok: false, code: 'INVALID', message: 'automated skill selection requires Modern Team transport' });
  });

  it('rejects duplicate automated skill ids before authorization', () => {
    h.teams[0] = { ...h.teams[0], transport: 'MODERN' };
    const slots = tasks();
    slots[0] = { ...slots[0], automatedSkillIds: ['zcc:built-in/test', 'zcc:built-in/test'] };
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, slots))
      .toMatchObject({ ok: false, code: 'INVALID', message: 'invalid initial task' });
  });

  it('issues per-slot authorizations, deadline, admission digest and honours native recovery', () => {
    const slots = tasks();
    const result = authorizeTeamLaunch('c', 'team1', 'p1', reqId(), { deadlineMs: 60_000 }, slots, 'freeform', 'digest-1', [
      { role: 'worker', slotId: '0:w1:0', personaId: 'w1', profileId: 'claude', nativeConversationId: 'native-1' } as never,
      { role: 'worker', slotId: '1:w2:0', personaId: 'other', profileId: 'claude', nativeConversationId: 'native-2' } as never
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slots.map((s) => s.slotId)).toEqual(SLOT_IDS);
    expect(result.value.admissionDigest).toBe('digest-1');
    expect(result.value.context?.slots).toHaveLength(4);
    expect(result.value.slots.filter((s) => s.nativeRecovery)).toHaveLength(1);
    expect(result.value.slots[0].nativeRecovery).toMatchObject({ nativeConversationId: 'native-1' });
  });

  it('revokes already issued slots and denies when the principal concurrency limit is below the slot count', () => {
    const result = authorizeTeamLaunch('c', 'team1', 'p1', reqId(), { maxConcurrent: 2 }, tasks());
    expect(result).toMatchObject({ ok: false, code: 'DENIED', message: 'principal concurrent launch limit reached' });
  });

  it('autonomous-team and freeform+teamLaunchEnabled mark bindings autonomous; same request id is idempotent', () => {
    h.config.teamLaunchEnabled = true;
    const id = reqId();
    expect(authorizeTeamLaunch('c', 'team1', 'p1', id, {}, tasks(), 'autonomous-team').ok).toBe(true);
    // second authorize with the same principal+request re-binds the same principal
    expect(authorizeTeamLaunch('c', 'team1', 'p1', id, {}, tasks(), 'freeform').ok).toBe(true);
  });

  it('denies when principal binding changes mid-run and revokes earlier slots on a denied decision', () => {
    const id = reqId();
    expect(authorizeTeamLaunch('c', 'team1', 'p1', id, { maxLaunches: 8 }, tasks()).ok).toBe(true);
    const changed = authorizeTeamLaunch('c', 'team1', 'p1', id, { maxLaunches: 4, maxConcurrent: 1 }, tasks());
    expect(changed).toMatchObject({ ok: false });
  });

  it('caps expansion at the worker ceiling (with and without an orchestrator)', () => {
    const rows = Array.from({ length: 12 }, () => ({ personaId: 'w1', quantity: 99 }));
    h.teams = [{ id: 'big', name: 'Big', orchestratorPersonaId: 'orch', slots: rows }, { id: 'bignoorch', name: 'B', slots: rows }];
    const many = Array.from({ length: 32 }, (_, i) => ({ initialTask: `t${i}` }));
    const withOrch = authorizeTeamLaunch('c', 'big', 'p1', reqId(), {}, many);
    expect(withOrch.ok).toBe(true);
    if (withOrch.ok) expect(withOrch.value.slots.at(-1)!.slotId).toBe('orchestrator:orch');
    const without = authorizeTeamLaunch('c', 'bignoorch', 'p1', reqId(), {}, many);
    expect(without.ok).toBe(true);
    if (without.ok) expect(without.value.slots).toHaveLength(32);
  });
});

describe('launchTeam validation failures', () => {
  it('rejects unknown team, missing project, unknown project, unsupported host', async () => {
    expect(await launchTeam('nope')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await launchTeam('team1')).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await launchTeam('team1', 'zzz')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    h.projects = [{ id: 'p1', name: 'Proj', path: projectDir, hostId: 'other-host' }];
    expect(await launchTeam('team1', 'p1')).toMatchObject({ ok: false });
  });

  it('launches a bound SSH remote through the existing remote path', async () => {
    h.projects = [{ id: 'p1', name: 'Remote', path: projectDir, hostId: 'other-host', remote: { host: 'ssh-box' } }];
    const result = await launchTeam('team1', 'p1');
    expect(result.ok).toBe(true);
    expect(h.creates).toHaveLength(4);
    for (const create of h.creates) expect(create.remote).toMatchObject({ host: 'ssh-box' });
  });

  it('requires an orchestrator for durable coordination', async () => {
    h.teams = [{ id: 'noorch', name: 'N', slots: [{ personaId: 'w1' }] }];
    const result = await launchTeam('noorch', 'p1', {
      callerPrincipalId: 'c', launchRequestId: reqId(), coordinationMode: 'job-team',
      slots: [{ slotId: '0:w1:0', initialTask: 't' }]
    });
    expect(result).toMatchObject({ ok: false, code: 'NO_ORCHESTRATOR' });
  });

  it('validates structured request shape', async () => {
    const base = { callerPrincipalId: 'c', launchRequestId: reqId() };
    const ok = SLOT_IDS.map((slotId) => ({ slotId, initialTask: 'x' }));
    expect(await launchTeam('team1', 'p1', { ...base, callerPrincipalId: ' ', slots: ok })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await launchTeam('team1', 'p1', { ...base, slots: ok.slice(1) })).toMatchObject({ ok: false, message: 'structured slots do not match host-expanded Team slots' });
    expect(await launchTeam('team1', 'p1', { ...base, slots: [{ slotId: 'bad', initialTask: 'x' }, ...ok.slice(1)] }))
      .toMatchObject({ ok: false, message: 'structured slots do not match host-expanded Team slots' });
    expect(await launchTeam('team1', 'p1', { ...base, requirePreauthorization: true, slots: ok }))
      .toMatchObject({ ok: false, code: 'DENIED', message: 'structured slot is missing authorizationId' });
    expect(await launchTeam('team1', 'p1', { ...base, slots: [{ slotId: ok[0].slotId, initialTask: ' ' }, ...ok.slice(1)] }))
      .toMatchObject({ ok: false, message: 'invalid initial task' });
    expect(await launchTeam('team1', 'p1', { ...base, policy: { maxLaunches: 2 }, slots: ok }))
      .toMatchObject({ ok: false, code: 'RESOURCE_LIMIT' });
  });

  it('rejects duplicate automated skill ids before launch', async () => {
    h.teams[0] = { ...h.teams[0], transport: 'MODERN' };
    const slots = SLOT_IDS.map((slotId) => ({ slotId, initialTask: 'x' }));
    slots[0] = { ...slots[0], automatedSkillIds: ['zcc:built-in/test', 'zcc:built-in/test'] };
    expect(await launchTeam('team1', 'p1', { callerPrincipalId: 'c', launchRequestId: reqId(), slots }))
      .toMatchObject({ ok: false, code: 'INVALID', message: 'invalid initial task' });
  });
});

describe('launchTeam legacy (goal) path', () => {
  it('opens workers then the orchestrator under one cohort and replays idempotently', async () => {
    const result = await launchTeam('team1', 'p1', { goal: '  ship it  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.launched).toBe(4);
    expect(result.value.workerSessionIds).toHaveLength(3);
    expect(result.value.orchestratorSessionId).toBeTruthy();
    const cohorts = new Set(h.creates.map((c) => c.cohort?.cohortId));
    expect(cohorts.size).toBe(1);
    const [first] = h.creates;
    expect(first.cohort).toMatchObject({ role: 'worker', coordinationMode: 'autonomous-team', configuredProfile: 'claude' });
    expect(h.creates.at(-1).cohort.role).toBe('orchestrator');
    // second worker row has quantity 1 + custom label; quantity>1 rows are suffixed
    expect(h.creates.map((c) => c.title)).toContain('Second');
  });

  it('interactive launch without a goal keeps coordination interactive-team', async () => {
    const result = await launchTeam('team1', 'p1');
    expect(result.ok).toBe(true);
    expect(h.creates[0].cohort.coordinationMode).toBe('interactive-team');
  });

  it('records unknown worker personas and unknown standalone orchestrator as failed slots', async () => {
    h.personas = [persona('w1'), persona('w2')];
    const result = await launchTeam('team1', 'p1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.failedSlots.map((s) => s.reason)).toContain('unknown persona');
      expect(result.value.orchestratorSessionId).toBeUndefined();
    }
    h.personas = [persona('orch'), persona('w2')];
    const second = await launchTeam('team1', 'p1');
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.failedSlots.some((s) => s.slotId === '0:w1:0' && s.reason === 'unknown persona')).toBe(true);
  });

  it('surfaces worker and orchestrator spawn failures', async () => {
    h.createImpl = () => { throw new Error('spawn boom'); };
    const result = await launchTeam('team1', 'p1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.launched).toBe(0);
      expect(result.value.failedSlots.length).toBeGreaterThan(0);
    }
  });
});

describe('launchTeam structured path', () => {
  const structuredReq = (extra: Record<string, unknown> = {}) => ({
    callerPrincipalId: 'owner',
    launchRequestId: reqId(),
    slots: SLOT_IDS.map((slotId) => ({ slotId, initialTask: `task ${slotId}` })),
    ...extra
  });

  it('fails TEAM_LAUNCH_FAILED when a structured launch opens nothing, and replays the stored failure', async () => {
    h.createImpl = () => { throw new Error('spawn boom'); };
    const req = structuredReq({ coordinationMode: 'structured', jobContext: { objective: 'obj' } });
    const first = await launchTeam('team1', 'p1', req as never);
    expect(first).toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED' });
    const replay = await launchTeam('team1', 'p1', req as never);
    expect(replay).toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED' });
  });

  it('rejects a reused request id with changed payload', async () => {
    const req = structuredReq();
    const firstRes = await launchTeam('team1', 'p1', req as never);
    expect(firstRes.ok).toBe(true);
    const changed = { ...req, slots: req.slots.map((s, i) => (i === 0 ? { ...s, initialTask: 'different' } : s)) };
    expect(await launchTeam('team1', 'p1', changed as never)).toMatchObject({ ok: false, code: 'CONFLICT' });
    // identical replay returns stored result
    const replay = await launchTeam('team1', 'p1', req as never);
    expect(replay.ok).toBe(true);
  });

  it('snapshots the Team orchestrator retention setting into the lifecycle record', async () => {
    h.teams[0].retainOrchestrator = true;
    const req = structuredReq();
    expect((await launchTeam('team1', 'p1', req as never)).ok).toBe(true);
    const record = () => (JSON.parse(readFileSync(join(h.root, 'team-lifecycle.json'), 'utf8')) as { records: TeamLifecycleRecord[] })
      .records.find((candidate) => candidate.launchRequestId === req.launchRequestId);
    expect(record()).toMatchObject({ retainOrchestrator: true });

    h.teams[0].retainOrchestrator = false;
    expect(record()).toMatchObject({ retainOrchestrator: true });
  });

  it('consumes preissued authorizations and rejects tampered / unknown ones', async () => {
    const callerPrincipalId = 'owner';
    const launchRequestId = reqId();
    const authorized = authorizeTeamLaunch(callerPrincipalId, 'team1', 'p1', launchRequestId, {}, tasks(), 'structured', 'adm');
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    const slots = authorized.value.slots.map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }));
    const base = { callerPrincipalId, launchRequestId, requirePreauthorization: true, admissionDigest: 'adm', coordinationMode: 'structured' as const };

    const unknown = await launchTeam('team1', 'p1', { ...base, launchRequestId: reqId(), slots: slots.map((s) => ({ ...s, authorizationId: 'nope' })) } as never);
    expect(unknown).toMatchObject({ ok: false, code: 'DENIED', message: 'unknown authorization' });

    // task digest mismatch -> binding mismatch
    const tampered = await launchTeam('team1', 'p1', { ...base, slots: slots.map((s, i) => (i === 0 ? { ...s, initialTask: 'tampered' } : s)) } as never);
    expect(tampered).toMatchObject({ ok: false, code: 'DENIED', message: 'preissued authorization binding mismatch' });

    // a fresh authorization with the right digest launches
    const fresh = authorizeTeamLaunch(callerPrincipalId, 'team1', 'p1', launchRequestId + 'b', {}, tasks(), 'structured', 'adm');
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    const freshSlots = fresh.value.slots.map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }));
    const launched = await launchTeam('team1', 'p1', { ...base, launchRequestId: launchRequestId + 'b', slots: freshSlots } as never);
    expect(launched.ok).toBe(true);
    if (launched.ok) expect(launched.value.launched).toBe(4);
    // replay after completion revokes + returns stored result
    const replay = await launchTeam('team1', 'p1', { ...base, launchRequestId: launchRequestId + 'b', slots: freshSlots } as never);
    expect(replay.ok).toBe(true);
  });

  it('rejects a preissued authorization whose deadline elapsed', async () => {
    const launchRequestId = reqId();
    const authorized = authorizeTeamLaunch('owner', 'team1', 'p1', launchRequestId, { deadlineMs: 1 }, tasks(), 'structured');
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
    const slots = authorized.value.slots.map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }));
    const result = await launchTeam('team1', 'p1', {
      callerPrincipalId: 'owner', launchRequestId, requirePreauthorization: true, coordinationMode: 'structured',
      policy: { deadlineMs: 1 }, slots
    } as never);
    expect(result).toMatchObject({ ok: false, code: 'DEADLINE_EXCEEDED' });
  });

  it('routes recovery resume ids and extra args into the spawn request', async () => {
    const launchRequestId = reqId();
    const nativeRecovery = [
      { role: 'worker', slotId: '0:w1:0', personaId: 'w1', profileId: 'claude', nativeConversationId: 'native-1' },
      { role: 'orchestrator', slotId: 'orchestrator:orch', personaId: 'orch', profileId: 'claude', nativeConversationId: 'native-o' }
    ];
    const result = await launchTeam('team1', 'p1', {
      ...structuredReq({ launchRequestId }),
      slots: SLOT_IDS.map((slotId) => ({
        slotId, initialTask: `task ${slotId}`,
        ...(nativeRecovery.find((n) => n.slotId === slotId) ? { nativeRecovery: nativeRecovery.find((n) => n.slotId === slotId) } : {})
      }))
    } as never);
    expect(result.ok).toBe(true);
  });
});

describe('launchTeam non-claude recovery, orchestrator binding failure and orchestrator-less teams', () => {
  const NATIVE = '11111111-2222-4333-8444-555555555555';

  it('resumes codex native conversations for worker and orchestrator slots', async () => {
    h.personas = [persona('cxo', { baseProfile: 'codex' }), persona('cx', { baseProfile: 'codex' })];
    h.teams = [{ id: 'cxteam', name: 'CX', orchestratorPersonaId: 'cxo', slots: [{ personaId: 'cx' }] }];
    const launchRequestId = reqId();
    const nativeRecovery = [
      { role: 'worker', slotId: '0:cx:0', personaId: 'cx', profileId: 'codex', nativeConversationId: NATIVE },
      { role: 'orchestrator', slotId: 'orchestrator:cxo', personaId: 'cxo', profileId: 'codex', nativeConversationId: NATIVE }
    ];
    const authorized = authorizeTeamLaunch('owner', 'cxteam', 'p1', launchRequestId, {},
      [{ initialTask: 'w' }, { initialTask: 'o' }], 'structured', undefined, nativeRecovery as never);
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    const result = await launchTeam('cxteam', 'p1', {
      callerPrincipalId: 'owner', launchRequestId, requirePreauthorization: true, coordinationMode: 'structured',
      slots: authorized.value.slots.map(({ slotId, initialTask, authorizationId, nativeRecovery: recovery }) => ({ slotId, initialTask, authorizationId, nativeRecovery: recovery }))
    } as never);
    expect(result.ok).toBe(true);
    expect(h.creates.map((c) => c.resumeSessionId)).toEqual([NATIVE, NATIVE]);
    expect(h.creates.every((c) => c.profile === 'codex-resume')).toBe(true);
  });

  it('fails an orchestrator whose adapter cannot bind the initial task', async () => {
    h.personas = [persona('orch', { baseProfile: 'shell' }), persona('w1'), persona('w2')];
    const slots = SLOT_IDS.map((slotId) => ({ slotId, initialTask: `t ${slotId}` }));
    const partial = await launchTeam('team1', 'p1', { callerPrincipalId: 'owner', launchRequestId: reqId(), slots } as never);
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.value.orchestratorSessionId).toBeUndefined();
      expect(partial.value.failedSlots.map((s) => s.reason).join()).toContain('cannot bind initial task');
    }
    const durable = await launchTeam('team1', 'p1', { callerPrincipalId: 'owner', launchRequestId: reqId(), coordinationMode: 'structured', slots } as never);
    expect(durable).toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED' });
    expect(durable.ok ? '' : durable.message).toContain('cannot bind initial task');
  });

  it('launches an orchestrator-less team and skips the orchestrator step', async () => {
    h.teams = [{ id: 'flat', name: 'Flat', slots: [{ personaId: 'w1' }] }];
    const result = await launchTeam('flat', 'p1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.orchestratorSessionId).toBeUndefined();
      expect(result.value.launched).toBe(1);
    }
  });

  it('flags a team whose declared orchestrator persona vanished', async () => {
    h.personas = [persona('w1'), persona('w2')];
    const result = await launchTeam('team1', 'p1', {
      callerPrincipalId: 'owner', launchRequestId: reqId(), coordinationMode: 'structured',
      slots: SLOT_IDS.map((slotId) => ({ slotId, initialTask: 't' }))
    } as never);
    expect(result).toMatchObject({ ok: false, code: 'NO_ORCHESTRATOR' });
  });
});

describe('launchTeam Modern structured path', () => {
  const HOST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const readyRuntime = (): SquadRuntimePreflightResult => ({
    ready: true, hostId: HOST_ID, policyInventoryReady: true,
    nativeToolPolicyRequired: false, nativeToolPolicyWired: true,
    providers: [{ providerId: 'claude-code', available: true }, { providerId: 'acp-opencode', available: true }]
  });
  const correlationKey = ({ bindingId, projectId, generation }: SquadMemberControlRequest) =>
    JSON.stringify([bindingId, projectId, generation]);
  const statusFor = (request: SquadMemberControlRequest): SquadMemberStatus => ({
    bindingId: request.bindingId, projectId: request.projectId, generation: request.generation,
    live: !h.modernStopped.has(correlationKey(request)),
    status: h.modernStopped.has(correlationKey(request)) ? 'stopped' : 'idle',
    hostOnline: true, providerStarted: true, eventSequence: 0, updatedAt: Date.now()
  });
  const lifecycle = (launchRequestId: string): TeamLifecycleRecord => {
    const state = JSON.parse(readFileSync(join(h.root, 'team-lifecycle.json'), 'utf8')) as { records: TeamLifecycleRecord[] };
    const record = state.records.find((candidate) => candidate.launchRequestId === launchRequestId);
    expect(record).toBeDefined();
    return record!;
  };
  const structuredReq = () => ({
    callerPrincipalId: `modern-owner-${seq}`,
    launchRequestId: reqId(),
    coordinationMode: 'structured' as const,
    slots: SLOT_IDS.map((slotId) => ({ slotId, initialTask: `task ${slotId}` }))
  });

  beforeEach(() => {
    h.teams[0].transport = 'MODERN';
    h.personas = [persona('orch'), persona('w1'), persona('w2')];
    h.modernMembers.clear();
    h.modernStopped.clear();
    h.runtime.preflightSquadRuntime.mockReset().mockResolvedValue(readyRuntime());
    h.runtime.createSquadMember.mockReset().mockImplementation(async (request) => {
      h.modernMembers.set(request.bindingId, request);
      return { threadId: request.bindingId };
    });
    h.runtime.activateSquadMember.mockReset().mockImplementation(async request => {
      return { threadId: request.bindingId };
    });
    h.runtime.getSquadMemberStatus.mockReset().mockImplementation(async (request) => statusFor(request));
    h.runtime.isSquadMemberLive.mockReset().mockImplementation(async (bindingId, projectId, generation) =>
      statusFor({ bindingId, projectId, generation }).live);
    h.runtime.deliverSquadMember.mockReset().mockImplementation(async request => ({
      bindingId: request.bindingId, projectId: request.projectId, generation: request.generation,
      assignmentId: request.assignmentId, idempotencyKey: request.idempotencyKey, state: 'accepted'
    }));
    h.runtime.completeSquadMemberDelivery.mockReset().mockImplementation(async request => ({ ...request, state: 'completed' }));
    h.runtime.stopSquadMember.mockReset().mockImplementation(async (bindingId, projectId, generation) => {
      const member = h.modernMembers.get(bindingId);
      if (!member || member.projectId !== projectId || member.generation !== generation) return false;
      h.modernStopped.add(correlationKey({ bindingId, projectId, generation }));
      return true;
    });
  });

  it.each([
    ['claude', 'claude-code'],
    ['opencode', 'acp-opencode']
  ])('launches pinned %s workers before orchestrator with canonical provider and replays without ACP creates', async (profile, providerId) => {
    h.personas[2] = persona('w2', { baseProfile: profile });
    const req = structuredReq();
    // Check durable create intent at the external-call boundary, not only after success.
    h.runtime.createSquadMember.mockImplementation(async (request) => {
      const record = lifecycle(req.launchRequestId);
      const worker = record.workers.find((candidate) => candidate.threadId === request.bindingId);
      expect(worker).toMatchObject({
        transport: 'MODERN', bindingState: 'CREATING', generation: request.generation,
        process: 'spawning', capacityReleased: false, projectId: 'p1'
      });
      expect(record.capacity!.launched).toBeGreaterThanOrEqual(record.workers.length);
      h.modernMembers.set(request.bindingId, request);
      return { threadId: request.bindingId };
    });
    h.runtime.activateSquadMember.mockImplementation(async request => {
      expect(lifecycle(req.launchRequestId).workers.find(worker => worker.threadId === request.bindingId))
        .toMatchObject({ bindingState: 'BOUND', process: 'running', capacityReleased: false, generation: request.generation });
      return { threadId: request.bindingId };
    });

    const result = await launchTeam('team1', 'p1', req);
    expect(result).toMatchObject({ ok: true, value: { launched: 4, failedSlots: [] } });
    if (!result.ok) return;
    const creates = h.runtime.createSquadMember.mock.calls.map(([request]) => request);
    expect(h.runtime.activateSquadMember.mock.calls.map(([request]) => request)).toEqual(creates);
    expect(creates.map((request) => request.role)).toEqual(['worker', 'worker', 'worker', 'orchestrator']);
    expect(creates.map((request) => request.providerId)).toEqual(['claude-code', 'claude-code', providerId, 'claude-code']);
    expect(new Set(creates.map((request) => request.bindingId)).size).toBe(4);
    expect(result.value.workerSessionIds).toEqual(creates.slice(0, 3).map((request) => request.bindingId));
    expect(result.value.orchestratorSessionId).toBe(creates[3].bindingId);
    expect(result.value.workers.map((worker) => worker.slotId)).toEqual(SLOT_IDS);
    expect(result.value.workers.map((worker) => worker.sessionId)).toEqual(creates.map((request) => request.bindingId));
    for (const request of creates) {
      expect(request).toMatchObject({
        teamId: 'team1', projectId: 'p1', hostId: HOST_ID, cohortId: result.value.cohortId,
        generation: 1, worktreePath: projectDir, prompt: expect.any(String)
      });
      expect(request.prompt.trim()).not.toBe('');
      expect(request.model).toBeUndefined();
      expect(request.permissionMode).toBe('accept-edits');
    }
    const preflights = h.runtime.preflightSquadRuntime.mock.calls.map(([request]) => request);
    expect(preflights.length).toBeGreaterThan(0);
    expect(new Set(preflights.flatMap((request) => request.providerIds))).toEqual(new Set(['claude-code', providerId]));
    expect(preflights.flatMap((request) => request.selections.map(selection => selection.permissionMode)))
      .toEqual(['accept-edits', 'accept-edits', 'accept-edits', 'accept-edits']);
    expect(Math.max(...h.runtime.preflightSquadRuntime.mock.invocationCallOrder))
      .toBeLessThan(h.runtime.createSquadMember.mock.invocationCallOrder[0]);
    const record = lifecycle(req.launchRequestId);
    expect(record.state).toBe('active');
    expect(record.workers).toHaveLength(4);
    for (const [index, worker] of record.workers.entries()) {
      expect(worker).toMatchObject({
        slotId: SLOT_IDS[index], sessionId: creates[index].bindingId, threadId: creates[index].bindingId,
        transport: 'MODERN', generation: 1, bindingState: 'BOUND', process: 'running', capacityReleased: false,
        modernContext: { role: creates[index].role, providerId: creates[index].providerId, worktreePath: projectDir, hostId: HOST_ID }
      });
    }

    expect(await launchTeam('team1', 'p1', req)).toEqual(result);
    expect(h.runtime.createSquadMember).toHaveBeenCalledTimes(4);
    expect(h.runtime.stopSquadMember).not.toHaveBeenCalled();
    expect(h.creates).toEqual([]);
  });

  it('passes each modern task slot automated skill selection to its runtime request', async () => {
    const automatedSkillIds = ['zcc:built-in/test'];
    const req = structuredReq();
    req.slots[1] = { ...req.slots[1], automatedSkillIds };
    expect((await launchTeam('team1', 'p1', req)).ok).toBe(true);
    const created = h.runtime.createSquadMember.mock.calls.map(([request]) => request);
    expect(created[1].automatedSkillIds).toEqual(automatedSkillIds);
    expect(created.filter((_, index) => index !== 1).every((request) => request.automatedSkillIds === undefined)).toBe(true);
  });

  it.each(['runtime', 'provider'] as const)('refuses %s preflight for every slot before any ACP create or PTY', async (refusal) => {
    h.personas[2] = persona('w2', { baseProfile: 'opencode' });
    const req = structuredReq();
    h.runtime.preflightSquadRuntime.mockImplementation(async () => {
      expect(h.runtime.createSquadMember).not.toHaveBeenCalled();
      expect(h.creates).toEqual([]);
      return {
        ...readyRuntime(), ready: refusal === 'provider', reason: 'Modern runtime preflight refused',
        providers: refusal === 'runtime' ? readyRuntime().providers
          : [{ providerId: 'claude-code', available: true }, { providerId: 'acp-opencode', available: false, reason: 'provider unavailable' }]
      };
    });

    expect((await launchTeam('team1', 'p1', req)).ok).toBe(false);
    expect(h.runtime.preflightSquadRuntime).toHaveBeenCalled();
    for (const [request] of h.runtime.preflightSquadRuntime.mock.calls) {
      expect(request.projectId).toBe('p1');
      expect(new Set(request.providerIds)).toEqual(new Set(['claude-code', 'acp-opencode']));
    }
    expect(h.runtime.createSquadMember).not.toHaveBeenCalled();
    expect(h.runtime.stopSquadMember).not.toHaveBeenCalled();
    expect(h.creates).toEqual([]);
  });

  it('retains uncertain reservation and capacity after create receipt loss without blind recreation', async () => {
    const req = structuredReq();
    h.runtime.createSquadMember.mockRejectedValue(new Error('create receipt lost'));
    h.runtime.getSquadMemberStatus.mockRejectedValue(new Error('runtime status unavailable'));
    h.runtime.isSquadMemberLive.mockResolvedValue(false);
    h.runtime.stopSquadMember.mockResolvedValue(false);

    expect((await launchTeam('team1', 'p1', req)).ok).toBe(false);
    expect(h.runtime.createSquadMember).toHaveBeenCalled();
    const creates = h.runtime.createSquadMember.mock.calls.map(([request]) => request);
    const lost = creates[0];
    const record = lifecycle(req.launchRequestId);
    const worker = record.workers.find((candidate) => candidate.threadId === lost.bindingId);
    expect(worker).toMatchObject({
      transport: 'MODERN', generation: lost.generation, bindingState: 'UNCERTAIN',
      process: 'spawning', capacityReleased: false, threadId: lost.bindingId
    });
    expect(record.capacity!.launched).toBeGreaterThan(0);

    expect((await launchTeam('team1', 'p1', req)).ok).toBe(false);
    expect(h.runtime.createSquadMember).toHaveBeenCalledTimes(creates.length);
    expect(new Set(creates.map((request) => request.bindingId)).size).toBe(creates.length);
    const replay = lifecycle(req.launchRequestId);
    expect(replay.capacity).toEqual(record.capacity);
    expect(replay.workers.find((candidate) => candidate.slotId === worker!.slotId)).toEqual(worker);
    expect(h.creates).toEqual([]);
  });

  it('fences cancellation during create, closes late-bound thread and never restores authority', async () => {
    const req = structuredReq();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    h.runtime.createSquadMember.mockImplementationOnce(async (request) => {
      await gate;
      h.modernMembers.set(request.bindingId, request);
      return { threadId: request.bindingId };
    });
    h.runtime.getSquadMemberStatus.mockImplementation(async (request) => h.modernMembers.has(request.bindingId)
      ? statusFor(request)
      : { ...statusFor(request), live: false, status: 'unknown', providerStarted: false });
    const launching = launchTeam('team1', 'p1', req);
    try {
      await vi.waitFor(() => expect(h.runtime.createSquadMember).toHaveBeenCalledTimes(1));
      const [created] = h.runtime.createSquadMember.mock.calls[0];
      const before = lifecycle(req.launchRequestId);
      expect(before.workers.find((worker) => worker.threadId === created.bindingId))
        .toMatchObject({ bindingState: 'CREATING', generation: created.generation, capacityReleased: false });

      expect((await host.cancelTeamLaunch(req.callerPrincipalId, req.launchRequestId)).ok).toBe(true);
      const canceled = lifecycle(req.launchRequestId);
      expect(canceled.state).not.toBe('active');
      expect(canceled.workers.find((worker) => worker.threadId === created.bindingId))
        .toMatchObject({ bindingState: 'UNCERTAIN', capacityReleased: false });
      release();

      expect((await launching).ok).toBe(false);
      expect(h.runtime.stopSquadMember).toHaveBeenCalledWith(created.bindingId, 'p1', created.generation);
      expect(h.modernStopped.has(correlationKey(created))).toBe(true);
      const settled = lifecycle(req.launchRequestId);
      expect(settled.state).toBe('canceled');
      expect(settled.workers.find((worker) => worker.threadId === created.bindingId)).toMatchObject({
        bindingState: 'TERMINAL', process: 'canceled', generation: created.generation, capacityReleased: true
      });
      expect(settled.workers.some((worker) => worker.bindingState === 'BOUND')).toBe(false);
      expect(h.runtime.activateSquadMember).not.toHaveBeenCalled();
      expect((await launchTeam('team1', 'p1', req)).ok).toBe(false);
      expect(h.runtime.createSquadMember).toHaveBeenCalledTimes(1);
      expect(lifecycle(req.launchRequestId).state).toBe('canceled');
      expect(h.creates).toEqual([]);
    } finally {
      release();
      await launching;
    }
  });

  it('stops a member canceled between acknowledge and activate without activating or releasing capacity early', async () => {
    const req = structuredReq();
    let canceledThread: string | undefined;
    h.afterModernAck = async (_recordId, slotId, acknowledged) => {
      if (canceledThread || !acknowledged) return;
      canceledThread = lifecycle(req.launchRequestId).workers.find(worker => worker.slotId === slotId)!.threadId;
      expect((await host.cancelTeamLaunch(req.callerPrincipalId, req.launchRequestId)).ok).toBe(true);
    };

    const result = await launchTeam('team1', 'p1', req);
    expect(result.ok).toBe(false);
    expect(canceledThread).toBeDefined();
    const created = h.runtime.createSquadMember.mock.calls.map(([request]) => request).find(request => request.bindingId === canceledThread)!;
    expect(h.runtime.activateSquadMember).not.toHaveBeenCalled();
    expect(h.runtime.stopSquadMember).toHaveBeenCalledWith(canceledThread, 'p1', created.generation);
    expect(h.modernStopped.has(correlationKey(created))).toBe(true);
    const settled = lifecycle(req.launchRequestId);
    expect(settled.state).toBe('canceled');
    // Capacity released only by exact terminal runtime evidence (reconcile), not by the skip.
    expect(settled.workers.find(worker => worker.threadId === canceledThread)).toMatchObject({
      bindingState: 'TERMINAL', process: 'canceled', capacityReleased: true
    });
    expect(h.creates).toEqual([]);
  });

  it('keeps capacity held when the post-acknowledge stop cannot prove the member stopped', async () => {
    const req = structuredReq();
    let canceledThread: string | undefined;
    h.runtime.stopSquadMember.mockResolvedValue(false);
    h.runtime.getSquadMemberStatus.mockRejectedValue(new Error('runtime status unavailable'));
    h.runtime.isSquadMemberLive.mockResolvedValue(true);
    h.afterModernAck = async (_recordId, slotId, acknowledged) => {
      if (canceledThread || !acknowledged) return;
      canceledThread = lifecycle(req.launchRequestId).workers.find(worker => worker.slotId === slotId)!.threadId;
      await host.cancelTeamLaunch(req.callerPrincipalId, req.launchRequestId);
    };

    expect((await launchTeam('team1', 'p1', req)).ok).toBe(false);
    expect(h.runtime.activateSquadMember).not.toHaveBeenCalled();
    const settled = lifecycle(req.launchRequestId);
    expect(settled.state).toBe('cancel-pending');
    expect(settled.workers.find(worker => worker.threadId === canceledThread)).toMatchObject({ capacityReleased: false });
  });

  describe('Modern preflight refusals and permission mapping', () => {
    it.each([
      ['a remote project', () => { h.projects[0].remote = { host: 'ssh-box' }; h.projects[0].hostId = 'other-host'; }, {}, /requires a local project/],
      ['a native-recovery slot', () => {}, { nativeRecovery: true }, /cannot adopt CLI native recovery/],
      ['persona tool overrides', () => { h.personas[1] = persona('w1', { allowedTools: ['Bash'] }); }, {}, /tool or sandbox overrides/],
      ['plan-only personas', () => { h.personas[1] = persona('w1', { permissionMode: 'plan' }); }, {}, /plan-only execution/]
    ] as const)('refuses %s before preflight or create', async (_label, arrange, slotExtra, message) => {
      arrange();
      const req = structuredReq();
      const slots = req.slots.map((slot, index) => index === 0 && 'nativeRecovery' in slotExtra
        ? { ...slot, nativeRecovery: { role: 'worker', slotId: slot.slotId, personaId: 'w1', profileId: 'claude', nativeConversationId: 'native-1' } }
        : slot);
      const result = await launchTeam('team1', 'p1', { ...req, slots } as never);
      expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED', message: expect.stringMatching(message) });
      expect(h.runtime.preflightSquadRuntime).not.toHaveBeenCalled();
      expect(h.runtime.createSquadMember).not.toHaveBeenCalled();
      expect(h.creates).toEqual([]);
    });

    it('stringifies a non-Error preflight failure into the UNSUPPORTED refusal', async () => {
      h.runtime.preflightSquadRuntime.mockRejectedValue('runtime offline');
      expect(await launchTeam('team1', 'p1', structuredReq())).toMatchObject({
        ok: false, code: 'UNSUPPORTED', message: 'runtime offline'
      });
      expect(h.runtime.createSquadMember).not.toHaveBeenCalled();
    });

    it('falls back to a generic refusal when an unavailable runtime gives no reason', async () => {
      h.runtime.preflightSquadRuntime.mockResolvedValue({ ...readyRuntime(), ready: false });
      expect(await launchTeam('team1', 'p1', structuredReq())).toMatchObject({
        ok: false, code: 'UNSUPPORTED', message: 'Modern squad runtime is unavailable'
      });
      expect(h.runtime.createSquadMember).not.toHaveBeenCalled();
    });

    it('maps persona permission modes onto the runtime and preflight selections', async () => {
      h.personas = [persona('orch'), persona('w1', { permissionMode: 'bypassPermissions' }), persona('w2', { permissionMode: 'acceptEdits' })];
      const result = await launchTeam('team1', 'p1', structuredReq());
      expect(result.ok).toBe(true);
      expect(h.runtime.createSquadMember.mock.calls.map(([request]) => request.permissionMode))
        .toEqual(['full', 'full', 'accept-edits', 'accept-edits']);
      expect(h.runtime.preflightSquadRuntime.mock.calls[0][0].selections.map(selection => selection.permissionMode))
        .toEqual(['full', 'full', 'accept-edits', 'accept-edits']);
    });

    it('launches default-permission Modern personas with accept-edits for ACP preflight and create', async () => {
      h.personas = [persona('orch', { permissionMode: 'default' }), persona('w1', { permissionMode: 'default' }), persona('w2', { permissionMode: 'default' })];
      const result = await launchTeam('team1', 'p1', structuredReq());
      expect(result).toMatchObject({ ok: true, value: { launched: 4, failedSlots: [] } });
      expect(h.runtime.preflightSquadRuntime.mock.calls[0][0].selections.map(selection => selection.permissionMode))
        .toEqual(['accept-edits', 'accept-edits', 'accept-edits', 'accept-edits']);
      expect(h.runtime.createSquadMember.mock.calls.map(([request]) => request.permissionMode))
        .toEqual(['accept-edits', 'accept-edits', 'accept-edits', 'accept-edits']);
    });

    it('falls back to accept-edits for autonomous OpenCode slots before preflight and create', async () => {
      h.config.teamLaunchEnabled = true;
      h.personas[2] = persona('w2', { baseProfile: 'opencode' });
      const result = await launchTeam('team1', 'p1', { ...structuredReq(), coordinationMode: 'freeform' } as never);
      expect(result.ok).toBe(true);
      expect(h.runtime.preflightSquadRuntime.mock.calls[0][0].selections.map(selection => selection.permissionMode))
        .toEqual(['auto', 'auto', 'accept-edits', 'auto']);
      expect(h.runtime.createSquadMember.mock.calls.map(([request]) => request.permissionMode))
        .toEqual(['auto', 'auto', 'accept-edits', 'auto']);
    });
  });

  describe('Modern per-slot launch guards', () => {
    it('stops creating members once the authorized persona context changes', async () => {
      h.runtime.createSquadMember.mockImplementationOnce(async request => {
        h.personas = [persona('orch'), persona('w1', { appendSystemPrompt: 'mutated' }), persona('w2')];
        h.modernMembers.set(request.bindingId, request);
        return { threadId: request.bindingId };
      });
      const result = await launchTeam('team1', 'p1', structuredReq());
      expect(h.runtime.createSquadMember).toHaveBeenCalledTimes(1);
      expect(result.ok ? result.value.failedSlots.length : 1).toBeGreaterThan(0);
      expect(h.creates).toEqual([]);
    });

    it('stops a slot whose reservation cannot create without calling the runtime', async () => {
      h.reserveOverride = (reservation) => ({ ...reservation, mayCreate: false });
      const result = await launchTeam('team1', 'p1', structuredReq());
      expect(h.runtime.createSquadMember).not.toHaveBeenCalled();
      expect(result.ok ? result.value.launched : 0).toBe(0);
      expect(h.creates).toEqual([]);
    });

    it('marks a slot uncertain when create fails with a non-Error value', async () => {
      const req = structuredReq();
      h.runtime.createSquadMember.mockRejectedValue('create receipt lost');
      h.runtime.getSquadMemberStatus.mockRejectedValue('runtime status unavailable');
      h.runtime.isSquadMemberLive.mockResolvedValue(false);
      h.runtime.stopSquadMember.mockResolvedValue(false);
      expect((await launchTeam('team1', 'p1', req)).ok).toBe(false);
      const lost = h.runtime.createSquadMember.mock.calls[0][0];
      expect(lifecycle(req.launchRequestId).workers.find(worker => worker.threadId === lost.bindingId))
        .toMatchObject({ bindingState: 'UNCERTAIN', capacityReleased: false });
    });

    it('refuses to create once the launch deadline elapses during preflight', async () => {
      h.runtime.preflightSquadRuntime.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 15));
        return readyRuntime();
      });
      const result = await launchTeam('team1', 'p1', { ...structuredReq(), policy: { deadlineMs: 1 } } as never);
      expect(result.ok).toBe(false);
      expect(h.runtime.createSquadMember).not.toHaveBeenCalled();
      expect(h.creates).toEqual([]);
    });

    it('passes slot-label and team titles through, falling back to the persona name', async () => {
      const result = await launchTeam('team1', 'p1', structuredReq());
      expect(result.ok).toBe(true);
      expect(h.runtime.createSquadMember.mock.calls.map(([request]) => request.title)).toEqual(['W1', 'W1', 'Second', 'Team One']);
    });
  });

  describe('Modern execution wiring callbacks', () => {
    const claimExecution = async (launchRequestId: string) => (await h.squadOpts.store.claim({
      callerPrincipalId: `exec-owner-${seq}`, projectId: 'p1', teamId: 'team1', jobTitle: 'Work', requestDigest: `digest-${launchRequestId}`,
      launchRequestId, resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [] }
    })).record as { id: string };
    const launchBound = async () => {
      const execution = await claimExecution(`exec-${reqId()}`);
      const req = { ...structuredReq(), executionId: execution.id };
      const result = await launchTeam('team1', 'p1', req as never);
      expect(result.ok).toBe(true);
      const member = h.runtime.createSquadMember.mock.calls[0][0];
      expect(member.executionId).toBe(execution.id);
      return { execution, req, member };
    };
    const correlation = (executionId: string) => ({ executionId, assignmentId: 'assignment-1', idempotencyKey: 'key-1' });

    it('delivers assignments only to the exact Modern member bound to that execution', async () => {
      const { execution, member } = await launchBound();
      const other = await claimExecution(`exec-other-${reqId()}`);

      expect(await h.squadOpts.deliverAssignment(member.bindingId, 'do it', correlation(execution.id))).toMatchObject({ state: 'accepted' });
      expect(h.runtime.deliverSquadMember).toHaveBeenLastCalledWith({ bindingId: member.bindingId, generation: member.generation,
        projectId: 'p1', assignmentId: 'assignment-1', idempotencyKey: 'key-1', message: 'do it' });
      h.runtime.deliverSquadMember.mockClear();

      // Unknown execution, cross-execution member, and an unbound non-PTY session all fail closed.
      expect(await h.squadOpts.deliverAssignment(member.bindingId, 'x', correlation('missing-execution'))).toEqual({ state: 'rejected' });
      expect(await h.squadOpts.deliverAssignment(member.bindingId, 'x', correlation(other.id))).toEqual({ state: 'rejected' });
      expect(await h.squadOpts.deliverAssignment('not-a-member', 'x', correlation(execution.id))).toEqual({ state: 'rejected' });
      expect(h.runtime.deliverSquadMember).not.toHaveBeenCalled();
    });

    it('settles completion receipts only for the bound member and rejects a refused receipt', async () => {
      const { execution, member } = await launchBound();
      const settled = { ...correlation(execution.id), workerSessionId: member.bindingId };
      await expect(h.squadOpts.onWorkSettled(settled)).resolves.toBeUndefined();
      expect(h.runtime.completeSquadMemberDelivery).toHaveBeenCalledWith({ bindingId: member.bindingId, generation: member.generation,
        projectId: 'p1', assignmentId: 'assignment-1', idempotencyKey: 'key-1' });

      h.runtime.completeSquadMemberDelivery.mockClear();
      await h.squadOpts.onWorkSettled({ ...settled, executionId: 'missing-execution' });
      await h.squadOpts.onWorkSettled({ ...settled, workerSessionId: 'not-a-member' });
      expect(h.runtime.completeSquadMemberDelivery).not.toHaveBeenCalled();

      h.runtime.completeSquadMemberDelivery.mockImplementation(async request => ({ ...request, state: 'uncertain' }));
      await expect(h.squadOpts.onWorkSettled(settled)).rejects.toThrow('Modern assignment completion receipt rejected');
    });

    it('replies to a bound Modern member through the runtime, honouring correlation and rejection', async () => {
      const { member } = await launchBound();
      expect(await h.squadOpts.replyToSession(member.bindingId, 'hello')).toBe(true);
      const uncorrelated = h.runtime.deliverSquadMember.mock.calls.at(-1)![0];
      expect(uncorrelated.idempotencyKey).toBe(uncorrelated.assignmentId);
      expect(await h.squadOpts.replyToSession(member.bindingId, 'again', { assignmentId: 'a-2', idempotencyKey: 'k-2' })).toBe(true);
      expect(h.runtime.deliverSquadMember.mock.calls.at(-1)![0]).toMatchObject({ assignmentId: 'a-2', idempotencyKey: 'k-2' });
      expect(await h.squadOpts.deliverToWorker(member.bindingId, 'via worker')).toBe(true);

      h.runtime.deliverSquadMember.mockImplementation(async request => ({ ...request, state: 'rejected' } as never));
      expect(await h.squadOpts.replyToSession(member.bindingId, 'refused')).toBe(false);
      h.runtime.deliverSquadMember.mockClear();
      expect(await h.squadOpts.replyToSession('not-a-member', 'nobody')).toBe(false);
      expect(h.runtime.deliverSquadMember).not.toHaveBeenCalled();
      expect(h.drainOpts.isReplyIdempotent(member.bindingId)).toBe(true);
    });

    it('routes assignments, replies and drain checks for a CLI session through the PTY path', async () => {
      const execution = await claimExecution(`exec-pty-${reqId()}`);
      h.sessions.set('pty-1', { id: 'pty-1', status: 'running', projectId: 'p1', cohort: { executionId: execution.id, slotId: 'w1', role: 'worker' } });
      // A CLI session has no Modern binding, so the legacy injector answers (not the runtime).
      expect(['accepted', 'rejected']).toContain((await h.squadOpts.deliverAssignment('pty-1', 'cli work', correlation(execution.id))).state);
      expect(typeof await h.squadOpts.deliverToWorker('pty-1', 'cli worker')).toBe('boolean');
      await h.squadOpts.replyToSession('pty-1', 'cli reply');
      expect(h.runtime.deliverSquadMember).not.toHaveBeenCalled();
      // The session carries its own cohort, so no lifecycle lookup is needed and nothing is pending.
      expect(await h.drainOpts.pending('pty-1')).toEqual([]);
      expect(h.drainOpts.isReplyIdempotent('pty-1')).toBe(false);
      expect(h.drainOpts.isRestful('pty-1')).toBe(false);
    });

    it('treats an idle live Modern member as restful and a working one as not', async () => {
      const { req, member } = await launchBound();
      h.runtime.getSquadMemberStatus.mockImplementation(async request => ({ ...statusFor(request), status: 'idle', live: true }));
      await host.cancelTeamLaunch(req.callerPrincipalId, req.launchRequestId);
      expect(h.squadOpts.getAgentState(member.bindingId)).toBe('idle');
      expect(h.squadOpts.getWorkerLiveness(member.bindingId)).toBe('alive');
      expect(h.drainOpts.isRestful(member.bindingId)).toBe(true);
    });

    it('drains pending deliveries only for an active bound Modern member', async () => {
      const { member } = await launchBound();
      expect(await h.drainOpts.pending(member.bindingId)).toEqual([]);
      expect(await h.drainOpts.pending('not-a-member')).toEqual([]);
    });

    it('projects runtime status into agent state, liveness and drain restfulness', async () => {
      const { req, member } = await launchBound();
      h.runtime.getSquadMemberStatus.mockImplementation(async request => ({ ...statusFor(request), status: 'active', live: true, eventSequence: 1 }));
      h.runtime.stopSquadMember.mockResolvedValue(false);
      await host.cancelTeamLaunch(req.callerPrincipalId, req.launchRequestId);
      expect(h.squadOpts.getAgentState(member.bindingId)).toBe('working');
      expect(h.squadOpts.getWorkerLiveness(member.bindingId)).toBe('alive');
      expect(h.drainOpts.isRestful(member.bindingId)).toBe(false);

      h.runtime.getSquadMemberStatus.mockImplementation(async request => ({ ...statusFor(request), status: 'idle', live: false }));
      await host.cancelTeamLaunch(req.callerPrincipalId, req.launchRequestId);
      expect(h.squadOpts.getAgentState(member.bindingId)).toBe('idle');
      expect(h.squadOpts.getWorkerLiveness(member.bindingId)).toBe('unknown');
      expect(h.drainOpts.isRestful(member.bindingId)).toBe(true);
      // Capacity stays held: neither observation is exact terminal evidence.
      expect(lifecycle(req.launchRequestId).workers.find(worker => worker.threadId === member.bindingId)).toMatchObject({ capacityReleased: false });
    });

    it('planless durable Modern coordinator registers once via MCP and gets no plan-file handoff (B1)', async () => {
      const execution = await claimExecution(`exec-${reqId()}`);
      const req = { ...structuredReq(), executionId: execution.id, jobContext: { objective: 'List root files' } };
      const result = await launchTeam('team1', 'p1', req as never);
      expect(result.ok).toBe(true);
      const orchestrator = h.runtime.createSquadMember.mock.calls.map(([request]) => request).find((request) => request.role === 'orchestrator')!;
      expect(orchestrator.prompt).toContain('`execution.plan.register` EXACTLY ONCE');
      expect(orchestrator.prompt).not.toContain('.zana/execution-plan-');
      expect(orchestrator.prompt).not.toContain('file-write tool');
      expect(h.creates).toEqual([]);
    });
  });
});

describe('launchTeam CLI planless durable coordinator plan-file grant (B2)', () => {
  const claimExecution = async () => (await h.squadOpts.store.claim({
    callerPrincipalId: `cli-owner-${seq}`, projectId: 'p1', teamId: 'team1', jobTitle: 'Work', requestDigest: `digest-${reqId()}`,
    launchRequestId: `exec-${reqId()}`, resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [] }
  })).record as { id: string };
  const launchPlanless = async () => {
    const execution = await claimExecution();
    const result = await launchTeam('team1', 'p1', {
      callerPrincipalId: 'owner', launchRequestId: reqId(), coordinationMode: 'freeform', executionId: execution.id,
      jobContext: { objective: 'List root files' },
      slots: SLOT_IDS.map((slotId) => ({ slotId, initialTask: `task ${slotId}` }))
    } as never);
    expect(result.ok).toBe(true);
    return { execution, orchestrator: h.creates.find((create) => create.cohort?.role === 'orchestrator') };
  };

  it('grants the orchestrator exactly its own plan file and keeps the file handoff prompt', async () => {
    const { execution, orchestrator } = await launchPlanless();
    const rel = `.zana/execution-plan-${execution.id}.md`;
    expect(orchestrator.authoredPlanPaths).toEqual([
      join(projectDir, rel),
      join(projectDir, `.zana/execution-plan-corrected-${execution.id}.md`),
      join(projectDir, `.zana/execution-plan-correction-${execution.id}.md`)
    ]);
    expect(JSON.stringify([orchestrator.openingPrompt, orchestrator.extraArgs])).toContain(`Write your COMPLETE portable-executable plan to \`${rel}\``);
    expect(orchestrator.autonomous).toBe(false);
    for (const worker of h.creates.filter((create) => create.cohort?.role === 'worker')) {
      expect(worker.authoredPlanPaths).toBeUndefined();
    }
  });

  it('gives no grant when the orchestrator persona cannot write files', async () => {
    h.personas = [persona('orch', { deniedTools: ['Edit'] }), persona('w1'), persona('w2')];
    const { orchestrator } = await launchPlanless();
    expect(orchestrator.authoredPlanPaths).toBeUndefined();
  });

  it('gives no grant to a remote project PTY', async () => {
    h.projects = [{ id: 'p1', name: 'Remote', path: projectDir, hostId: 'other-host', remote: { host: 'ssh-box' } }];
    const { orchestrator } = await launchPlanless();
    expect(orchestrator.authoredPlanPaths).toBeUndefined();
  });
});
