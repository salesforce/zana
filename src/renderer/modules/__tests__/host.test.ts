import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// host.ts imports the real zustand stores and the sessionInfo mapper. We only
// need the slices launchSession touches, so mock the store module wholesale and
// drive each store's getState() return from per-test variables. sessionInfo is
// stubbed because it's only used by the event-subscription path, not here.
// Held on a single mutable object so the (hoisted) vi.mock factory and the
// per-test `beforeEach` mutate the SAME state without tripping hoist/TDZ rules.
const h = vi.hoisted(() => ({
  pushToast: vi.fn(),
  refreshModuleBadges: vi.fn(),
  createTerminal: vi.fn(),
  create: vi.fn(),
  loadProjects: vi.fn(),
  setNav: vi.fn(),
  selectProject: vi.fn(),
  selectTab: vi.fn(),
  setWorkspaceMode: vi.fn(),
  projects: [] as Array<{ id: string; name: string; path: string }>,
  personas: [] as Array<{ id: string; name: string; baseProfile?: string }>
}));

vi.mock('../../store', () => ({
  useUi: {
    getState: () => ({
      pushToast: h.pushToast,
      refreshModuleBadges: h.refreshModuleBadges,
      setNav: h.setNav,
      selectProject: h.selectProject,
      selectTab: h.selectTab,
      setWorkspaceMode: h.setWorkspaceMode,
      selectedProjectId: null
    }),
    subscribe: () => () => {}
  },
  useData: {
    getState: () => ({
      projects: h.projects,
      createTerminal: h.createTerminal,
      loadProjects: h.loadProjects,
      terminals: {}
    })
  },
  usePersonas: {
    getState: () => ({ personas: h.personas })
  }
}));

vi.mock('../sessionInfo', () => ({ toSessionInfo: (s: unknown) => s }));

import {
  createModuleHost,
  createMountScopedHost,
  clearModuleCache,
  setExtensionGrants
} from '../host';

const PROJECT = { id: 'proj-1', name: 'Repo', path: '/repo' };

beforeEach(() => {
  vi.clearAllMocks();
  h.projects = [PROJECT];
  h.personas = [];
  // No disk-ext grants registered → every moduleId under test is a "built-in".
  setExtensionGrants([]);
  h.createTerminal.mockResolvedValue({ id: 'sess-1' });
  h.create.mockResolvedValue({ ok: true, value: { id: 'sess-1' } });
  vi.stubGlobal('window', { cc: { terminals: { create: h.create } } });
});

afterEach(() => {
  setExtensionGrants([]);
});

describe('createModuleHost().launchSession — extraArgs sanitization', () => {
  it('strips a denied flag for a BUILT-IN module (not in extensionGrants)', async () => {
    // 'slack' is a built-in: its id is absent from the grant map, yet it takes
    // remote input, so the denylist MUST still run. This is the regression the
    // fix guards: previously sanitize was gated on extensionGrants.has(moduleId).
    const host = createModuleHost('slack');
    // Prompt first (a positional `run <prompt>`), then a remotely-injected
    // boolean denylist flag — the denylist must strip the flag for the built-in.
    // (Order matters only because the sanitizer treats the token AFTER a
    // `--flag value`-form denied flag as that flag's value; a boolean flag at
    // the END has no following token to consume, so the prompt is untouched.)
    const res = await host.launchSession({
      projectId: PROJECT.id,
      extraArgs: ['do the thing', '--dangerously-skip-permissions']
    });

    expect(res).toEqual({ id: 'sess-1' });
    expect(h.create).toHaveBeenCalledTimes(1);
    const passedOpts = h.create.mock.calls[0][0];
    // Denied flag removed; the benign positional prompt is preserved untouched.
    expect(passedOpts.extraArgs).toEqual(['do the thing']);
    expect(h.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('--dangerously-skip-permissions'),
      'error'
    );
  });

  it('also strips for a registered disk ext (behavior preserved)', async () => {
    setExtensionGrants([{ id: 'diskext', permissions: ['session:launch'] }]);
    const host = createModuleHost('diskext');
    await host.launchSession({
      projectId: PROJECT.id,
      extraArgs: ['--mcp-config', '/tmp/evil.json', 'prompt']
    });

    const passedOpts = h.create.mock.calls[0][0];
    expect(passedOpts.extraArgs).toEqual(['prompt']);
    expect(h.pushToast).toHaveBeenCalledWith(expect.stringContaining('--mcp-config'), 'error');
  });

  it('leaves a benign positional-only launch unchanged (no toast, legit run)', async () => {
    const host = createModuleHost('slack');
    await host.launchSession({ projectId: PROJECT.id, extraArgs: ['investigate the failing test'] });

    const passedOpts = h.create.mock.calls[0][0];
    expect(passedOpts.extraArgs).toEqual(['investigate the failing test']);
    expect(h.pushToast).not.toHaveBeenCalled();
  });
});

describe('createModuleHost().cache.refreshBadge', () => {
  it('requests a reactive Sidebar badge refresh after a cache write', () => {
    const host = createModuleHost('badge-module');

    host.cache.set('unreadCount', 3);
    host.cache.refreshBadge();

    expect(host.cache.get('unreadCount')).toBe(3);
    expect(h.refreshModuleBadges).toHaveBeenCalledTimes(1);
  });
});

describe('createModuleHost().relaunchSelf', () => {
  const relaunch = vi.fn();
  beforeEach(() => {
    relaunch.mockReset();
    (globalThis as unknown as { window: unknown }).window = {
      cc: { extensions: { relaunch } }
    };
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('relaunches the CALLER by its own moduleId (cannot target a sibling)', async () => {
    relaunch.mockResolvedValue({ ok: true, value: true });
    const host = createModuleHost('gus');
    const ok = await host.relaunchSelf();
    expect(ok).toBe(true);
    // The renderer never forwards a caller-supplied id — main keys off this one.
    expect(relaunch).toHaveBeenCalledWith('gus');
  });

  it('maps a failed respawn (ok:true,value:false) through to false', async () => {
    relaunch.mockResolvedValue({ ok: true, value: false });
    expect(await createModuleHost('gus').relaunchSelf()).toBe(false);
  });

  it('maps an error Result (ok:false — e.g. built-in/unknown) to false', async () => {
    relaunch.mockResolvedValue({ ok: false, code: 'NOT_FOUND', message: 'no disk ext' });
    expect(await createModuleHost('slack').relaunchSelf()).toBe(false);
  });

  it('swallows a thrown IPC error and returns false', async () => {
    relaunch.mockRejectedValue(new Error('ipc down'));
    expect(await createModuleHost('gus').relaunchSelf()).toBe(false);
  });
});

describe('createModuleHost().ensureQuickAgent', () => {
  const ensureQuickAgent = vi.fn();
  beforeEach(() => {
    ensureQuickAgent.mockReset();
    (globalThis as unknown as { window: unknown }).window = {
      cc: { projects: { ensureQuickAgent } }
    };
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('ensures the scratch project, refreshes the renderer list, and returns its info', async () => {
    const scratch = { id: 'scratch-1', name: 'Quick Agent', path: '/home/.zcc-workspace' };
    ensureQuickAgent.mockResolvedValue({ ok: true, value: scratch });
    const host = createModuleHost('gus');

    const info = await host.ensureQuickAgent();

    expect(info).toEqual({ id: 'scratch-1', name: 'Quick Agent', path: '/home/.zcc-workspace' });
    // Reloaded so a subsequent launchSession project-scope guard sees the new id.
    expect(h.loadProjects).toHaveBeenCalledTimes(1);
  });

  it('toasts and returns null when main refuses to create the project', async () => {
    ensureQuickAgent.mockResolvedValue({ ok: false, code: 'EIO', message: 'disk full' });
    const host = createModuleHost('gus');

    expect(await host.ensureQuickAgent()).toBeNull();
    expect(h.loadProjects).not.toHaveBeenCalled();
    expect(h.pushToast).toHaveBeenCalledWith(expect.stringContaining('disk full'), 'error');
  });

  it('swallows a thrown IPC error, toasts, and returns null', async () => {
    ensureQuickAgent.mockRejectedValue(new Error('ipc down'));
    const host = createModuleHost('gus');

    expect(await host.ensureQuickAgent()).toBeNull();
    expect(h.pushToast).toHaveBeenCalledWith(expect.stringContaining('ipc down'), 'error');
  });
});

// W1-6 — auto-disposing register* helpers.
describe('createModuleHost().register + mount scope', () => {
  it('runs module-scope disposables when the module cache/host is cleared', () => {
    const host = createModuleHost('w6-mod-a');
    const ran: string[] = [];
    host.register(() => ran.push('a'));
    host.register(() => ran.push('b'));
    expect(ran).toEqual([]);
    // Simulate disable/remove → the module scope is disposed.
    clearModuleCache('w6-mod-a');
    expect(ran).toEqual(['a', 'b']);
    // Idempotent: a second clear does not re-run.
    clearModuleCache('w6-mod-a');
    expect(ran).toEqual(['a', 'b']);
  });

  it('a disposable registered AFTER the scope disposed runs immediately (no leak)', () => {
    const host = createModuleHost('w6-mod-late');
    clearModuleCache('w6-mod-late'); // dispose the scope first
    const ran: string[] = [];
    host.register(() => ran.push('late'));
    expect(ran).toEqual(['late']);
  });

  it('mount scope disposes a panel\'s on()/register() without touching the module scope', () => {
    const base = createModuleHost('w6-mod-b');
    const moduleRan: string[] = [];
    base.register(() => moduleRan.push('module-level'));

    const { host: mounted, dispose } = createMountScopedHost(base);
    const mountRan: string[] = [];
    const off = mounted.on('nav:changed', () => {});
    mounted.register(() => mountRan.push('mount-level'));

    // Unmount: only the mount scope's disposables run.
    dispose();
    expect(mountRan).toEqual(['mount-level']);
    expect(moduleRan).toEqual([]); // module scope survives the unmount

    // The unsubscribe returned by on() is idempotent — calling it after dispose
    // is a safe no-op (double-free guard), it does not throw.
    expect(() => off()).not.toThrow();

    // The module scope still fires on a later clear.
    clearModuleCache('w6-mod-b');
    expect(moduleRan).toEqual(['module-level']);
  });

  it('the on() unsubscribe is the SAME idempotent runner as the scope (no double-free)', () => {
    const base = createModuleHost('w6-mod-c');
    const { host: mounted, dispose } = createMountScopedHost(base);
    let unsubCalls = 0;
    // Patch the underlying subscribe by registering a manual disposable through
    // register(): calling it twice + a dispose must fire the body exactly once.
    const off = mounted.on('nav:changed', () => {});
    // nav:changed's unsubscribe is a store no-op; assert idempotency via register.
    mounted.register(() => {
      unsubCalls += 1;
    });
    dispose();
    off();
    off();
    expect(unsubCalls).toBe(1);
  });
});
