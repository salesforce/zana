import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Module-load wiring of deep links in host.ts that depends on the environment at
 * import time: which single-instance branch runs, OS scheme registration and its
 * failure log, and cold-start argv links. Each case re-imports host.ts.
 */
const h = vi.hoisted(() => ({
  handlers: new Map<string, ((...a: any[]) => any)[]>(),
  lock: true,
  protocolResult: true,
  protocolCalls: [] as unknown[][],
  quit: vi.fn(),
  lockCalls: 0,
  whenReady: vi.fn(),
  windowsCreated: 0
}));

vi.mock('@zana-ai/zcc-host-daemon/pty', () => ({ PtyManager: class { setMcpBaseUrl() {} setProjectRoots() {} setRulesResolver() {} }, isClaudeProfile: () => false }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => [], getConfig: () => ({}), getProjectSettings: () => ({}) }, scratchWorkspaceRoot: () => '/tmp', worktreeRoot: () => '/tmp', worktreeTargetDir: () => '/tmp' }));
vi.mock('electron', () => {
  class BrowserWindow {
    static getAllWindows() { return []; }
    static getFocusedWindow() { return null; }
    constructor() {
      h.windowsCreated++;
      const loose = (): any => new Proxy(function () {}, { get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : loose()), apply: () => loose() });
      const fallback = { get: (t: Record<string, unknown>, k: string | symbol) => (k in t ? t[k as string] : loose()) };
      return new Proxy({ id: 1, isDestroyed: () => false, isMinimized: () => false, webContents: new Proxy({ id: 2, isDestroyed: () => false }, fallback) }, fallback);
    }
  }
  return {
    safeStorage: { isEncryptionAvailable: () => false },
    app: {
      isPackaged: false,
      on: (name: string, fn: (...a: any[]) => any) => { h.handlers.set(name, [...(h.handlers.get(name) ?? []), fn]); },
      whenReady: () => { h.whenReady(); return { then: () => {} }; },
      getPath: () => '/tmp',
      setName: () => {},
      requestSingleInstanceLock: () => { h.lockCalls++; return h.lock; },
      setAsDefaultProtocolClient: (...args: unknown[]) => { h.protocolCalls.push(args); return h.protocolResult; },
      quit: () => { h.quit(); },
      dock: undefined
    },
    BrowserWindow,
    ipcMain: { handle: () => {}, on: () => {} },
    dialog: {}, shell: {},
    screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }), on: () => {} },
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true, setTemplateImage: () => {}, resize: () => ({}) }), createEmpty: () => ({ isEmpty: () => true }) },
    powerMonitor: { on: () => {} }
  };
});
vi.mock('../updater.js', () => ({ createUpdater: () => ({}) }));
vi.mock('../test-tap.js', () => ({ record: () => {}, recordLog: () => {}, isEnabled: () => false, enable: () => {}, drain: () => ({ entries: [], cursor: 0 }), snapshot: () => ({ entries: [] }), reset: () => {} }));

const originalArgv = process.argv;
const originalPlatform = process.platform;
const setPlatform = (value: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value, configurable: true });

async function loadHost(env: Record<string, string | undefined>, argv: string[] = originalArgv) {
  vi.resetModules();
  h.handlers.clear();
  h.protocolCalls.length = 0;
  h.lockCalls = 0;
  h.quit.mockClear();
  h.whenReady.mockClear();
  for (const key of ['ZCC_DATA_DIR', 'ZCC_E2E_HOME', 'ZCC_REGISTER_DEV_PROTOCOL']) vi.stubEnv(key, env[key] ?? '');
  process.argv = argv;
  await import('../host.js');
}

describe('host deep link module-init wiring', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.lock = true;
    h.protocolResult = true;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    process.argv = originalArgv;
    setPlatform(originalPlatform);
  });

  it('skips the single-instance lock for a plain dev run and still routes second-instance argv', async () => {
    await loadHost({});
    expect(h.lockCalls).toBe(0);
    expect(h.whenReady).toHaveBeenCalledOnce();
    const second = h.handlers.get('second-instance')!;
    expect(second).toHaveLength(1);
    expect(() => second[0]({}, ['app', 'zana-dev://plugin/design-docs/peer/join?d=x'])).not.toThrow();
    expect(h.windowsCreated).toBeGreaterThan(0);
  });

  it('quits when an isolated dev run loses the single-instance lock', async () => {
    h.lock = false;
    await loadHost({ ZCC_DATA_DIR: '/tmp/zcc-dev-data' });
    expect(h.lockCalls).toBe(1);
    expect(h.quit).toHaveBeenCalledOnce();
    expect(h.handlers.has('second-instance')).toBe(false);
    expect(h.whenReady).not.toHaveBeenCalled();
  });

  it('holds the lock for an isolated dev run and routes second-instance argv', async () => {
    await loadHost({ ZCC_DATA_DIR: '/tmp/zcc-dev-data' });
    expect(h.lockCalls).toBe(1);
    expect(h.quit).not.toHaveBeenCalled();
    expect(h.whenReady).toHaveBeenCalledOnce();
    const second = h.handlers.get('second-instance')!;
    expect(second).toHaveLength(1);
    expect(() => second[0]({}, ['app', '--no-link'])).not.toThrow();
  });

  it('registers the dev scheme with the OS script entry on Linux when opted in', async () => {
    setPlatform('linux');
    await loadHost({ ZCC_REGISTER_DEV_PROTOCOL: '1' }, ['/usr/bin/electron', '/repo/main.js']);
    expect(h.protocolCalls).toHaveLength(1);
    const [scheme, execPath, args] = h.protocolCalls[0];
    expect(scheme).toBe('zana-dev');
    expect(execPath).toBe(process.execPath);
    expect(args).toEqual([expect.stringMatching(/main\.js$/)]);
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('deepLink.register'));
  });

  it('logs when OS scheme registration fails', async () => {
    setPlatform('linux');
    h.protocolResult = false;
    await loadHost({ ZCC_REGISTER_DEV_PROTOCOL: '1' }, ['/usr/bin/electron', '/repo/main.js']);
    expect(h.protocolCalls).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('deepLink.register: could not register zana-dev://'));
  });

  it('does not register without an app entry script', async () => {
    setPlatform('linux');
    await loadHost({ ZCC_REGISTER_DEV_PROTOCOL: '1' }, ['/usr/bin/electron']);
    expect(h.protocolCalls).toHaveLength(0);
  });

  it('queues a cold-start argv link without delivering before arm', async () => {
    await loadHost({}, ['/usr/bin/electron', 'zana-dev://plugin/design-docs/peer/join?d=cold']);
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('deepLink'));
  });
});
