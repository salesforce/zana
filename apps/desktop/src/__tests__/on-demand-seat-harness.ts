/**
 * Shared harness for the #580 on-demand seat host tests: the faked pty layer and stores of
 * host-team-launch-direct.test.ts, with the hoisted state exported as `h`. Import it first.
 */
import { vi } from 'vitest';
import type {
  SquadMemberControlRequest, SquadMemberDeliveryCompletion, SquadMemberDeliveryRequest, SquadMemberDeliveryResult, SquadMemberRuntimeRequest, SquadMemberStatus, SquadRuntimePreflightRequest,
  SquadRuntimePreflightResult
} from '@zana-ai/zcc-contracts/runtime';

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
    authorizations: undefined as any,
    launchAuthorization(): any { return this.authorizations; },
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

// These suites drive launches, not plugin admission (covered in dispatch-admission tests): admit everything.
vi.mock('../runtime/dispatch-admission.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../runtime/dispatch-admission.js')>()), createMainDispatchAdmission: () => async () => null }));
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
    liveCount() { return h.sessions.size; }
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

// Capture main's launch authorization store so tests can read and revoke approvals.
vi.mock('@zana-ai/zcc-server/services/launch/authorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/launch/authorization')>();
  const Wrapped = new Proxy(actual.LaunchAuthorizationService, {
    construct(target, args, newTarget) { const made = Reflect.construct(target, args, newTarget); h.authorizations ??= made; return made; }
  });
  return { ...actual, LaunchAuthorizationService: Wrapped };
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

export { h };
