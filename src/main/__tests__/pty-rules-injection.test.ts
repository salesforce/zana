import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * WARP-C5 argv-injection test: proves the operator RULES.md block reaches the
 * spawned argv as an EXTRA `--append-system-prompt` layer when the injected
 * resolver returns text, and is absent (byte-identical) when it returns null.
 * The no-rules byte-identity across the full matrix is covered by the
 * golden-argv net; this suite covers the positive path the net can't (its test
 * env has no rules files + no resolver wired).
 */

interface SpawnCall {
  command: string;
  args: string[];
}
const spawns: SpawnCall[] = [];

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[]) => {
    spawns.push({ command, args });
    return { pid: 4321, write() {}, onData() {}, onExit() {}, resize() {}, kill() {} };
  }
}));

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`
}));

vi.mock('../tmux.js', () => ({
  isTmuxAvailable: () => false,
  buildLocalTmuxCommand: (_id: string, command: string, args: string[]) => ({ command, args }),
  wrapRemoteTmux: (_id: string, quoted: string) => quoted
}));

vi.mock('../model-resolve.js', () => ({
  resolveModelAlias: (model: string) => model
}));

import { PtyManager } from '../pty.js';
import type { AppConfig } from '../../shared/types.js';

const BASE_CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

const MCP_BASE = 'http://127.0.0.1:39999';

/** Count `--append-system-prompt <text>` pairs whose text === needle. */
function appendBlocksMatching(args: string[], needle: string): number {
  let n = 0;
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--append-system-prompt' && args[i + 1].includes(needle)) n++;
  }
  return n;
}

describe('pty create() — RULES.md injection (WARP-C5)', () => {
  beforeEach(() => {
    spawns.length = 0;
  });

  it('injects an extra --append-system-prompt block when the resolver returns text', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    mgr.setRulesResolver((projectId) =>
      projectId === 'proj1' ? 'OPERATOR RULES: SENTINEL-RULE-TEXT' : null
    );
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: BASE_CONFIG
    });
    const call = spawns[0];
    expect(appendBlocksMatching(call.args, 'SENTINEL-RULE-TEXT')).toBe(1);
    // The base guidance block is still present — rules layer ADDS, never replaces.
    expect(appendBlocksMatching(call.args, 'inbox_push')).toBe(1);
  });

  it('omits the rules block when the resolver returns null', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    mgr.setRulesResolver(() => null);
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: BASE_CONFIG
    });
    const call = spawns[0];
    expect(appendBlocksMatching(call.args, 'SENTINEL-RULE-TEXT')).toBe(0);
  });

  it('omits the rules block for a non-claude (shell) profile — no MCP config, no rules layer', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    mgr.setRulesResolver(() => 'SENTINEL-RULE-TEXT');
    mgr.create({
      projectId: 'proj1',
      profile: 'shell',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: BASE_CONFIG
    });
    const call = spawns[0];
    expect(call.args).not.toContain('--append-system-prompt');
  });
});
