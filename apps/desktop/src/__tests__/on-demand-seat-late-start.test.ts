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

import { createTeamLifecycleStore } from '@zana-ai/zcc-server/services/launch/team-lifecycle-store';
import { createDesktopNativeRecovery } from '../team-launch-support.js';

/**
 * #580 acceptance tests for starting a Squad seat on demand, through the real host.ts
 * launchTeam path with a faked pty layer (the harness of host-team-launch-direct.test.ts).
 * Written test first: they fail until the deferred seat, its spawner and its release exist.
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
const reqId = () => `req-${seq}-${Math.random().toString(36).slice(2)}`;
const lifecycleFile = () => join(h.root, 'team-lifecycle.json');
const recordFor = (launchRequestId: string): TeamLifecycleRecord => {
  const state = JSON.parse(readFileSync(lifecycleFile(), 'utf8')) as { records: TeamLifecycleRecord[] };
  return state.records.find((candidate) => candidate.launchRequestId === launchRequestId)!;
};
const worker = (record: TeamLifecycleRecord, slotId: string) => record.workers.find((w) => w.slotId === slotId);
const durableReq = (extra: Record<string, unknown> = {}) => ({
  callerPrincipalId: 'owner', launchRequestId: reqId(), coordinationMode: 'structured' as const,
  slots: SLOT_IDS.map((slotId) => ({ slotId, initialTask: `task ${slotId}` })), ...extra
});
const spawn = (recordId: string, slotId: string) => h.squadOpts.spawnDeferredWorker(recordId, slotId) as Promise<{ ok: boolean; sessionId?: string; message?: string }>;
const onDemand = (...rows: number[]) => {
  h.teams = [{ id: 'team1', name: 'Team One', orchestratorPersonaId: 'orch',
    slots: [{ personaId: 'w1', quantity: 2, ...(rows.includes(0) ? { startOnDemand: true } : {}) }, { personaId: 'w2', label: 'Second', ...(rows.includes(1) ? { startOnDemand: true } : {}) }] }];
};

describe('late start of an on-demand seat through the real launch path (#580)', () => {
  it('mints a fresh authorisation for the late session instead of reusing the expired launch one', async () => {
    onDemand(0);
    const req = durableReq({ requirePreauthorization: undefined });
    expect((await launchTeam('team1', 'p1', req as never)).ok).toBe(true);
    const record = recordFor(req.launchRequestId);
    const launchAuth = worker(record, '0:w1:0')?.authorizationId;
    const started = await spawn(record.id, '0:w1:0');
    expect(started.ok).toBe(true);
    const bound = worker(recordFor(req.launchRequestId), '0:w1:0');
    expect(bound?.authorizationId).toBeTruthy();
    expect(bound?.authorizationId).not.toBe(launchAuth);
    expect(recordFor(req.launchRequestId).launchResult.workers.map((w) => w.slotId)).toContain('0:w1:0');
  });

  it('names the seat by its label (or persona) in the refusal and spawns nothing', async () => {
    onDemand(1);
    h.teams[0].transport = 'MODERN';
    const result = await launchTeam('team1', 'p1', durableReq() as never);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain('Second');
    expect(h.creates).toHaveLength(0);
  });

  it('lists a waiting seat in the coordinator prompt and does not give it a session id', async () => {
    onDemand(0);
    const req = durableReq({ jobContext: { objective: 'Ship' } });
    expect((await launchTeam('team1', 'p1', req as never)).ok).toBe(true);
    const coordinatorCreate = h.creates.find((c) => c.cohort?.slotId === 'orchestrator:orch');
    const text = JSON.stringify(coordinatorCreate);
    expect(text).toContain('Seats that start when their first unit is ready');
    expect(text).toContain('0:w1:0');
  });

  it('records two on-demand rows independently and lets the second start without the first', async () => {
    onDemand(0, 1);
    const req = durableReq();
    expect((await launchTeam('team1', 'p1', req as never)).ok).toBe(true);
    const record = recordFor(req.launchRequestId);
    expect(h.creates.map((c) => c.cohort?.slotId)).toEqual(['orchestrator:orch']);
    expect((await spawn(record.id, '1:w2:0')).ok).toBe(true);
    expect(worker(recordFor(req.launchRequestId), '0:w1:0')).toMatchObject({ process: 'authorized' });
  });

  it('a failed late spawn marks the seat failed and releases the spawner entry for later calls', async () => {
    onDemand(0);
    const req = durableReq();
    await launchTeam('team1', 'p1', req as never);
    const record = recordFor(req.launchRequestId);
    h.createImpl = () => { throw new Error('boom'); };
    expect((await spawn(record.id, '0:w1:0')).ok).toBe(false);
    expect(worker(recordFor(req.launchRequestId), '0:w1:0')?.process).toBe('spawn-failed');
    h.createImpl = null;
    expect((await spawn(record.id, '0:w1:1')).ok).toBe(true);
  });

  it('through the engine path (pre-issued authorisations) revokes the unused one and starts the seat later', async () => {
    onDemand(0);
    const launchRequestId = reqId();
    const tasks = SLOT_IDS.map((slotId) => ({ slotId, initialTask: `task ${slotId}` }));
    const authorized = authorizeTeamLaunch('owner', 'team1', 'p1', launchRequestId, {}, tasks as never, 'structured', 'adm');
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    const slots = authorized.value.slots.map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }));
    const launched = await launchTeam('team1', 'p1', { callerPrincipalId: 'owner', launchRequestId, requirePreauthorization: true, admissionDigest: 'adm', coordinationMode: 'structured', slots } as never);
    expect(launched).toMatchObject({ ok: true });
    const record = recordFor(launchRequestId);
    expect(worker(record, '0:w1:0')?.sessionId).toBeUndefined();
    const late = await spawn(record.id, '0:w1:0');
    expect(late).toMatchObject({ ok: true });
    expect(worker(recordFor(launchRequestId), '0:w1:0')?.sessionId).toBeTruthy();
  });

  it('skips an on-demand seat whose persona is unknown, like any other seat', async () => {
    onDemand(0);
    h.personas = [persona('orch'), persona('w2')];
    const req = durableReq();
    await launchTeam('team1', 'p1', req as never);
    const record = recordFor(req.launchRequestId);
    expect(worker(record, '0:w1:0')).toBeUndefined();
  });

  it('cancelling a run that has already ended is harmless', async () => {
    onDemand(0);
    expect((await host.cancelTeamLaunch('nobody', 'no-such-request')).ok).toBe(false);
  });
});
