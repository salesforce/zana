import { describe, it, expect, beforeEach, vi } from 'vitest';

// PtyManager imports node-pty (real subprocesses). Record argv and whether a
// spawn ever happened, so a fail-closed refusal can be proven to spawn NOTHING.
interface FakeProc {
  pid: number;
  command: string;
  args: string[];
  write: () => void;
  onData: () => void;
  onExit: () => void;
  resize: () => void;
  kill: () => void;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[]) => {
    const proc: FakeProc = {
      pid: 3000 + spawned.length,
      command,
      args,
      write() {},
      onData() {},
      onExit() {},
      resize() {},
      kill() {}
    };
    spawned.push(proc);
    return proc;
  }
}));

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`,
  alwaysOnPluginMcpAllowlist: () => []
}));

import { PtyManager, SpawnRefusedError } from '../pty.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

const LOCAL = {
  projectId: 'p1',
  profile: 'claude' as const,
  cwd: '/tmp',
  cols: 80,
  rows: 24,
  config: CONFIG
};

// OBL-018: the native-tool veto rides the local MCP relay's /hook/nativetool
// route. With no mcpBaseUrl that route is unreachable, so a launch that main
// flagged as requiring tool policy must FAIL CLOSED — never spawn.
describe('PtyManager.create — native-tool veto fail-closed (local)', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('refuses to spawn when policy required and no native-tool hook is reachable', () => {
    const mgr = new PtyManager();
    // no setMcpBaseUrl → nativeToolUrl is null
    let err: unknown;
    try {
      mgr.create({ ...LOCAL, nativeToolPolicyRequired: true });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SpawnRefusedError);
    expect((err as SpawnRefusedError).code).toBe('native-tool-policy-unreachable');
    expect(spawned).toHaveLength(0);
  });

  it('fails closed for an older caller that omits the flag (absent → required)', () => {
    const mgr = new PtyManager();
    expect(() => mgr.create({ ...LOCAL })).toThrow(SpawnRefusedError);
    expect(spawned).toHaveLength(0);
  });

  it('spawns when policy is explicitly not required even without a hook', () => {
    const mgr = new PtyManager();
    const session = mgr.create({ ...LOCAL, nativeToolPolicyRequired: false });
    expect(session).toBeTruthy();
    expect(spawned).toHaveLength(1);
  });

  it('spawns when the native-tool hook endpoint is reachable', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:8781');
    const session = mgr.create({ ...LOCAL, nativeToolPolicyRequired: true });
    expect(session).toBeTruthy();
    expect(spawned).toHaveLength(1);
  });
});
