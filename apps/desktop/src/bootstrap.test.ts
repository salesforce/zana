import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const installRuntimeLog = vi.fn();
const installCrashBreadcrumbs = vi.fn();
const setPath = vi.fn();
const appendSwitch = vi.fn();
const crashStart = vi.fn();
let isPackaged = false;

async function runBootstrap(env: Record<string, string | undefined>, crashThrows = false): Promise<void> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  crashStart.mockImplementation(() => { if (crashThrows) throw new Error('no crash reporter'); });
  vi.doMock('electron', () => ({
    app: { setPath, getPath: () => '/home/u', get isPackaged() { return isPackaged; }, commandLine: { appendSwitch } },
    crashReporter: { start: crashStart }
  }));
  vi.doMock('@zana-ai/zcc-process-utils', () => ({ installRuntimeLog }));
  vi.doMock('./crash-breadcrumbs.js', () => ({ installCrashBreadcrumbs }));
  vi.doMock('./main.js', () => ({}));
  await import('./bootstrap.js');
}

describe('desktop bootstrap diagnostics', () => {
  const saved = { home: process.env.ZCC_E2E_HOME, data: process.env.ZCC_DATA_DIR };
  beforeEach(() => { vi.clearAllMocks(); isPackaged = false; });
  afterEach(() => {
    for (const [k, v] of [['ZCC_E2E_HOME', saved.home], ['ZCC_DATA_DIR', saved.data]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    vi.resetModules();
  });

  it('starts local-only crash dumps and breadcrumbs under the data dir', async () => {
    await runBootstrap({ ZCC_E2E_HOME: undefined, ZCC_DATA_DIR: '/data' });
    expect(setPath).toHaveBeenCalledWith('crashDumps', expect.stringMatching(/crash-dumps$/));
    expect(crashStart).toHaveBeenCalledWith({ uploadToServer: false, compress: true });
    const options = installCrashBreadcrumbs.mock.calls[0][0];
    expect(options.logsDir).toMatch(/logs$/);
    const memory = { total: 1, free: 1 };
    (process as any).getSystemMemoryInfo = () => memory;
    expect(options.systemMemory()).toBe(memory);
    delete (process as any).getSystemMemoryInfo;
    expect(options.systemMemory()).toBeUndefined();
  });

  it('falls back to the home .zcc dir and survives a crash reporter failure', async () => {
    await runBootstrap({ ZCC_E2E_HOME: undefined, ZCC_DATA_DIR: undefined }, true);
    expect(installRuntimeLog).toHaveBeenCalledWith(expect.stringMatching(/\.zcc$/), 'desktop', expect.anything());
    expect(installCrashBreadcrumbs).toHaveBeenCalledTimes(1);
  });

  it('skips diagnostics under the E2E home', async () => {
    await runBootstrap({ ZCC_E2E_HOME: '/e2e', ZCC_DATA_DIR: undefined });
    expect(appendSwitch).toHaveBeenCalledWith('use-mock-keychain');
    expect(crashStart).not.toHaveBeenCalled();
    expect(installCrashBreadcrumbs).not.toHaveBeenCalled();
  });
});
