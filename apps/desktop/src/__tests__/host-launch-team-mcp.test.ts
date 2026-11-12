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

describe('Modern Team launch honours the persona MCP allowlist', () => {
  const HOST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const readyRuntime = (): SquadRuntimePreflightResult => ({
    ready: true, hostId: HOST_ID, policyInventoryReady: true,
    nativeToolPolicyRequired: false, nativeToolPolicyWired: true,
    providers: [{ providerId: 'claude-code', available: true }, { providerId: 'acp-opencode', available: true }]
  });
  const structuredReq = () => ({
    callerPrincipalId: `modern-owner-${seq}`,
    launchRequestId: reqId(),
    coordinationMode: 'structured' as const,
    slots: SLOT_IDS.map((slotId) => ({ slotId, initialTask: `task ${slotId}` }))
  });
  const created = () => h.runtime.createSquadMember.mock.calls.map(([request]) => request);

  beforeEach(() => {
    h.teams[0].transport = 'MODERN';
    h.personas = [persona('orch'), persona('w1'), persona('w2')];
    h.runtime.preflightSquadRuntime.mockReset().mockResolvedValue(readyRuntime());
    h.runtime.createSquadMember.mockReset().mockImplementation(async (request) => ({ threadId: request.bindingId }));
    h.runtime.activateSquadMember.mockReset().mockImplementation(async (request) => ({ threadId: request.bindingId }));
    h.runtime.getSquadMemberStatus.mockReset().mockImplementation(async (request) => ({
      bindingId: request.bindingId, projectId: request.projectId, generation: request.generation,
      live: true, status: 'idle', hostOnline: true, providerStarted: true, eventSequence: 0, updatedAt: Date.now()
    }));
    h.runtime.isSquadMemberLive.mockReset().mockResolvedValue(true);
    h.runtime.deliverSquadMember.mockReset().mockImplementation(async (request) => ({
      bindingId: request.bindingId, projectId: request.projectId, generation: request.generation,
      assignmentId: request.assignmentId, idempotencyKey: request.idempotencyKey, state: 'accepted'
    }));
    h.runtime.completeSquadMemberDelivery.mockReset().mockImplementation(async (request) => ({ ...request, state: 'completed' }));
    h.runtime.stopSquadMember.mockReset().mockResolvedValue(true);
  });

  it('launches a persona with an MCP allowlist instead of refusing, carrying the main-resolved list', async () => {
    h.personas = [persona('orch'), persona('w1', { mcpServers: ['github'] }), persona('w2')];
    const result = await launchTeam('team1', 'p1', structuredReq());
    expect(result).toMatchObject({ ok: true, value: { failedSlots: [] } });
    const restricted = created().filter((request) => request.mcpAllowlist !== undefined);
    expect(restricted.length).toBe(2);
    for (const request of restricted) {
      expect(request.mcpAllowlist).toEqual(expect.arrayContaining(['github', 'zcc-inbox']));
    }
  });

  it('an empty persona list is a restriction to zcc-inbox only, not "unset"', async () => {
    h.personas = [persona('orch'), persona('w1'), persona('w2', { mcpServers: [] })];
    expect((await launchTeam('team1', 'p1', structuredReq())).ok).toBe(true);
    const requests = created();
    const empty = requests.filter((request) => Array.isArray(request.mcpAllowlist));
    expect(empty).toHaveLength(1);
    expect(empty[0].mcpAllowlist).toEqual(['zcc-inbox']);
    // Unrestricted personas carry no field at all, so their requests stay byte-identical.
    expect(requests.filter((request) => request.mcpAllowlist === undefined)).toHaveLength(3);
    expect(requests.filter((request) => !('mcpAllowlist' in request))).toHaveLength(3);
  });

  it('applies the orchestrator persona list to the orchestrator seat', async () => {
    h.personas = [persona('orch', { mcpServers: ['search'] }), persona('w1'), persona('w2')];
    expect((await launchTeam('team1', 'p1', structuredReq())).ok).toBe(true);
    const orch = created().filter((request) => request.role === 'orchestrator');
    expect(orch).toHaveLength(1);
    expect(orch[0].mcpAllowlist).toEqual(expect.arrayContaining(['search', 'zcc-inbox']));
  });

  it('drops malformed persona values (treated as unset by the store sanitizer)', async () => {
    h.personas = [persona('orch'), persona('w1', { mcpServers: 'github' }), persona('w2')];
    expect((await launchTeam('team1', 'p1', structuredReq())).ok).toBe(true);
    expect(created().every((request) => request.mcpAllowlist === undefined)).toBe(true);
  });

  it.each([
    ['allowedTools', { allowedTools: ['Bash'] }],
    ['deniedTools', { deniedTools: ['Bash'] }],
    ['addDirs', { addDirs: ['/tmp'] }],
    ['codexSandbox', { codexSandbox: 'workspace-write' }],
    ['codexApproval', { codexApproval: 'never' }]
  ] as const)('still refuses the %s override even next to an MCP allowlist', async (_label, extra) => {
    h.personas = [persona('orch'), persona('w1', { mcpServers: ['github'], ...extra }), persona('w2')];
    const result = await launchTeam('team1', 'p1', structuredReq());
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED', message: expect.stringMatching(/tool or sandbox overrides/) });
    expect(h.runtime.preflightSquadRuntime).not.toHaveBeenCalled();
    expect(h.runtime.createSquadMember).not.toHaveBeenCalled();
  });
});

describe('slotMcpAllowlistFact (plan fact for admission, D7)', () => {
  const { slotMcpAllowlistFact } = host;
  const personas = [persona('r', { mcpServers: ['github'] }), persona('u'), persona('e', { mcpServers: [] })] as never[];
  const cli = { provider: 'claude', remoteCli: false };

  it('resolves the effective list including zcc-inbox; empty list still restricts', () => {
    expect(slotMcpAllowlistFact(undefined, personas, 'r', '0:r:0', cli).mcpServers).toEqual(expect.arrayContaining(['github', 'zcc-inbox']));
    expect(slotMcpAllowlistFact(undefined, personas, 'e', '0:e:0', cli)).toEqual({ mcpServers: ['zcc-inbox'] });
  });

  it('is empty for unrestricted and unknown personas', () => {
    expect(slotMcpAllowlistFact(undefined, personas, 'u', '0:u:0', cli)).toEqual({});
    expect(slotMcpAllowlistFact(undefined, personas, 'nope', '0:n:0', cli)).toEqual({});
    expect(slotMcpAllowlistFact(undefined, personas, undefined, '0:n:0', cli)).toEqual({});
  });

  it('leaves the field unset where MCP cannot be delivered (shell harness, remote CLI session)', () => {
    expect(slotMcpAllowlistFact(undefined, personas, 'r', '0:r:0', { provider: 'shell', remoteCli: false })).toEqual({});
    expect(slotMcpAllowlistFact(undefined, personas, 'r', '0:r:0', { provider: 'claude', remoteCli: true })).toEqual({});
  });

  it('treats an orchestrator slot id as the orchestrator role', () => {
    expect(slotMcpAllowlistFact(undefined, personas, 'r', 'orchestrator:r', cli).mcpServers).toContain('github');
  });
});
