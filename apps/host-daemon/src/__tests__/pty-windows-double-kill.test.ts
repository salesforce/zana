import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// node-pty 1.2.0-beta.15 closes the Windows pseudoconsole on every kill() and
// a second close corrupts the heap (exit code 0xC0000374, microsoft/node-pty#983).
// finalizeExit() ends in destroy(), which on Windows is kill(): after close() it
// must not reach the native kill a second time.
interface FakeProc {
  pid: number;
  exitCb?: (e: { exitCode: number }) => void;
  kills: number;
  destroys: number;
  write: () => void;
  onData: () => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  resize: () => void;
  kill: () => void;
  destroy: () => void;
}

const spawned: FakeProc[] = [];
let nextPid = 9100;

vi.mock('node-pty', () => ({
  spawn: () => {
    const proc: FakeProc = {
      pid: nextPid++,
      kills: 0,
      destroys: 0,
      write() {},
      onData() {},
      onExit(cb) { this.exitCb = cb; },
      resize() {},
      kill() { this.kills++; },
      destroy() { this.destroys++; }
    };
    spawned.push(proc);
    return proc;
  }
}));

// Fake pids must never reach a real taskkill.
vi.mock('@zana-ai/zcc-agent-process-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zana-ai/zcc-agent-process-utils')>()),
  stopWindowsProcessTree: vi.fn()
}));

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`,
  alwaysOnPluginMcpAllowlist: () => [], sessionPluginMcpServers: () => []
}));

import { PtyManager } from '../pty.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

const CONFIG: AppConfig = {
  version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null
};
const realPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

function start(): { mgr: PtyManager; proc: FakeProc; id: string } {
  const mgr = new PtyManager();
  const session = mgr.create({ nativeToolPolicyRequired: false, projectId: 'p1', profile: 'shell', cwd: '/tmp', cols: 80, rows: 24, config: CONFIG });
  return { mgr, proc: spawned[spawned.length - 1], id: session.id };
}

describe('PtyManager exit finalization after close on Windows', () => {
  beforeEach(() => { spawned.length = 0; });
  afterEach(() => { setPlatform(realPlatform); });

  it('does not destroy (kill again) a pty that close() already released', () => {
    const { mgr, proc, id } = start();
    setPlatform('win32');

    mgr.close(id);
    proc.exitCb?.({ exitCode: 0 });

    expect(proc.kills).toBe(1);
    expect(proc.destroys).toBe(0);
  });

  it('does not destroy a pty that closeExpected() already released', () => {
    const { mgr, proc, id } = start();
    setPlatform('win32');

    expect(mgr.closeExpected(id)).toBe(true);
    proc.exitCb?.({ exitCode: 0 });

    expect(proc.kills).toBe(1);
    expect(proc.destroys).toBe(0);
  });

  it('still releases a pty that exited on its own (nothing killed it)', () => {
    const { proc } = start();
    setPlatform('win32');

    proc.exitCb?.({ exitCode: 0 });

    expect(proc.kills).toBe(0);
    expect(proc.destroys).toBe(1);
  });

  it('keeps destroy as the cleanup after close() on POSIX', () => {
    const { mgr, proc, id } = start();
    setPlatform('linux');
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    mgr.close(id);
    proc.exitCb?.({ exitCode: 0 });

    expect(proc.destroys).toBe(1);
  });
});
