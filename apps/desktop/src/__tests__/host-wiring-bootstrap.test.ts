import { describe, it, expect, vi } from 'vitest';

/**
 * Drives host.ts through a real `bootstrapNormal()` with Electron and the
 * heavyweight process-spawning seams stubbed, then exercises the wiring
 * callbacks main hands to the execution service, plan handoff, IPC registry,
 * MCP server and the PTY exit bridge.
 */
const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'host-wiring-boot-')));
  process.env.HOME = root;
  process.env.ZCC_DATA_DIR = path.join(root, '.zcc');
  process.env.ZCC_EXECUTION_STORE = 'json';
  const { EventEmitter } = require('node:events') as typeof import('node:events');
  const loose = (): any => new Proxy(function () {}, {
    get: (_t, key) => (typeof key === 'symbol' || key === 'then' ? undefined : loose()),
    apply: () => loose(),
    construct: () => loose() as object
  });
  return {
    root,
    loose,
    EventEmitter,
    appHandlers: new Map<string, ((...a: any[]) => any)[]>(),
    ready: undefined as undefined | (() => void),
    squadOpts: undefined as any,
    handoffOpts: undefined as any,
    ipcCtx: undefined as any,
    mcpDeps: undefined as any,
    ptys: undefined as any,
    quit: undefined as any,
    ipcHandlers: new Map<string, (...a: any[]) => any>(),
    menuTemplate: undefined as any,
    goalDeps: undefined as any,
    followupDeps: undefined as any,
    lifecycleStore: undefined as any,
    lifecycleIntegration: undefined as any,
    lifecycleOverride: {} as Record<string, (...a: any[]) => any>
  };
});

vi.mock('electron', () => {
  const loose = h.loose;
  const app = new Proxy({
    isPackaged: false,
    on: (name: string, fn: (...a: any[]) => any) => { h.appHandlers.set(name, [...(h.appHandlers.get(name) ?? []), fn]); },
    whenReady: () => ({ then: (fn: () => unknown) => { h.ready = () => void fn(); } }),
    getPath: (name: string) => name === 'home' ? h.root : `${h.root}/${name}`,
    getVersion: () => '9.9.9',
    getName: () => 'Zana',
    setName: () => {},
    requestSingleInstanceLock: () => true,
    quit: () => { h.quit?.(); },
    dock: loose()
  } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : (typeof k === 'symbol' ? undefined : loose())) });
  class BrowserWindow {
    static getAllWindows() { return []; }
    static getFocusedWindow() { return null; }
    static fromWebContents() { return null; }
    constructor() { return loose(); }
  }
  return {
    safeStorage: { isEncryptionAvailable: () => false },
    app,
    BrowserWindow,
    ipcMain: { handle: (c: string, fn: (...a: any[]) => any) => { h.ipcHandlers.set(c, fn); }, on: () => {}, removeHandler: () => {} },
    dialog: loose(),
    shell: loose(),
    screen: loose(),
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: (t: unknown) => { h.menuTemplate = t; return {}; } },
    nativeImage: { createFromPath: () => loose(), createEmpty: () => loose() },
    powerMonitor: { on: () => {}, off: () => {} },
    powerSaveBlocker: loose(),
    session: loose(),
    nativeTheme: { shouldUseDarkColors: false, on: () => {}, off: () => {} },
    systemPreferences: loose(),
    Notification: class { static isSupported() { return false; } },
    clipboard: loose()
  };
});

vi.mock('@zana-ai/zcc-host-daemon/pty', () => {
  class PtyManager extends h.EventEmitter {
    sessions = new Map<string, any>();
    constructor() {
      super();
      h.ptys = this;
      return new Proxy(this, {
        get: (t, k, r) => (k in t || typeof k === 'symbol' ? Reflect.get(t, k, r) : (() => undefined))
      });
    }
    createCalls: any[] = [];
    create(opts: any) {
      this.createCalls.push(opts);
      const id = opts.preallocatedSessionId ?? `s${this.createCalls.length}`;
      const session = { id, projectId: opts.projectId, profile: opts.profile, title: opts.title ?? 't', status: 'running', cwd: opts.cwd, cohort: opts.cohort, startedAt: Date.now() };
      this.sessions.set(id, session);
      return session;
    }
    waitForReady(id: string) { return Promise.resolve(this.sessions.get(id)); }
    getSession(id: string) { return this.sessions.get(id) ?? null; }
    getRememberedSession(id: string) { return this.sessions.get(id) ?? null; }
    list() { return [...this.sessions.values()]; }
    listAll() { return [...this.sessions.values()]; }
    liveCount() { return 0; }
    reapRemoteProcess() { return Promise.resolve(true); }
    killRemoteTmux() { return Promise.resolve(true); }
  }
  return { PtyManager, isClaudeProfile: (p: string) => p === 'claude' };
});

vi.mock('@zana-ai/zcc-server/services/execution/service', async () => {
  const actual: any = await vi.importActual('@zana-ai/zcc-server/services/execution/service');
  const Wrapped = new Proxy(actual.SquadExecutionService, {
    construct(target, args, nt) { h.squadOpts = args[0]; return Reflect.construct(target, args, nt); }
  });
  return { ...actual, SquadExecutionService: Wrapped };
});
vi.mock('../team-plan-handoff.js', async () => {
  const actual: any = await vi.importActual('../team-plan-handoff.js');
  const Wrapped = new Proxy(actual.TeamPlanHandoff, {
    construct(target, args, nt) { h.handoffOpts = args[0]; return Reflect.construct(target, args, nt); }
  });
  return { ...actual, TeamPlanHandoff: Wrapped };
});
vi.mock('../execution-storage.js', async () => {
  const actual: any = await vi.importActual('../execution-storage.js');
  return {
    ...actual,
    openExecutionStorage: (deps: any) => actual.openExecutionStorage({ ...deps, readState: () => [{ id: 'e0', state: 'running' }] })
  };
});
vi.mock('@zana-ai/zcc-server/services/launch/team-lifecycle-store', async () => {
  const actual: any = await vi.importActual('@zana-ai/zcc-server/services/launch/team-lifecycle-store');
  return {
    ...actual,
    createTeamLifecycleStore: (opts: unknown) => { h.lifecycleStore = actual.createTeamLifecycleStore(opts); return h.lifecycleStore; },
    createTeamLifecycleIntegration: (opts: unknown) => {
      const real = actual.createTeamLifecycleIntegration(opts);
      h.lifecycleIntegration = real;
      return new Proxy(real, { get: (t, k) => (typeof k === 'string' && h.lifecycleOverride[k]) || t[k] });
    }
  };
});
vi.mock('@zana-ai/zcc-host-daemon/harness/harness-verify', async () => {
  const actual: any = await vi.importActual('@zana-ai/zcc-host-daemon/harness/harness-verify');
  return {
    ...actual,
    verifyHarnesses: async () => [{ family: 'claude', enabled: true, installed: true }, { family: 'codex', enabled: true, installed: false }],
    // Launch preflight otherwise probes the real CLI on PATH: a framework-persona claude launch needs a
    // verifiable version, so it was DENIED on CI runners with no `claude` binary. Pin a version above
    // every evidence floor for claude (matching verifyHarnesses above); other families stay absent.
    installedHarnessVersion: async (_config: unknown, adapterId: string) => (adapterId === 'claude' ? '999.0.0' : undefined)
  };
});
vi.mock('../ipc/register.js', () => ({ registerIpcFamilies: (ctx: unknown) => { h.ipcCtx = ctx; } }));
vi.mock('@zana-ai/zcc-server/services/mcp/mcp-server', () => ({
  startMcpServer: async (deps: unknown) => { h.mcpDeps = deps; return { port: 1, close: async () => {} }; }
}));
vi.mock('../control/control-plane.js', () => ({ startControlPlane: async () => ({ close: async () => {} }) }));
vi.mock('../runtime/runtime-supervisor.js', () => ({
  startRuntimeSupervisor: async () => { throw new Error('no runtime in unit test'); }
}));
vi.mock('../updater.js', () => ({ createUpdater: () => ({ start() {}, stop() {} }) }));
vi.mock('../startup-dependency-doctor.js', () => ({ runStartupDependencyDoctor: async () => ({}) }));
vi.mock('../test-tap.js', () => ({
  record: () => {}, recordLog: () => {}, isEnabled: () => false, enable: () => {},
  drain: () => ({ entries: [], cursor: 0 }), snapshot: () => ({ entries: [] }), reset: () => {}
}));

const { GoalManager } = await import('@zana-ai/zcc-server/services/goals/goal-manager');
const { FollowUpManager } = await import('@zana-ai/zcc-server/services/followups/followup-manager');
for (const [klass, key] of [[GoalManager, 'goalDeps'], [FollowUpManager, 'followupDeps']] as const) {
  const original = (klass.prototype as any).setDeps;
  (klass.prototype as any).setDeps = function (deps: unknown) { (h as any)[key] = deps; return original.call(this, deps); };
}
const host = await import('../host.js');
const { store } = await import('@zana-ai/zcc-server/services/projects/store');
const registry = await import('@zana-ai/zcc-host-daemon/harness/registry');
const { mkdirSync, symlinkSync } = await import('node:fs');


const settle = () => new Promise<void>((r) => setImmediate(r));
/** Lets post-launch store writes from the previous launch land so the next preflight fence sees a quiet store. */
const quiesce = () => new Promise<void>((r) => setTimeout(r, 300));
/** Launch and return the result plus the single option bag that reached PtyManager.create (undefined when no spawn happened). */
const launchAndCapture = async (req: Record<string, unknown>, opts: { settle?: boolean } = {}) => {
  if (opts.settle !== false) await quiesce();
  const before = h.ptys.createCalls.length;
  const result = await host.createInteractiveTerminal({ projectId: project.id, cols: 80, rows: 24, ...req } as never);
  const spawned = h.ptys.createCalls.slice(before);
  expect(spawned.length).toBe(result.ok ? 1 : 0);
  return { result, spawn: spawned[0] as any };
};
const ctx = () => h.ipcCtx as any;
/** Assertion message carrying the launch outcome, so a CI-only DENIED shows its code and reason. */
const describeResult = (result: unknown) => `launch result: ${JSON.stringify(result)}`;
const sessionFixture = (over: Record<string, unknown> = {}) => ({
  id: 'sx', projectId: 'p1', profile: 'shell', title: 'T', status: 'running', cwd: h.root, startedAt: Date.now(), ...over
});
let project: any;

describe('host bootstrap wiring', () => {
  it('boots through bootstrapNormal and registers IPC, MCP and listeners', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.ready!();
    await vi.waitFor(() => expect(h.mcpDeps).toBeDefined(), { timeout: 20000 });
    expect(h.ipcCtx.createInteractiveTerminal).toBe(host.createInteractiveTerminal);
    expect(h.ipcCtx.launchAuthorizedTerminal).toBeTypeOf('function');
    expect(h.goalDeps.runEvaluator).toBeTypeOf('function');
    expect(h.followupDeps.getSession).toBeTypeOf('function');
    expect(h.followupDeps.resolveResume).toBeTypeOf('function');
    const dir = `${h.root}/proj`;
    mkdirSync(dir, { recursive: true });
    project = await h.mcpDeps.registerProject(dir);
    expect(project.alreadyExisted).toBe(false);
    expect((await h.mcpDeps.registerProject(dir)).alreadyExisted).toBe(true);
    project = project.project;
  }, 30000);

  it('rejects registerProject targets that are missing or outside the trusted bases', async () => {
    await expect(h.mcpDeps.registerProject(`${h.root}/nope`)).rejects.toThrow(/does not exist/);
    await expect(h.mcpDeps.registerProject('/etc')).rejects.toThrow(/outside HOME/);
  });

  it('exposes every IPC ctx getter and setter', async () => {
    const c = ctx();
    for (const key of Object.keys(c)) {
      expect(() => c[key]).not.toThrow();
    }
    for (const key of ['activeForegroundSessionId', 'extensionEntries', 'favoriteAgentKeys', 'offLoudInboxAppended', 'pendingWhatsNew']) {
      const current = c[key];
      c[key] = current;
      expect(c[key]).toBe(current);
    }
    expect(c.localProjects().length).toBeGreaterThan(0);
    expect(c.isTeamWorkerRestore({ cohort: { role: 'worker' } })).toBe(true);
    expect(c.restorePrincipal({ id: 'c', request: { cohort: { role: 'worker' } } })).toEqual({ kind: 'team', id: 'restore:c' });
    expect(c.restorePrincipal({ id: 'c', request: {} })).toEqual({ kind: 'automation', id: 'restore:c' });
    // Real wiring: no matching project/team/snapshots -> nothing restorable.
    expect(c.exactNativeRecoveryAvailability({ projectId: 'no-such-project', teamId: 'no-such-team', nativeRecoverySnapshots: [{ slotId: 's' }] }))
      .toEqual({ available: false, restorableSlots: 0 });
    expect(c.exactNativeRecoveryAvailability({ projectId: project.id, teamId: 't1' }))
      .toEqual({ available: false, restorableSlots: 0 });
    // Real wiring: unknown execution fences as CONFLICT before any worktree action runs.
    expect(await c.squadWorktreeAction(project.id, 'no-such-exec', 1, 'leave'))
      .toMatchObject({ ok: false, code: 'CONFLICT', message: expect.stringContaining('Squad run changed') });
    expect(c.restoreSquadWorktreeFollowUpClaim).toBeTypeOf('function');
  });

  it('builds the app menu with a working GitHub link and bug report entry', async () => {
    const { shell } = await import('electron');
    const items: any[] = [];
    const walk = (nodes: any[]) => nodes.forEach((n) => { items.push(n); if (Array.isArray(n.submenu)) walk(n.submenu); });
    walk(h.menuTemplate);
    for (const item of items.filter((i) => typeof i.click === 'function')) {
      try { item.click({}, {}); } catch { /* menu click needs a window */ }
    }
    expect(items.some((i) => i.label === 'View on GitHub')).toBe(true);
    expect(shell).toBeDefined();
  });

  it('launches terminals through authorize, revalidate and spawn', async () => {
    const result = await host.createInteractiveTerminal({ projectId: project.id, profile: 'shell', cols: 80, rows: 24 } as never);
    expect(result, describeResult(result)).toMatchObject({ ok: true });
    expect(await host.createInteractiveTerminal({ projectId: 'nope', profile: 'shell', cols: 1, rows: 1 } as never)).toMatchObject({ ok: false });
  });

  it('resolves framework personas and explicit personas during launch preflight and revalidation', async () => {
    const c = ctx();
    // Boot-time extension discovery assigns extensionEntries asynchronously and would clobber the fixture
    // mid-launch (flipping the preflight store fence to STALE_PREFLIGHT, or dropping the framework persona).
    // Install the fixture until it survives a quiet window, then launch with no further wait.
    const fixture = [{ id: 'fw', manifest: { title: 'FW', agentPreset: { systemPrompt: 'be careful', label: 'Careful' } } }];
    await vi.waitFor(async () => {
      c.extensionEntries = fixture;
      await quiesce();
      expect(c.extensionEntries).toBe(fixture);
    }, { timeout: 10000, interval: 0 });
    expect(host.resolveFrameworkPersona(['fw'], true)).toMatchObject({ id: 'framework:fw', appendSystemPrompt: 'be careful' });
    const framework = await launchAndCapture({ profile: 'claude', frameworkIds: ['fw'], prompt: 'task' }, { settle: false });
    expect(framework.result, describeResult(framework.result)).toMatchObject({ ok: true, value: { profile: 'claude' } });
    // Primer comes from main's own extension entry, stamped as a host persona; user typed a task so no kickoff prompt.
    expect(framework.spawn).toMatchObject({
      profile: 'claude',
      extraArgs: ['task'],
      persona: { id: 'framework:fw', name: 'Careful', baseProfile: 'claude', appendSystemPrompt: 'be careful', source: { extensionId: 'fw' } }
    });
    expect(framework.spawn.persona.initialPrompt).toBeUndefined();
    const bare = await launchAndCapture({ profile: 'claude', frameworkIds: ['unknown'] });
    // Unknown framework id resolves no preset -> bare launch with no persona/system prompt.
    expect(bare.result, describeResult(bare.result)).toMatchObject({ ok: true, value: { profile: 'claude' } });
    expect(bare.spawn.profile).toBe('claude');
    expect(bare.spawn.persona).toBeUndefined();
    vi.spyOn(c.personas, 'list').mockReturnValue([{ id: 'pers', name: 'Pers', baseProfile: 'claude' }]);
    const persona = await launchAndCapture({ profile: 'claude', personaId: 'pers', extraArgs: ['--model', 'x'] });
    expect(persona.result, describeResult(persona.result)).toMatchObject({ ok: true, value: { profile: 'claude' } });
    expect(persona.spawn).toMatchObject({ profile: 'claude', persona: { id: 'pers', name: 'Pers' }, extraArgs: ['--model', 'x'] });
    // Explicit personaId wins over frameworkIds.
    const both = await launchAndCapture({ profile: 'claude', personaId: 'pers', frameworkIds: ['fw'] });
    expect(both.spawn.persona).toMatchObject({ id: 'pers' });
    vi.mocked(c.personas.list).mockRestore();
  });

  it('prepares native sessions for resume-less launches and tolerates preparation failure', async () => {
    const cursor = registry.registrationFor('cursor' as never) as any;
    const spy = vi.spyOn(cursor, 'prepareNativeSession');
    spy.mockResolvedValueOnce({ id: 'chat-1' });
    const ok = await launchAndCapture({ profile: 'cursor' });
    spy.mockResolvedValueOnce(undefined);
    const none = await launchAndCapture({ profile: 'cursor' });
    spy.mockRejectedValueOnce(new Error('mint failed'));
    const failed = await launchAndCapture({ profile: 'cursor' });
    const pinned = await launchAndCapture({ profile: 'cursor', resumeSessionId: 'r1' });
    for (const r of [ok, none, failed, pinned]) expect(r.result, describeResult(r.result)).toMatchObject({ ok: true, value: { profile: 'cursor' } });
    expect(ok.spawn.resumeSessionId).toBe('chat-1');
    expect(none.spawn.resumeSessionId).toBeUndefined();
    expect(failed.spawn.resumeSessionId).toBeUndefined();
    expect(pinned.spawn.resumeSessionId).toBe('r1');
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ profile: 'cursor', cwd: project.path }));
    spy.mockRestore();
  });

  it('runs a spawn lifecycle and records a follow-up execution on the restore capability', async () => {
    const onSessionCreated = vi.fn();
    const withSpawnLock = vi.fn(async (spawn: () => Promise<unknown>) => spawn());
    const result = await ctx().launchAuthorizedTerminal(
      { projectId: project.id, profile: 'shell', cols: 80, rows: 24 },
      { kind: 'automation', id: 'automation:test' },
      undefined, undefined, undefined, undefined, undefined, undefined, false,
      { maySpawn: async () => true, claimRunning: async () => true, withSpawnLock, onSessionCreated },
      'follow-exec'
    );
    expect(result).toMatchObject({ ok: true });
    expect(onSessionCreated).toHaveBeenCalledTimes(1);
    expect(withSpawnLock).toHaveBeenCalledTimes(1);
    expect(ctx().restoreCapabilities.findSession(result.value.id)?.followUpExecutionId).toBe('follow-exec');
    const gated = await ctx().launchAuthorizedTerminal(
      { projectId: project.id, profile: 'shell', cols: 80, rows: 24 },
      { kind: 'automation', id: 'automation:test2' },
      undefined, undefined, undefined, undefined, undefined, undefined, false,
      { maySpawn: async () => false, claimRunning: async () => true }
    );
    expect(gated.ok).toBe(false);
  });

  it('resolves effective launches for squad worktrees and revalidates them', () => {
    const { realpathSync, mkdirSync: mk } = require('node:fs') as typeof import('node:fs');
    const root = realpathSync(project.path);
    const squadBase = `${root}/.worktrees`;
    mk(`${squadBase}/squad-1`, { recursive: true });
    const launch = host.resolveEffectiveLaunch({ worktreeInfo: { path: `${squadBase}/squad-1`, branch: 'b' } } as never, project);
    expect(launch.worktree?.branch).toBe('b');
    expect(host.revalidateEffectiveLaunch(launch, project)).toEqual({ ok: true });
    const outside = { ...launch, cwd: root, trustedPath: root };
    expect(host.revalidateEffectiveLaunch(outside, project)).toEqual({ ok: false, reason: 'effective launch path changed after preflight' });
    const escaped = host.resolveEffectiveLaunch({ worktreeInfo: { path: h.root, branch: 'b' } } as never, project);
    expect(escaped.worktree).toBeUndefined();
    const zccTrusted = `${h.root}/zcc-worktrees/wt1`;
    mk(zccTrusted, { recursive: true });
    const trusted = host.resolveEffectiveLaunch({ worktreeInfo: { path: zccTrusted, branch: 'w' } } as never, project);
    expect(trusted.worktree?.branch).toBe('w');
    expect(host.revalidateEffectiveLaunch(trusted, project)).toEqual({ ok: true });
  });

  it('prunes or retains worktrees according to execution ownership and retain intent', () => {
    const wt = `${h.root}/zcc-worktrees/wt-retain`;
    mkdirSync(wt, { recursive: true });
    const base = { projectId: project.id, profile: 'shell', cols: 80, rows: 24, worktreeInfo: { path: wt, branch: 'wb' } } as never;
    const plain = host.createTerminalConfined(base);
    const retained = host.createTerminalConfined(base, { retainWorktree: true });
    const squad = host.createTerminalConfined({ ...(base as object), cohort: { executionId: 'e1', role: 'worker', slotId: 's', teamId: 't', cohortId: 'c', teamName: 'T' } } as never);
    expect([plain.ok, retained.ok, squad.ok]).toEqual([true, true, true]);
    const env = host.createTerminalConfined({ ...(base as object), workspaceEnvironmentId: 'env1' } as never);
    expect(env.ok).toBe(true);
  });

  it('covers terminateSession for missing, local and remote sessions', async () => {
    const c = ctx();
    await c.terminateSession('absent');
    h.ptys.sessions.set('t-local', sessionFixture({ id: 't-local' }));
    await c.terminateSession('t-local');
    await c.terminateSession('t-local', false);
    const remoteSpy = vi.spyOn(store, 'listProjects').mockReturnValue([{ id: 'p1', name: 'R', path: h.root, remote: { host: 'h' } } as never]);
    h.ptys.sessions.set('t-remote', sessionFixture({ id: 't-remote', projectId: 'p1', remoteTmuxId: 'tm' }));
    vi.spyOn(h.ptys, 'killRemoteTmux').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await c.terminateSession('t-remote');
    await c.terminateSession('t-remote');
    remoteSpy.mockRestore();
  });

  it('handles pty data for non-worker, worker and screen-scan sessions', async () => {
    vi.useFakeTimers();
    try {
      h.ptys.sessions.set('d-shell', sessionFixture({ id: 'd-shell' }));
      h.ptys.emit('data', 'd-shell', 'out');
      h.ptys.emit('data', 'd-shell', 'out');
      h.ptys.sessions.set('d-worker', sessionFixture({ id: 'd-worker', cohort: { executionId: 'e-none', role: 'worker', slotId: 'sl', cohortId: 'c', teamId: 't', teamName: 'T' } }));
      h.ptys.emit('data', 'd-worker', 'out');
      h.ptys.sessions.set('d-oc', sessionFixture({ id: 'd-oc', profile: 'opencode' }));
      h.ptys.emit('data', 'd-oc', 'Permission required');
      h.ptys.emit('data', 'ghost', 'x');
      await vi.advanceTimersByTimeAsync(3000);
      h.ptys.sessions.set('d-oc2', sessionFixture({ id: 'd-oc2', profile: 'opencode' }));
      h.ptys.emit('data', 'd-oc2', 'Permission required');
      h.ptys.sessions.delete('d-oc2');
      await vi.advanceTimersByTimeAsync(3000);
    } finally { vi.useRealTimers(); }
  });

  it('refreshes restore capabilities and tears down session state on pty exit', async () => {
    const c = ctx();
    const put = (id: string, request: Record<string, unknown>) => c.restoreCapabilities.put({
      id, request: { projectId: project.id, cols: 80, rows: 24, ...request }, sessionId: `${id}-s`, sessionProfile: 'codex', sessionTitle: 'T', createdAt: Date.now()
    });
    put('cap-codex', { profile: 'codex', extraArgs: ['--x'] });
    put('cap-shell', { profile: 'shell' });
    const exit = async (session: Record<string, unknown>, code = 0, signal?: number | null, reason?: string | null) => {
      h.ptys.sessions.set(session.id as string, session);
      h.ptys.emit('exit', session.id, code, signal, reason);
      await settle();
    };
    await exit(sessionFixture({ id: 'cap-codex-s', profile: 'codex', status: 'exited', restoreCapabilityId: 'cap-codex', codexSessionId: 'uuid-1', remoteTmuxId: 'tm1' }));
    expect(c.restoreCapabilities.get('cap-codex').request).toMatchObject({ profile: 'codex-resume', resumeSessionId: 'uuid-1' });
    await exit(sessionFixture({ id: 'cap-shell-s', profile: 'shell', status: 'running', restoreCapabilityId: 'cap-shell' }), 1, 9, 'killed');
    expect(c.restoreCapabilities.get('cap-shell').request.profile).toBe('shell');
    await exit(sessionFixture({ id: 'cap-missing-s', status: 'exited', restoreCapabilityId: 'does-not-exist' }));
    await exit(sessionFixture({ id: 'cap-none-s', status: 'exited' }));
    await exit(sessionFixture({ id: 'w-exit', status: 'exited', cohort: { executionId: 'e-w', role: 'worker', slotId: 'sl', cohortId: 'c1', teamId: 't', teamName: 'T' } }));
    await exit(sessionFixture({ id: 'o-exit', status: 'exited', cohort: { executionId: 'e-o', role: 'orchestrator', slotId: 'sl', cohortId: 'c2', teamId: 't', teamName: 'T' } }));
    h.ptys.emit('exit', 'never-seen', 0);
    await settle();
  });

  it('closes remaining cohort members when a non-execution orchestrator exits', async () => {
    const cohort = { cohortId: 'c-cascade', teamId: 't', teamName: 'Cascade', slotId: 's' };
    h.ptys.sessions.set('casc-member', sessionFixture({ id: 'casc-member', cohort: { ...cohort, role: 'worker' } }));
    h.ptys.sessions.set('casc-exited', sessionFixture({ id: 'casc-exited', status: 'exited', cohort: { ...cohort, role: 'worker' } }));
    h.ptys.sessions.set('casc-orch', sessionFixture({ id: 'casc-orch', status: 'exited', cohort: { ...cohort, role: 'orchestrator' } }));
    h.ptys.emit('exit', 'casc-orch', 0);
    await settle();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('closed 1 member(s)'));
  });

  it('drives execution-service wiring callbacks', async () => {
    const o = h.squadOpts;
    const c = ctx();
    vi.spyOn(c.teams, 'list').mockReturnValue([{ id: 't1', slots: [{ personaId: 'pa' }, { personaId: 'pb' }, { personaId: 'pc' }], orchestratorPersonaId: 'po' }]);
    vi.spyOn(c.personas, 'list').mockReturnValue([
      { id: 'pa', name: 'A', baseProfile: 'claude', model: 'sonnet' },
      { id: 'pb', name: 'B', baseProfile: 'opencode', model: 'prov/model-b' },
      { id: 'pc', name: 'C', baseProfile: 'cursor', model: 'cm' },
      { id: 'po', name: 'O', baseProfile: 'shell' }
    ]);
    const openCode = registry.providerFor('opencode' as never) as any;
    const cursor = registry.providerFor('cursor' as never) as any;
    openCode.discoverModelTargets = vi.fn().mockResolvedValue(['prov/model-b']);
    cursor.discoverModelTargets = vi.fn().mockRejectedValue(new Error('cursor down'));
    const request = {
      teamId: 't1', workUnits: [], slots: [{ initialTask: 'a' }, { initialTask: 'b' }], coordinationMode: 'durable',
      policy: { maxLaunches: 50 }, sourceBundle: { sources: [{ byteSize: 5 }, { byteSize: 7 }] },
      resolvedModels: [{ slotId: 's1', personaId: 'pa', provider: 'claude', model: 'sonnet', level: 'high' }, { slotId: 's2', provider: 'x', model: 'y' }]
    };
    const admission = await o.admissionInput(project.id, request);
    expect(admission).toMatchObject({ slotCount: 2, maxSlots: 32, sourceBytes: 12 });
    expect(admission.slotRoutes).toHaveLength(2);
    const missing = await o.admissionInput('no-project', { teamId: 'ghost', workUnits: [], slots: [] });
    expect(missing.slotRoutes).toEqual([]);
    expect(missing.slotCount).toBe(0);
    expect(await o.getTeamLaunch('nobody', 'lr')).toBeUndefined();
    expect(await o.cancelTeamLaunch('nobody', 'lr')).toMatchObject({ ok: false });
    o.revokeTeamAuthorizations(['unknown-auth']);
    expect(o.isRegisteredProject(project.id)).toBe(true);
    expect(o.isRegisteredProject('zzz')).toBe(false);
    h.ptys.sessions.set('owner-live', sessionFixture({ id: 'owner-live', projectId: project.id }));
    expect(o.hasLivePredecessor(project.id, ['owner-live'])).toBe(true);
    expect(o.hasLivePredecessor(project.id, ['other'])).toBe(false);
    expect(o.mayResumeRetainedWorktree('exec-free')).toBe(true);
    expect(() => o.cacheResumeToken(project.id, 'exec-tok', 'tok', Date.now() + 1000)).toThrow(/Encryption/);
    o.clearResumeToken(project.id, 'exec-tok');
    expect(o.preflightWorkflow('missing-team', {})).toMatchObject({ ok: false, code: 'INVALID_WORKFLOW_PROFILE' });
    expect(() => o.preflightWorkflow('t1', {})).not.toThrow();
    expect(typeof o.routingEnforcementEnabled()).toBe('boolean');
    expect(typeof o.claimRecoveryObserveEnabled()).toBe('boolean');
    expect(typeof o.claimRecoveryEnforceEnabled()).toBe('boolean');
    expect(typeof o.planStartupGraceMs()).toBe('number');
    expect(typeof o.routeFitObserveEnabled()).toBe('boolean');
    const tryIt = (fn: () => unknown) => { try { return fn(); } catch { return undefined; } };
    tryIt(() => o.getAgentState('owner-live'));
    tryIt(() => o.getWorkerLiveness('owner-live'));
    tryIt(() => o.closeWorkerSession('owner-live'));
    expect(o.stallFirstDispatch).toBeUndefined();
    expect(o.now()).toBeGreaterThan(0);
    await Promise.resolve(tryIt(() => o.readSessionStats('absent'))).catch(() => undefined);
    await Promise.resolve(tryIt(() => o.readSessionStats('owner-live', {}))).catch(() => undefined);
    tryIt(() => o.deliverToWorker('owner-live', 'text'));
    tryIt(() => o.replyToSession('owner-live', 'text'));
    expect(typeof o.prepareSquadWorktree).toBe('function');
    expect(typeof o.onTerminal).toBe('function');
    expect(typeof o.resolveExactNativeRecoverySnapshots).toBe('function');
    await Promise.resolve(tryIt(() => o.authorizePlanRegistration({ id: 'x' }, []))).catch(() => undefined);
    vi.mocked(c.teams.list).mockRestore();
    vi.mocked(c.personas.list).mockRestore();
  });

  it('reports team launch lifecycle results through the exported wrappers', async () => {
    h.lifecycleOverride.cancelTeamLaunch = async (_c: string, id: string) => id === 'ok'
      ? { ok: true, canceledSessionIds: ['a'], pendingSessionIds: [], lifecycleState: 'cancelled' }
      : { ok: false, code: 'NOT_FOUND' };
    h.lifecycleOverride.getTeamLaunch = async (_c: string, id: string) => id === 'ok'
      ? { ok: true, record: { id: 'rec' } }
      : { ok: false, code: 'NOT_FOUND' };
    expect(await host.cancelTeamLaunch(' ', 'x')).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await host.cancelTeamLaunch('c', 'ok')).toMatchObject({ ok: true, value: { canceledSessionIds: ['a'] } });
    expect(await host.cancelTeamLaunch('c', 'bad')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await host.getTeamLaunch('c', 'ok')).toEqual({ ok: true, value: { id: 'rec' } });
    expect(await host.getTeamLaunch('c', 'bad')).toMatchObject({ ok: false });
    expect(await h.squadOpts.getTeamLaunch('c', 'ok')).toEqual({ id: 'rec' });
    expect(await h.squadOpts.cancelTeamLaunch('c', 'ok')).toMatchObject({ ok: true });
    h.lifecycleOverride = {};
  });

  it('reports team task outcomes for known and unknown workers', async () => {
    expect(await host.reportTeamTask('worker-1', 'lr-1', 'slot-1', 'complete')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    vi.spyOn(h.lifecycleStore, 'list').mockResolvedValue([{ id: 'rec', launchRequestId: 'lr-1', workers: [{ sessionId: 'worker-1', slotId: 'slot-1' }] }]);
    const update = vi.spyOn(h.lifecycleStore, 'updateWorker').mockResolvedValue({ record: { id: 'rec' } });
    expect(await host.reportTeamTask('worker-1', 'lr-1', 'slot-1', 'complete')).toMatchObject({ ok: true });
    expect(await host.reportTeamTask('worker-1', 'lr-1', 'slot-1', 'failed')).toMatchObject({ ok: true });
    expect(update).toHaveBeenLastCalledWith('rec', 'slot-1', { task: 'caller-reported-failed' });
  });

  it('wires the plan handoff to the execution service, nudges and cleanup', async () => {
    const o = h.handoffOpts;
    expect(await o.isPlanless(project.id, 'no-such-exec')).toBe(true);
    const ctxSession = { slotId: 's', executionId: 'e', projectId: project.id, sessionId: 'sess' };
    const registerPlan = vi.spyOn(ctx().squadExecutionService, 'registerPlan');
    registerPlan.mockResolvedValueOnce({ ok: true });
    expect(await o.register(ctxSession, [])).toEqual({ ok: true });
    registerPlan.mockResolvedValueOnce({ ok: false, message: 'bad plan' });
    expect(await o.register(ctxSession, [])).toEqual({ ok: false, message: 'bad plan' });
    o.nudge('sess', 'hello');
    await o.cleanup(project.path, 'e');
    o.logError('ctx', new Error('boom'));
    registerPlan.mockRestore();
  });

  it('ignores unrelated goal evaluator and follow-up dependency edges', async () => {
    const c = ctx();
    vi.spyOn(c.promptRegistry, 'get').mockReturnValueOnce(undefined).mockReturnValueOnce({ id: 'builtin:goal-evaluator' });
    vi.spyOn(c.llmService, 'run').mockResolvedValue({ ok: true, text: 'ok', provider: 'claude-cli', ms: 1 });
    const vars = { statement: 's', criteria: 'c', lastTurn: 'l', report: 'r' };
    expect(await h.goalDeps.runEvaluator(vars, 'k')).toMatchObject({ ok: false });
    expect(await h.goalDeps.runEvaluator(vars, 'k')).toMatchObject({ ok: true });
    h.ptys.sessions.set('f1', sessionFixture({ id: 'f1', scheduled: true, headless: true, claudeSessionId: 'cs', personaId: 'pp' }));
    expect(h.followupDeps.getSession('f1')).toEqual({ scheduled: true, headless: true });
    expect(h.followupDeps.getSession('zz')).toBeNull();
    expect(h.followupDeps.resolveProjectForSession('f1')).toBe('p1');
    expect(h.followupDeps.resolveResume('f1')).toMatchObject({ claudeSessionId: 'cs', personaId: 'pp' });
    expect(h.followupDeps.resolveResume('zz')).toBeNull();
    expect(typeof h.followupDeps.followupsFromIdle()).toBe('boolean');
  });

  it('parses overseer hook bodies and rejects malformed ones', async () => {
    const hook = h.mcpDeps.onOverseerHook;
    h.ptys.sessions.set('ov', sessionFixture({ id: 'ov', projectId: project.id }));
    h.ptys.sessions.set('ov-exited', sessionFixture({ id: 'ov-exited', status: 'exited' }));
    expect(await hook(project.id, 'missing', '{}')).toBeNull();
    expect(await hook(project.id, 'ov-exited', '{}')).toBeNull();
    expect(await hook(project.id, 'ov', 'not json')).toBeNull();
    expect(await hook(project.id, 'ov', JSON.stringify({ tool_input: {} }))).toBeNull();
    await hook(project.id, 'ov', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }));
    await hook(project.id, 'ov', JSON.stringify({ tool_name: 'Bash', tool_input: 'string-input' }));
  });

  it('renders AskUserQuestion hook payloads only when enabled and well formed', async () => {
    const hook = h.mcpDeps.onQuestionHook;
    h.ptys.sessions.set('q1', sessionFixture({ id: 'q1', projectId: project.id }));
    h.ptys.sessions.set('q2', sessionFixture({ id: 'q2', projectId: project.id, scheduled: { taskId: 'x' } }));
    h.ptys.sessions.set('q-exited', sessionFixture({ id: 'q-exited', status: 'exited' }));
    const config = store.getConfig();
    const cfg = vi.spyOn(store, 'getConfig').mockReturnValue({ ...config, askUserQuestionUiEnabled: false });
    hook(project.id, 'q1', '{}');
    cfg.mockReturnValue({ ...config, askUserQuestionUiEnabled: true });
    hook(project.id, 'ghost', '{}');
    hook(project.id, 'q-exited', '{}');
    hook(project.id, 'q1', 'not json');
    hook(project.id, 'q1', JSON.stringify({}));
    hook(project.id, 'q1', JSON.stringify({ tool_input: { questions: [] } }));
    const payload = { tool_input: { questions: [{ question: 'Pick?', header: 'H', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }] } };
    hook(project.id, 'q1', JSON.stringify(payload));
    hook(project.id, 'q2', JSON.stringify(payload));
    await settle();
    cfg.mockRestore();
  });

  it('reports scheduled-run summaries to scheduler and goals, resolving inbox levels', async () => {
    h.mcpDeps.onReport(project.id, 'sess-r', 'done', 'ok');
    h.ptys.sessions.set('lv', sessionFixture({ id: 'lv', scheduled: { taskId: 't' } }));
    h.ptys.sessions.set('lv2', sessionFixture({ id: 'lv2', scheduled: { taskId: 't' }, inboxLevel: 'loud' }));
    expect(h.mcpDeps.resolveScheduledLevel('lv')).toBe('quiet');
    expect(h.mcpDeps.resolveScheduledLevel('lv2')).toBe('loud');
    expect(h.mcpDeps.resolveScheduledLevel('sx-none')).toBeNull();
    await settle();
  });

  it('flushes blocker notices at boot and isolates later failures', async () => {
    const flushBlockerNotices = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    const logError = vi.fn();
    const flush = await host.flushBlockerNoticesAtBoot({ flushBlockerNotices }, logError);
    flush();
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith('execution.flushBlockerNotices', expect.objectContaining({ message: 'offline' })));
  });

  it('quits without confirmation when configured and releases services and timers', async () => {
    const config = store.getConfig();
    vi.spyOn(store, 'getConfig').mockReturnValue({ ...config, confirmQuitOnLiveSessions: false });
    const beforeQuit = h.appHandlers.get('before-quit')![0];
    beforeQuit({ preventDefault: vi.fn() });
    await settle();
    expect(() => beforeQuit({ preventDefault: vi.fn() })).not.toThrow();
  });
});
