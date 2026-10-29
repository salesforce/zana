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
    lifecycleOverride: {} as Record<string, (...a: any[]) => any>,
    runtimeOverride: {} as Record<string, (...a: any[]) => any>,
    controlPlaneDeps: undefined as any,
    browserManager: undefined as any,
    mobileStart: vi.fn(),
    lastWin: undefined as any,
    winOptions: [] as any[],
    sent: [] as unknown[][],
    winDestroyed: false,
    contentsDestroyed: (() => false) as () => boolean,
    runtimeStart: undefined as any,
    nativeTheme: Object.assign(new EventEmitter(), { shouldUseDarkColors: false, shouldUseHighContrastColors: false }),
    overlays: [] as unknown[]
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
    constructor(options: unknown) {
      h.winOptions.push(options);
      const fallback = { get: (target: Record<string, unknown>, key: string | symbol) =>
        key in target ? target[key as string] : loose() };
      const win = new Proxy({
        id: 1,
        isDestroyed: () => h.winDestroyed,
        setTitleBarOverlay: (options: unknown) => { h.overlays.push(options); },
        webContents: new Proxy({ id: 2, isDestroyed: () => h.contentsDestroyed(), send: (...a: unknown[]) => { h.sent.push(a); } }, fallback)
      }, fallback);
      h.lastWin = win;
      return win;
    }
  }
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  return {
    safeStorage: { isEncryptionAvailable: () => false },
    app,
    BrowserWindow,
    ipcMain: { handle: (c: string, fn: (...a: any[]) => any) => { h.ipcHandlers.set(c, fn); }, on: () => {}, removeHandler: () => {} },
    dialog: loose(),
    shell: loose(),
    screen: new Proxy({ getAllDisplays: () => [display], getPrimaryDisplay: () => display }, {
      get: (target, key) => key in target ? target[key as keyof typeof target] : loose()
    }),
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: (t: unknown) => { h.menuTemplate = t; return {}; } },
    nativeImage: { createFromPath: () => loose(), createEmpty: () => loose() },
    powerMonitor: { on: () => {}, off: () => {} },
    powerSaveBlocker: loose(),
    session: loose(),
    nativeTheme: h.nativeTheme,
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
// The per-principal launch budget derives from machine RAM, and the mocked spawns never drain it. A small CI
// runner exhausted it mid-file ("principal launch budget exhausted"); pin a budget no test here can reach.
vi.mock('@zana-ai/zcc-host-daemon/capacity', async () => {
  const actual: any = await vi.importActual('@zana-ai/zcc-host-daemon/capacity');
  return { ...actual, resolveMaxLiveSessions: () => 64 };
});
vi.mock('../ipc/register.js',() => ({ registerIpcFamilies: (ctx: unknown) => { h.ipcCtx = ctx; } }));
vi.mock('@zana-ai/zcc-server/services/mcp/mcp-server', () => ({
  startMcpServer: async (deps: unknown) => { h.mcpDeps = deps; return { port: 9876, close: async () => {} }; }
}));
vi.mock('../control/control-plane.js', () => ({ startControlPlane: async (deps: unknown) => {
  h.controlPlaneDeps = deps;
  return { close: async () => {} };
} }));
vi.mock('../desktop-browser-view.js', async () => {
  const actual: any = await vi.importActual('../desktop-browser-view.js');
  return { ...actual, createDesktopBrowserViewManager: (...args: any[]) => {
    h.browserManager = actual.createDesktopBrowserViewManager(...args);
    return h.browserManager;
  } };
});
vi.mock('../runtime/runtime-supervisor.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../runtime/runtime-supervisor.js')>();
  return {
    ...actual,
    // Dev product-route runtime, with per-test method overrides for Modern member probes.
    createProductRouteSquadRuntime: (...args: Parameters<typeof actual.createProductRouteSquadRuntime>) => {
      const real = actual.createProductRouteSquadRuntime(...args);
      return new Proxy(real, { get: (t, k) => (typeof k === 'string' && h.runtimeOverride[k]) || (t as any)[k] });
    },
    startRuntimeSupervisor: async () => { if (h.runtimeStart) return h.runtimeStart; throw new Error('no runtime in unit test'); }
  };
});
vi.mock('@zana-ai/zcc-server/mobile/manager', () => ({
  MobileGatewayManager: class { start() { h.mobileStart(); return Promise.reject(new Error('port held')); } close() { return Promise.resolve(); } status() { return {}; } }
}));
vi.mock('../updater.js', () => ({ createUpdater: () => ({ start() {}, stop() {}, checkForUpdates: async () => {} }) }));
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
const { IPC } = await import('@zana-ai/zcc-desktop-contract');
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
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173');
    const realGetConfig = store.getConfig.bind(store);
    // Theme light: the boot window must open on the light background.
    const configSpy = vi.spyOn(store, 'getConfig').mockImplementation(() => ({ ...realGetConfig(), mobileGatewayEnabled: true, theme: 'light' }));
    try {
      h.ready!();
      await vi.waitFor(() => expect(h.controlPlaneDeps, JSON.stringify(vi.mocked(console.error).mock.calls)).toBeDefined(), { timeout: 20000 });
      expect(h.controlPlaneDeps.pluginCommands.cliContributions).toBeTypeOf('function');
      // The window paints the light --bg-base and its preload seeds data-theme=light.
      expect(h.winOptions[0].backgroundColor).toBe('#f6f8fa');
      expect(h.winOptions[0].webPreferences.additionalArguments).toContain('--zcc-theme=light');
      expect(h.controlPlaneDeps.pluginCommands.runCliCommand).toBeTypeOf('function');
    } finally { vi.unstubAllEnvs(); configSpy.mockRestore(); }
    expect(h.mobileStart).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(vi.mocked(console.error).mock.calls.some(call => String(call[0]).includes('mobileGateway.start'))).toBe(true));
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

  it('re-colours the Windows caption buttons on a Theme change and an OS appearance change', () => {
    const platform = process.platform;
    const config = store.getConfig();
    const theme = vi.spyOn(store, 'getConfig');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      h.overlays.length = 0;
      theme.mockReturnValue({ ...config, theme: 'light' });
      ctx().refreshTitleBarOverlays();
      expect(h.overlays).toEqual([{ color: '#f6f8fa', symbolColor: '#57606a', height: 44 }]);
      // Theme System: bootstrap's listener follows the OS.
      theme.mockReturnValue({ ...config, theme: 'system' });
      h.nativeTheme.shouldUseDarkColors = true;
      h.nativeTheme.emit('updated');
      expect(h.overlays.at(-1)).toEqual({ color: '#181818', symbolColor: '#8b949e', height: 44 });
      expect(h.overlays).toHaveLength(2);
    } finally {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
      h.nativeTheme.shouldUseDarkColors = false;
      theme.mockRestore();
    }
  });

  it('applies the browser ownership policy to navigation and redirects without exempting unrelated contents', () => {
    const owned = Object.assign(new h.EventEmitter(), { id: 101, setWindowOpenHandler: vi.fn() });
    const unrelated = Object.assign(new h.EventEmitter(), { id: 102, setWindowOpenHandler: vi.fn() });
    const allow = vi.spyOn(h.browserManager, 'allowsNavigation').mockImplementation((contents, url) =>
      contents === owned && /^https?:\/\//.test(url as string));
    const created = h.appHandlers.get('web-contents-created')![0];
    created({}, owned);
    created({}, unrelated);
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173');
    try {
      for (const eventName of ['will-navigate', 'will-redirect']) {
        for (const [contents, url, blocked] of [
          [owned, 'https://provider.test/callback', false],
          [owned, 'javascript:alert(1)', true],
          [unrelated, 'https://provider.test/callback', true],
          [unrelated, 'http://127.0.0.1:5173/threads/test', false]
        ] as const) {
          const event = { preventDefault: vi.fn() };
          contents.emit(eventName, event, url);
          expect(event.preventDefault).toHaveBeenCalledTimes(blocked ? 1 : 0);
        }
      }
      expect(allow).toHaveBeenCalledWith(owned, 'https://provider.test/callback');
      expect(allow).toHaveBeenCalledWith(unrelated, 'https://provider.test/callback');
      expect(allow).not.toHaveBeenCalledWith(unrelated, 'http://127.0.0.1:5173/threads/test');
    } finally {
      allow.mockRestore();
      vi.unstubAllEnvs();
    }
  });

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
    expect(items.find((i) => i.role === 'pasteAndMatchStyle')).toMatchObject({ accelerator: 'CmdOrCtrl+Shift+V' });
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
    // A user-owned squad target may be the project root itself; anything beyond the project stays rejected.
    const outside = { ...launch, cwd: h.root, trustedPath: h.root };
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
    vi.spyOn(c.teams, 'list').mockReturnValue([{ id: 't1', routingEnforced: true, slots: [{ personaId: 'pa' }, { personaId: 'pb' }, { personaId: 'pc' }], orchestratorPersonaId: 'po' }]);
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
    const routingRecord = {
      id: 'routing-test', teamId: 't1', resolvedModels: [],
      authorizationContext: { slots: [] }
    };
    // Startup dispatch can precede authorization. This must not memoize advisory
    // routing, or the later complete roster would never enforce.
    expect(o.routingEnforcementEnabled(routingRecord)).toBe(false);
    expect(o.routingEnforcementRequested(routingRecord)).toBe(true);
    routingRecord.authorizationContext.slots = [
      { slotId: 'orchestrator:po' }, { slotId: 'worker-1' }
    ];
    routingRecord.resolvedModels = [{ slotId: 'worker-1', provider: 'test', model: 'model', level: 'medium' }];
    expect(o.routingEnforcementEnabled(routingRecord)).toBe(true);
    await o.onTerminal({ id: 'routing-test' });
    routingRecord.resolvedModels = [];
    expect(o.routingEnforcementEnabled(routingRecord)).toBe(false);
    expect(o.routingEnforcementRequested(routingRecord)).toBe(true);
    expect(typeof o.claimRecoveryObserveEnabled()).toBe('boolean');
    expect(typeof o.claimRecoveryEnforceEnabled()).toBe('boolean');
    expect(typeof o.planStartupGraceMs()).toBe('number');
    await expect(o.isPlanCorrectionOpen('no-such-execution')).resolves.toBe(false);
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

  it('forwards the retain option from the exported cancel wrapper and the execution deps to the lifecycle store', async () => {
    const seen: unknown[] = [];
    h.lifecycleOverride.cancelTeamLaunch = async (_c: string, _id: string, opts?: unknown) => {
      seen.push(opts);
      return { ok: true, canceledSessionIds: [], pendingSessionIds: [], lifecycleState: 'cancelled' };
    };
    await host.cancelTeamLaunch('c', 'ok', { retainOrchestrator: true });
    await host.cancelTeamLaunch('c', 'ok');
    expect(seen).toEqual([{ retainOrchestrator: true }, undefined]);
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

  it('checks Modern team models against the ACP runtime and snapshots canonical providers', async () => {
    const c = ctx();
    const o = h.squadOpts;
    vi.spyOn(c.teams, 'list').mockReturnValue([{ id: 'tm', transport: 'MODERN', slots: [{ personaId: 'ma' }, { personaId: 'mb' }], orchestratorPersonaId: 'mo' }]);
    vi.spyOn(c.personas, 'list').mockReturnValue([
      { id: 'ma', name: 'A', baseProfile: 'claude', model: 'sonnet' },
      { id: 'mb', name: 'B', baseProfile: 'opencode', model: 'prov/model-b' },
      { id: 'mo', name: 'O', baseProfile: 'claude' }
    ]);
    const preflight = vi.fn(async () => ({ ready: true, providers: [] }));
    h.runtimeOverride.preflightSquadRuntime = preflight;
    try {
      const request = { teamId: 'tm', workUnits: [], slots: [{ initialTask: 'a' }, { initialTask: 'b' }], coordinationMode: 'durable' };
      const ready = await o.admissionInput(project.id, request);
      expect(preflight).toHaveBeenCalled();
      const [checked] = preflight.mock.calls.at(-1)! as unknown as [{ projectId: string; providerIds: string[]; selections: unknown[] }];
      expect(checked.projectId).toBe(project.id);
      // ACP ids, never CLI harness families: CLI inventories cannot attest ACP model ids.
      expect(checked.providerIds).toContain('claude-code');
      expect(checked.providerIds).not.toContain('claude');
      expect(JSON.stringify(ready)).toContain('available');
      preflight.mockResolvedValue({ ready: false, providers: [] });
      expect(JSON.stringify(await o.admissionInput(project.id, request))).toContain('unavailable');

      const snapshots = await o.resolveTeamModelSnapshots(project.id, { teamId: 'tm', slots: [{ initialTask: 'a' }, { initialTask: 'b' }, { initialTask: 'o' }] });
      expect(snapshots.map((snapshot: { provider: string }) => snapshot.provider)).toEqual(['claude-code', 'acp-opencode', 'claude-code']);
    } finally {
      vi.mocked(c.teams.list).mockRestore();
      vi.mocked(c.personas.list).mockRestore();
      h.runtimeOverride = {};
    }
  });

  it('fences Modern execution bindings and route identities to the exact live member generation', async () => {
    const deps = h.mcpDeps;
    const modern = { executionId: 'e-modern', slotId: '0:w1:0', role: 'worker', authorizationId: 'auth-modern', generation: 3 };
    h.lifecycleOverride.resolveModernBinding = async (sessionId: string, projectId: string) =>
      sessionId === 'modern-1' && projectId === 'p1' ? modern : undefined;
    const live = vi.fn(async () => true);
    h.runtimeOverride.isSquadMemberLive = live;
    const findBinding = vi.spyOn(h.lifecycleStore, 'findModernWorkerBinding');
    try {
      const expected = { executionId: 'e-modern', projectId: 'p1', slotId: '0:w1:0', role: 'worker', principalId: 'modern-1',
        authorizationId: 'auth-modern', memberFence: { bindingId: 'modern-1', generation: 3 } };
      expect(await deps.resolveExecutionCohortBinding('modern-1', 'p1')).toEqual(expected);
      expect(await deps.resolveExecutionCohortBinding('modern-1', 'p1', { bindingId: 'modern-1', generation: 3 })).toEqual(expected);
      // A stale generation or another member's fence never resolves the binding.
      expect(await deps.resolveExecutionCohortBinding('modern-1', 'p1', { bindingId: 'modern-1', generation: 2 })).toBeUndefined();
      expect(await deps.resolveExecutionCohortBinding('modern-1', 'p1', { bindingId: 'modern-2', generation: 3 })).toBeUndefined();
      expect(await deps.resolveExecutionCohortBinding('modern-1', 'p2')).toBeUndefined();
      expect(await deps.resolveExecutionCohortBinding('nobody', 'p1')).toBeUndefined();

      // An exited PTY in the same project falls through to the Modern lookup instead of authorizing.
      h.ptys.sessions.set('pty-exited', sessionFixture({ id: 'pty-exited', status: 'exited',
        cohort: { executionId: 'e-pty', slotId: 's', role: 'worker' } }));
      expect(await deps.resolveExecutionCohortBinding('pty-exited', 'p1')).toBeUndefined();
      expect(await deps.validateExecutionRouteIdentity('pty-exited', 'p1')).toBe(false);

      expect(await deps.validateExecutionRouteIdentity('modern-1', 'p1')).toBe(true);
      expect(live).toHaveBeenCalledWith('modern-1', 'p1', 3);
      live.mockResolvedValueOnce(false);
      expect(await deps.validateExecutionRouteIdentity('modern-1', 'p1')).toBe(false);
      live.mockClear();
      expect(await deps.validateExecutionRouteIdentity('nobody', 'p1')).toBe(false);
      expect(live).not.toHaveBeenCalled();

      // A Modern member is never a launch owner, even if it otherwise looks live.
      findBinding.mockResolvedValueOnce({ generation: 3 } as never);
      expect(await deps.validateLaunchRouteIdentity('modern-1', 'p1')).toBe(false);
    } finally {
      h.ptys.sessions.delete('pty-exited');
      findBinding.mockRestore();
      h.lifecycleOverride = {};
      h.runtimeOverride = {};
    }
  });

  it('resolves and persists host-attested automated MCP catalogues', async () => {
    const resolve = h.mcpDeps.resolveAutomatedMcpCatalogue;
    const executionStore = ctx().executionStore;
    const record = { id: 'execution-1' };
    const binding = { executionId: 'execution-1', projectId: project.id, slotId: 'worker-1', role: 'worker' as const };
    const get = vi.spyOn(executionStore, 'getInProject').mockResolvedValue(record);
    const persist = vi.spyOn(executionStore, 'recordAutomatedMcpCatalogueProvenance').mockImplementation(async (_id: string, _slotId: string, provenance: unknown) => ({
      version: 1 as const, ...(provenance as object)
    }));
    const projects = vi.spyOn(store, 'listProjects').mockReturnValue([{ ...project, remote: undefined }] as never);
    try {
      const local = await resolve(binding);
      expect(local.tools).not.toContain('remote_exec');
      expect(persist).toHaveBeenCalledWith('execution-1', 'worker-1', expect.objectContaining({ role: 'worker', capabilities: [] }));

      projects.mockReturnValue([{ ...project, remote: { host: 'remote.test' } }] as never);
      const remote = await resolve(binding);
      expect(remote.tools).toContain('remote_exec');
      expect(persist).toHaveBeenLastCalledWith('execution-1', 'worker-1', expect.objectContaining({ capabilities: ['remote_fs'] }));

      get.mockResolvedValueOnce({ id: 'execution-1', automatedMcpCatalogueProvenance: {
        'worker-1': { version: 1, role: 'worker', capabilities: [], tools: ['execution.snapshot'], digest: 'a'.repeat(64) }
      } });
      expect(await resolve(binding)).toMatchObject({ tools: ['execution.snapshot'] });
      expect(persist).toHaveBeenCalledTimes(2);

      get.mockResolvedValueOnce({ id: 'execution-1', automatedMcpCatalogueProvenance: {
        'worker-1': { version: 1, role: 'orchestrator', capabilities: [], tools: ['execution.snapshot'], digest: 'a'.repeat(64) }
      } });
      await expect(resolve(binding)).rejects.toThrow('role mismatch');

      get.mockResolvedValueOnce(undefined);
      await expect(resolve(binding)).rejects.toThrow('unavailable');
    } finally {
      get.mockRestore();
      persist.mockRestore();
      projects.mockRestore();
    }
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

  it('maps native approval and interrupt bodies to agent-status transitions', async () => {
    const hook = h.mcpDeps.onNotifyHook;
    h.ptys.sessions.set('cx1', sessionFixture({ id: 'cx1', projectId: project.id, profile: 'codex' }));
    const requested = vi.spyOn(ctx().agentStatus, 'inputRequested');
    const resolved = vi.spyOn(ctx().agentStatus, 'inputResolved');
    const finished = vi.spyOn(ctx().agentStatus, 'turnFinished');
    try {
      const approval = { turn_id: 't1', tool_name: 'Bash', tool_input: { command: 'ls' } };
      hook(project.id, 'cx1', 'blocked', JSON.stringify({ hook_event_name: 'PermissionRequest', ...approval }));
      expect(requested).toHaveBeenCalledWith('cx1', expect.stringMatching(/^approval:t1:Bash:/));
      hook(project.id, 'cx1', 'unblocked', JSON.stringify({ hook_event_name: 'PostToolUse', tool_use_id: 'u1', ...approval }));
      expect(resolved).toHaveBeenCalledWith('cx1', [expect.stringMatching(/^approval:t1:Bash:/)]);
      hook(project.id, 'cx1', 'unblocked', JSON.stringify({ hook_event_name: 'Interrupt' }));
      expect(finished).toHaveBeenCalledWith('cx1');
      await settle();
    } finally {
      for (const spy of [requested, resolved, finished]) spy.mockRestore();
    }
  });

  it('turns a StopFailure notify body into an API-error stop and cancels on new turns', async () => {
    const hook = h.mcpDeps.onNotifyHook;
    const stop = JSON.stringify({ hook_event_name: 'StopFailure', error: 'unknown', error_details: 'Provider anthropic not found' });
    h.ptys.sessions.set('af1', sessionFixture({ id: 'af1', projectId: project.id, profile: 'claude' }));
    h.ptys.sessions.set('af-exited', sessionFixture({ id: 'af-exited', projectId: project.id, profile: 'claude', status: 'exited' }));
    const onStop = vi.spyOn(ctx().apiErrorResume, 'onApiErrorStop').mockResolvedValue(undefined);
    const cancel = vi.spyOn(ctx().apiErrorResume, 'cancel');
    const turnFinished = vi.spyOn(ctx().agentStatus, 'turnFinished');
    const clearTools = vi.spyOn(ctx().agentStatus, 'clearToolsInFlight');
    const schedulerDone = vi.spyOn(ctx().scheduler, 'onAgentFinished');
    const goalsDone = vi.spyOn(ctx().goals, 'onAgentFinished');
    try {
      hook(project.id, 'af1', 'unblocked', stop);
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(onStop).toHaveBeenCalledWith('af1', expect.objectContaining({ text: expect.stringContaining('Provider anthropic') }));
      expect(turnFinished).toHaveBeenCalledWith('af1');
      expect(clearTools).toHaveBeenCalledWith('af1');
      // An errored turn is not a finished run: the scheduler and goals stay out of it.
      expect(schedulerDone).not.toHaveBeenCalled();
      expect(goalsDone).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
      hook('other-project', 'af1', 'unblocked', stop);
      hook(project.id, 'af-exited', 'unblocked', stop);
      // A body that isn't a StopFailure maps to no interaction event: nothing happens.
      hook(project.id, 'af1', 'unblocked', JSON.stringify({ hook_event_name: 'Stop' }));
      expect(onStop).toHaveBeenCalledTimes(1);
      // Blocked on a person is not a new turn, so a pending resume stays armed.
      hook(project.id, 'af1', 'blocked');
      expect(cancel).not.toHaveBeenCalled();
      // A new turn (no body) cancels a pending resume; so does a lifecycle Stop.
      hook(project.id, 'af1', 'unblocked');
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenLastCalledWith('af1');
      h.mcpDeps.onStopHook(project.id, 'af1');
      expect(cancel).toHaveBeenCalledTimes(2);
      expect(cancel).toHaveBeenLastCalledWith('af1');
      await settle();
    } finally {
      for (const spy of [onStop, cancel, turnFinished, clearTools, schedulerDone, goalsDone]) spy.mockRestore();
    }
  });

  it('forgets resume state on pty exit and exposes the service to IPC', async () => {
    const forget = vi.spyOn(ctx().apiErrorResume, 'forget');
    try {
      h.ptys.sessions.set('af2', sessionFixture({ id: 'af2' }));
      h.ptys.emit('exit', 'af2', 0);
      await settle();
      expect(forget).toHaveBeenCalledWith('af2');
    } finally {
      forget.mockRestore();
    }
    expect(ctx().apiErrorResume.check).toBeTypeOf('function');
    expect(await ctx().apiErrorResume.check('nothing', [])).toEqual({ ruleId: null, skipped: [] });
  });

  it('feeds agent status to the wrap-up service, forgets it on exit and exposes it to IPC', async () => {
    const observe = vi.spyOn(ctx().wrapUpClose, 'observe');
    const forget = vi.spyOn(ctx().wrapUpClose, 'forget');
    try {
      h.ptys.sessions.set('wu1', sessionFixture({ id: 'wu1', projectId: project.id, profile: 'claude' }));
      ctx().agentStatus.emit('status', 'wu1', 'working', 1);
      expect(observe).toHaveBeenCalledWith('wu1', 'working');
      h.ptys.emit('exit', 'wu1', 0);
      await settle();
      expect(forget).toHaveBeenCalledWith('wu1');
    } finally {
      observe.mockRestore();
      forget.mockRestore();
    }
    expect(ctx().wrapUpClose.run).toBeTypeOf('function');
  });

  it('spares an agent from auto-close while it is wrapping up', async () => {
    h.ptys.sessions.set('wu2', sessionFixture({ id: 'wu2', projectId: project.id, profile: 'claude' }));
    const config = store.getConfig();
    const cfg = vi.spyOn(store, 'getConfig').mockReturnValue({ ...config, autoCloseIdleEnabled: true });
    const wrapping = vi.spyOn(ctx().wrapUpClose, 'isWrappingUp').mockReturnValue(true);
    try {
      const eligible = () => (ctx().autoCloseIdle as any).eligible('wu2') as boolean;
      expect(eligible()).toBe(false);
      wrapping.mockReturnValue(false);
      expect(eligible()).toBe(true);
    } finally {
      wrapping.mockRestore();
      cfg.mockRestore();
    }
  });

  it('keeps heartbeat nudges away from an agent while it is wrapping up', async () => {
    h.ptys.sessions.set('wu3', sessionFixture({ id: 'wu3', projectId: project.id, profile: 'claude', heartbeat: true } as never));
    const config = store.getConfig();
    const cfg = vi.spyOn(store, 'getConfig').mockReturnValue({ ...config, heartbeatEnabled: true });
    const wrapping = vi.spyOn(ctx().wrapUpClose, 'isWrappingUp').mockReturnValue(true);
    try {
      const eligible = () => (ctx().heartbeat as any).eligible('wu3') as boolean;
      expect(eligible()).toBe(false);
      wrapping.mockReturnValue(false);
      expect(eligible()).toBe(true);
    } finally {
      wrapping.mockRestore();
      cfg.mockRestore();
    }
  });

  it('tells the wrap-up service when an API error ends a Claude turn', async () => {
    h.ptys.sessions.set('wu5', sessionFixture({ id: 'wu5', projectId: project.id, profile: 'claude' }));
    const failed = vi.spyOn(ctx().wrapUpClose, 'onTurnFailed');
    try {
      const body = JSON.stringify({ hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429 slow down' });
      h.mcpDeps.onNotifyHook(project.id, 'wu5', 'unblocked', body);
      expect(failed).toHaveBeenCalledWith('wu5');
      await settle();
    } finally {
      failed.mockRestore();
    }
  });

  it('holds peer messages and mail for an agent while it wraps up', async () => {
    h.ptys.sessions.set('wu6', sessionFixture({ id: 'wu6', projectId: project.id, profile: 'claude' }));
    const reply = vi.fn(() => true);
    h.ptys.reply = reply;
    const wrapping = vi.spyOn(ctx().wrapUpClose, 'isWrappingUp').mockReturnValue(true);
    const pull = vi.spyOn(h.mcpDeps.agentMessageLog, 'pull');
    try {
      expect(h.mcpDeps.injectToSession('wu6', 'hello')).toBe(false);
      expect(reply).not.toHaveBeenCalled();
      ctx().agentStatus.emit('status', 'wu6', 'working', 1);
      ctx().agentStatus.emit('status', 'wu6', 'idle', 2);
      expect(pull).not.toHaveBeenCalledWith('wu6');
      wrapping.mockReturnValue(false);
      expect(h.mcpDeps.injectToSession('wu6', 'hello')).toBe(true);
      expect(reply).toHaveBeenCalledWith('wu6', 'hello');
      ctx().agentStatus.emit('status', 'wu6', 'working', 3);
      ctx().agentStatus.emit('status', 'wu6', 'idle', 4);
      expect(pull).toHaveBeenCalledWith('wu6');
      await settle();
    } finally {
      pull.mockRestore();
      wrapping.mockRestore();
      delete (h.ptys as { reply?: unknown }).reply;
    }
  });

  it('tells the wrap-up service when a Claude turn starts and stops', async () => {
    h.ptys.sessions.set('wu4', sessionFixture({ id: 'wu4', projectId: project.id, profile: 'claude' }));
    const started = vi.spyOn(ctx().wrapUpClose, 'onTurnStarted');
    const finished = vi.spyOn(ctx().wrapUpClose, 'onTurnFinished');
    try {
      h.mcpDeps.onNotifyHook(project.id, 'wu4', 'unblocked');
      expect(started).toHaveBeenCalledWith('wu4');
      h.mcpDeps.onNotifyHook(project.id, 'wu4', 'blocked');
      expect(started).toHaveBeenCalledTimes(1);
      h.mcpDeps.onStopHook(project.id, 'wu4');
      expect(finished).toHaveBeenCalledWith('wu4');
      await settle();
    } finally {
      started.mockRestore();
      finished.mockRestore();
    }
  });

  describe('Squad worker API-error recovery routing', () => {
    const workerCohort = { executionId: 'e-api', role: 'worker', slotId: 'sl-api', cohortId: 'c-api', teamId: 't', teamName: 'T' };
    const stopBody = JSON.stringify({ hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429 slow down' });
    const claimRecovery = (on: boolean) => {
      const config = store.getConfig();
      return vi.spyOn(store, 'getConfig').mockReturnValue({
        ...config, executionClaimRecoveryObserveEnabled: on, executionClaimRecoveryEnforceEnabled: on
      });
    };

    it('sends a worker StopFailure to the engine and a plain session to the resume rules', async () => {
      h.ptys.sessions.set('api-w', sessionFixture({ id: 'api-w', projectId: project.id, profile: 'claude', cohort: workerCohort }));
      h.ptys.sessions.set('api-p', sessionFixture({ id: 'api-p', projectId: project.id, profile: 'claude' }));
      const cfg = claimRecovery(true);
      const engine = vi.spyOn(ctx().workerApiErrorRecovery, 'onApiErrorStop').mockResolvedValue(undefined);
      const resume = vi.spyOn(ctx().apiErrorResume, 'onApiErrorStop').mockResolvedValue(undefined);
      const turnFinished = vi.spyOn(ctx().agentStatus, 'turnFinished');
      try {
        h.mcpDeps.onNotifyHook(project.id, 'api-w', 'unblocked', stopBody);
        expect(engine).toHaveBeenCalledWith('api-w', { executionId: 'e-api', slotId: 'sl-api' },
          expect.objectContaining({ error: 'rate_limit', retryable: true }));
        expect(resume).not.toHaveBeenCalled();
        expect(turnFinished).toHaveBeenCalledWith('api-w');
        h.mcpDeps.onNotifyHook(project.id, 'api-p', 'unblocked', stopBody);
        expect(resume).toHaveBeenCalledTimes(1);
        expect(engine).toHaveBeenCalledTimes(1);
        await settle();
      } finally {
        for (const spy of [cfg, engine, resume, turnFinished]) spy.mockRestore();
      }
    });

    it('keeps a worker on the resume rules when claim recovery is disabled', async () => {
      h.ptys.sessions.set('api-off', sessionFixture({ id: 'api-off', projectId: project.id, profile: 'claude', cohort: workerCohort }));
      const cfg = claimRecovery(false);
      const engine = vi.spyOn(ctx().workerApiErrorRecovery, 'onApiErrorStop').mockResolvedValue(undefined);
      const resume = vi.spyOn(ctx().apiErrorResume, 'onApiErrorStop').mockResolvedValue(undefined);
      try {
        h.mcpDeps.onNotifyHook(project.id, 'api-off', 'unblocked', stopBody);
        expect(resume).toHaveBeenCalledTimes(1);
        expect(engine).not.toHaveBeenCalled();
        await settle();
      } finally {
        for (const spy of [cfg, engine, resume]) spy.mockRestore();
      }
    });

    it('reads the claim-recovery switches from the live config', async () => {
      const cfg = claimRecovery(false);
      try {
        await expect(ctx().workerApiErrorRecovery.onApiErrorStop('api-cfg', { executionId: 'e-api', slotId: 'sl-api' }, { error: 'x', text: '' }))
          .resolves.toBeUndefined();
        expect(cfg).toHaveBeenCalled();
      } finally {
        cfg.mockRestore();
      }
    });

    it('tells the engine a turn started, with the state the session was in before it', async () => {
      h.ptys.sessions.set('api-turn', sessionFixture({ id: 'api-turn', projectId: project.id, profile: 'claude', cohort: workerCohort }));
      const started = vi.spyOn(ctx().workerApiErrorRecovery, 'onTurnStarted');
      const state = vi.spyOn(ctx().agentStatus, 'get').mockReturnValue('idle');
      const turnStarted = vi.spyOn(ctx().agentStatus, 'turnStarted');
      try {
        h.mcpDeps.onNotifyHook(project.id, 'api-turn', 'unblocked');
        expect(started).toHaveBeenCalledWith('api-turn', 'idle');
        expect(started.mock.invocationCallOrder[0]).toBeLessThan(turnStarted.mock.invocationCallOrder[0]);
      } finally {
        for (const spy of [started, state, turnStarted]) spy.mockRestore();
      }
    });

    it('refuses to restart a session the terminal layer does not know', async () => {
      await expect(ctx().squadWorkerRestarter.restart('no-such-session')).resolves.toEqual({ ok: false, reason: 'not-found' });
    });

    it('forgets the session on exit', async () => {
      const forget = vi.spyOn(ctx().workerApiErrorRecovery, 'forget');
      try {
        h.ptys.sessions.set('api-exit', sessionFixture({ id: 'api-exit' }));
        h.ptys.emit('exit', 'api-exit', 0);
        await settle();
        expect(forget).toHaveBeenCalledWith('api-exit');
      } finally {
        forget.mockRestore();
      }
    });
  });

  describe('Squad worker exit and in-place restart', () => {
    const workerCohort = { executionId: 'e-restart', role: 'worker', slotId: 'sl', cohortId: 'c-restart', teamId: 't', teamName: 'T' };
    const spies = () => {
      const c = ctx();
      return {
        recover: vi.spyOn(c.squadExecutionService, 'recoverExitedWorker').mockResolvedValue(undefined),
        lifecycle: vi.spyOn(h.lifecycleIntegration, 'onSessionExit').mockResolvedValue(undefined)
      };
    };
    const makeWorker = (id: string, capabilityId?: string, stored = true) => {
      if (capabilityId && stored) {
        ctx().restoreCapabilities.put({
          id: capabilityId, request: { projectId: project.id, cols: 80, rows: 24, profile: 'shell', personaId: 'p-worker', cohort: workerCohort },
          sessionId: id, sessionProfile: 'shell', sessionTitle: 'T', createdAt: Date.now()
        });
      }
      h.ptys.sessions.set(id, sessionFixture({ id, cohort: workerCohort, ...(capabilityId ? { restoreCapabilityId: capabilityId } : {}) }));
    };

    it('still recovers the worker on a normal exit', async () => {
      const { recover, lifecycle } = spies();
      try {
        makeWorker('wr-normal');
        h.ptys.emit('exit', 'wr-normal', 0);
        await settle();
        expect(lifecycle).toHaveBeenCalledWith('wr-normal', expect.anything());
        expect(recover).toHaveBeenCalledWith('e-restart', 'sl');
      } finally { recover.mockRestore(); lifecycle.mockRestore(); }
    });

    it('holds the engine back while a restart relaunches the worker', async () => {
      const { recover, lifecycle } = spies();
      try {
        makeWorker('wr-ok', 'cap-wr-ok');
        const restarted = ctx().squadWorkerRestarter.restart('wr-ok');
        await settle();
        h.ptys.emit('exit', 'wr-ok', 0);
        expect(await restarted).toEqual({ ok: true });
        expect(h.ptys.createCalls.at(-1)).toMatchObject({ preallocatedSessionId: 'wr-ok' });
        expect(lifecycle).not.toHaveBeenCalled();
        expect(recover).not.toHaveBeenCalled();
      } finally { recover.mockRestore(); lifecycle.mockRestore(); }
    });

    it('tells the engine the worker is gone when the relaunch fails', async () => {
      const { recover, lifecycle } = spies();
      try {
        makeWorker('wr-fail', 'cap-unstored', false);
        const restarted = ctx().squadWorkerRestarter.restart('wr-fail');
        await settle();
        h.ptys.emit('exit', 'wr-fail', 0);
        expect(await restarted).toMatchObject({ ok: false, reason: 'relaunch-failed' });
        await settle();
        expect(lifecycle).toHaveBeenCalledWith('wr-fail', expect.anything());
        expect(recover).toHaveBeenCalledWith('e-restart', 'sl');
      } finally { recover.mockRestore(); lifecycle.mockRestore(); }
    });
  });

  it('spares an agent that rested on an API error from auto-close until its next turn', async () => {
    h.ptys.sessions.set('af3', sessionFixture({ id: 'af3', projectId: project.id, profile: 'claude' }));
    const config = store.getConfig();
    const cfg = vi.spyOn(store, 'getConfig').mockReturnValue({ ...config, autoCloseIdleEnabled: true });
    try {
      const eligible = () => (ctx().autoCloseIdle as any).eligible('af3') as boolean;
      expect(eligible()).toBe(true);
      await ctx().apiErrorResume.onApiErrorStop('af3', { error: 'x', text: 'y' });
      expect(eligible()).toBe(false);
      ctx().apiErrorResume.cancel('af3');
      expect(eligible()).toBe(true);
      // A favourite is spared on its own, keyed by its Claude session id.
      h.ptys.sessions.set('af4', sessionFixture({ id: 'af4', projectId: project.id, profile: 'claude', claudeSessionId: 'cs-fav' }));
      const favourites = ctx().favoriteAgentKeys;
      ctx().favoriteAgentKeys = new Set(['cs-fav']);
      try {
        expect((ctx().autoCloseIdle as any).eligible('af4')).toBe(false);
      } finally {
        ctx().favoriteAgentKeys = favourites;
      }
    } finally {
      cfg.mockRestore();
    }
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

  it('resolves the local host id through dev-attach call sites', async () => {
    const prev = process.env.ELECTRON_RENDERER_URL;
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    try {
      // Dev attach with no supervisor reads the persisted host id (none on disk -> undefined).
      expect(ctx().projectPathToOptions(project.path)).toBeDefined();
      // Feed store keys cache by `project.hostId ?? primaryHostId()`.
      await ctx().feedStore.list(project.id).catch(() => undefined);
      // Catalogue sources consult primaryHostId only for projects pinned to a host.
      const spy = vi.spyOn(store, 'listProjects').mockReturnValue([{ ...project, hostId: 'other-host' } as never]);
      try { for (const s of [ctx().personas, ctx().teams, ctx().templates]) { s.refresh(); s.list(); } } finally { spy.mockRestore(); }
      // Background launches run the host guard for the resolved local host.
      const principal = { kind: 'automation', id: 'automation:bg' };
      await expect(h.goalDeps.launchTerminal({ projectId: 'no-such-project', profile: 'shell', cols: 1, rows: 1 }, principal)).rejects.toThrow();
      await h.goalDeps.launchTerminal({ projectId: project.id, profile: 'shell', cols: 80, rows: 24 }, principal).catch(() => undefined);
      // Triggered squads run the team host guard before the orchestrator check.
      vi.spyOn(ctx().teams, 'list').mockReturnValue([{ id: 'tm1' }] as never);
      await expect(h.goalDeps.launchSquad({
        goal: { id: 'g', title: 'G', statement: 's', assignment: { teamId: 'tm1' } }, project: { id: project.id }, iterationId: 'i'
      })).rejects.toThrow(/orchestrator/);
      vi.mocked(ctx().teams.list).mockRestore();
    } finally {
      if (prev === undefined) delete process.env.ELECTRON_RENDERER_URL; else process.env.ELECTRON_RENDERER_URL = prev;
    }
  });

  it('flushes blocker notices at boot and isolates later failures', async () => {
    const flushBlockerNotices = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    const logError = vi.fn();
    const flush = await host.flushBlockerNoticesAtBoot({ flushBlockerNotices }, logError);
    flush();
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith('execution.flushBlockerNotices', expect.objectContaining({ message: 'offline' })));
  });

  it('routes OS deep links and second-instance argv to the deep link host', async () => {
    const preventDefault = vi.fn();
    const [openUrl] = h.appHandlers.get('open-url')!;
    openUrl({ preventDefault }, 'zana-dev://plugin/design-docs/peer/join?d=abc');
    openUrl({ preventDefault }, 'https://not-a-deep-link.example/');
    expect(preventDefault).toHaveBeenCalledTimes(2);
    const second = h.appHandlers.get('second-instance')!;
    expect(second.length).toBeGreaterThan(0);
    for (const handler of second) {
      handler({}, ['app', 'zana-dev://plugin/design-docs/peer/join?d=def']);
      handler({}, ['app', '--no-link']);
    }
    await settle();
  });

  it('delivers an armed deep link to the ready main window and logs delivery failures', async () => {
    const errors = vi.mocked(console.error);
    const link = 'zana-dev://plugin/design-docs/peer/join?d=ready';
    const [openUrl] = h.appHandlers.get('open-url')!;
    const deliveries = () => h.sent.filter(([channel, d]) => channel === IPC.deepLinks.onLink && (d as any).payload === 'ready');

    // Ready window: link is sent to the renderer.
    ctx().markRendererReady(h.lastWin);
    h.sent.length = 0;
    openUrl({ preventDefault: vi.fn() }, link);
    await vi.waitFor(() => expect(deliveries()).toHaveLength(1));
    expect(deliveries()[0][1]).toMatchObject({ pluginId: 'design-docs', route: 'peer/join' });

    // Window dies between readiness and send.
    const alive = h.contentsDestroyed;
    h.contentsDestroyed = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    errors.mockClear();
    openUrl({ preventDefault: vi.fn() }, link);
    await vi.waitFor(() => expect(errors.mock.calls.some(c => String(c[0]).includes('deepLink.deliver'))).toBe(true));
    expect(deliveries()).toHaveLength(1);

    // Window never becomes ready.
    h.contentsDestroyed = () => true;
    errors.mockClear();
    openUrl({ preventDefault: vi.fn() }, link);
    await vi.waitFor(() => expect(errors.mock.calls.some(c => String(c[0]).includes('deepLink.deliver'))).toBe(true));
    expect(deliveries()).toHaveLength(1);
    h.contentsDestroyed = alive;
  });

  it('quits without confirmation when configured and releases services and timers', async () => {
    const config = store.getConfig();
    vi.spyOn(store, 'getConfig').mockReturnValue({ ...config, confirmQuitOnLiveSessions: false });
    const beforeQuit = h.appHandlers.get('before-quit')![0];
    beforeQuit({ preventDefault: vi.fn() });
    await settle();
    expect(() => beforeQuit({ preventDefault: vi.fn() })).not.toThrow();
    // The caption-button theme listener is released.
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      h.overlays.length = 0;
      h.nativeTheme.emit('updated');
      expect(h.overlays).toEqual([]);
    } finally {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    }
  });

  it('connects bulk plugin updates to the production supervisor', async () => {
    const value = { updated: ['fixture'], failed: [] };
    const updateAllPlugins = vi.fn(async () => value);
    const noop = () => () => {};
    h.runtimeStart = new Proxy({
      rendererUrl: 'http://127.0.0.1:1/', hostUrl: 'http://127.0.0.1:1', hostId: 'host-test',
      updateAllPlugins, listProjects: async () => [], close: async () => {},
      publishProductEvent: async () => {}
    }, { get: (target, key) => key === 'then' ? undefined : key in target ? target[key as keyof typeof target] : noop });
    vi.resetModules();
    h.appHandlers.clear();
    h.controlPlaneDeps = undefined;
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    delete process.env.ELECTRON_RENDERER_URL;
    try {
      await import('../host.js');
      h.ready!();
      await vi.waitFor(() => expect(h.controlPlaneDeps?.pluginHost, JSON.stringify(vi.mocked(console.error).mock.calls)).toBeDefined(), { timeout: 20000 });
      await expect(h.controlPlaneDeps.pluginHost.updateAll()).resolves.toEqual(value);
      expect(updateAllPlugins).toHaveBeenCalledOnce();
      updateAllPlugins.mockRejectedValueOnce(new Error('plugin host stopped'));
      await expect(h.controlPlaneDeps.pluginHost.updateAll()).rejects.toThrow('plugin host stopped');
    } finally {
      h.appHandlers.get('before-quit')?.[0]?.({ preventDefault: vi.fn() });
      await settle();
      h.runtimeStart = undefined;
      if (rendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL;
      else process.env.ELECTRON_RENDERER_URL = rendererUrl;
    }
  }, 30000);
});
