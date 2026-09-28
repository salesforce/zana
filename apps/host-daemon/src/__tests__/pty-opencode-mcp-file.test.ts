import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

/**
 * MCP-via-FILE hardening (OpenCode's `OPENCODE_CONFIG`). A telemetry/wrapper shim
 * on PATH that OVERWRITES `OPENCODE_CONFIG_CONTENT` was silently dropping the
 * zcc-inbox MCP server, so squad workers lost `execution.work.complete`. The fix
 * writes the SAME zcc-inbox block to a per-session file and points the SEPARATE
 * `OPENCODE_CONFIG` var at it — OpenCode deep-merges the file back in, so the
 * clobber can't touch it. This suite proves `create()` writes the file, sets the
 * var, and cleans up on exit — and that a non-OpenCode profile does neither.
 */

interface SpawnCall {
  command: string;
  args: string[];
  env: Record<string, string>;
  fireExit: () => void;
}

const spawns: SpawnCall[] = [];

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[], opts: { env?: Record<string, string> }) => {
    let onExitCb: ((e: { exitCode: number }) => void) | undefined;
    const pid = 5000 + spawns.length;
    spawns.push({
      command,
      args,
      env: opts?.env ?? {},
      fireExit: () => onExitCb?.({ exitCode: 0 })
    });
    return {
      pid,
      write() {},
      onData() {},
      onExit(cb: (e: { exitCode: number }) => void) {
        onExitCb = cb;
      },
      resize() {},
      kill() {}
    };
  }
}));

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`,
  alwaysOnPluginMcpAllowlist: () => []
}));

vi.mock('../tmux.js', () => ({
  isTmuxAvailable: () => false,
  buildLocalTmuxCommand: (_id: string, command: string, args: string[]) => ({ command, args }),
  wrapRemoteTmux: (_id: string, quoted: string) => quoted,
  tmuxSessionName: (sessionId: string) => `cc-${sessionId}`
}));

import { PtyManager } from '../pty.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

const MCP_BASE = 'http://127.0.0.1:39999';
const BASE_CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

describe('OpenCode MCP-via-file hardening (OPENCODE_CONFIG)', () => {
  beforeEach(() => {
    spawns.length = 0;
  });

  it('writes a per-session config file, points OPENCODE_CONFIG at it, and keeps the env channel too', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    const session = mgr.create({
      projectId: 'proj1',
      profile: 'opencode',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: BASE_CONFIG
    });
    const call = spawns[0]!;

    // Both channels carry the zcc-inbox block: the file (clobber-proof) AND the
    // inline env var (works when un-clobbered + on the remote path).
    const filePath = call.env.OPENCODE_CONFIG;
    expect(filePath).toBeTruthy();
    expect(existsSync(filePath)).toBe(true);

    const fileCfg = JSON.parse(readFileSync(filePath, 'utf8'));
    const envCfg = JSON.parse(call.env.OPENCODE_CONFIG_CONTENT);
    expect(fileCfg).toEqual(envCfg);
    const server = fileCfg.mcp['zcc-inbox'];
    expect(server.type).toBe('remote');
    expect(server.enabled).toBe(true);
    // Identity-bearing per-session URL, baked in (not a substitution token).
    expect(server.url).toContain(MCP_BASE);
    expect(server.url).toContain('proj1');
    expect(server.url).toContain(session.id);

    // Cleanup on exit — the file is unlinked when the session finalizes.
    call.fireExit();
    expect(existsSync(filePath)).toBe(false);
  });

  it('does not write a file or set OPENCODE_CONFIG for a non-OpenCode profile', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: BASE_CONFIG
    });
    const call = spawns[0]!;
    expect(call.env.OPENCODE_CONFIG).toBeUndefined();
    expect(call.env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  });
});
