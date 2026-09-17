import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture the env each spawn receives so we can assert the OpenCode MCP
// deep-merge (OPENCODE_CONFIG_CONTENT) the orchestrator denylist produces.
interface FakeProc {
  pid: number;
  command: string;
  args: string[];
  env: Record<string, string>;
  write: () => void;
  onData: () => void;
  onExit: () => void;
  resize: () => void;
  kill: () => void;
  killed: boolean;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[], options: { env: Record<string, string> }) => {
    const proc: FakeProc = {
      pid: 5000 + spawned.length,
      command,
      args,
      env: options.env,
      write() {},
      onData() {},
      onExit() {},
      resize() {},
      killed: false,
      kill() { proc.killed = true; }
    };
    spawned.push(proc);
    return proc;
  }
}));

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`,
  alwaysOnPluginMcpAllowlist: () => []
}));

// tmux off so the spawn command is the bare CLI (env still flows either way).
vi.mock('../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tmux.js')>();
  return { ...actual, isTmuxAvailable: () => false };
});

import { PtyManager } from '../pty.js';
import type { AppConfig, SessionCohort } from '@zana-ai/zcc-domain/product';

function cfg(over: Partial<AppConfig> = {}): AppConfig {
  return {
    version: 1,
    theme: 'dark',
    shell: '/bin/zsh',
    claudeBinary: 'claude',
    fontSize: 13,
    lastProjectId: null,
    ...over
  } as AppConfig;
}

const dims = { cwd: '/work/p1', cols: 80, rows: 24 };

function orchestratorCohort(over: Partial<SessionCohort> = {}): SessionCohort {
  return {
    cohortId: 'cohort-1',
    teamId: 'team-1',
    teamName: 'Team',
    role: 'orchestrator',
    slotId: 'orchestrator:lead',
    ...over
  };
}

function opencodeMcp(proc: FakeProc): Record<string, { enabled: boolean }> {
  return JSON.parse(proc.env.OPENCODE_CONFIG_CONTENT).mcp;
}

describe('orchestrator MCP server denylist → OpenCode env', () => {
  let ptys: PtyManager;

  beforeEach(() => {
    spawned.length = 0;
    ptys = new PtyManager();
    ptys.setMcpBaseUrl('http://127.0.0.1:8765');
  });

  it('disables the listed servers only for the orchestrator session', () => {
    ptys.create({
      projectId: 'p1',
      profile: 'opencode',
      config: cfg({ orchestratorMcpServerDenylist: ['mcp-adaptor'] }),
      cohort: orchestratorCohort(),
      orchestratorMcpServerDenylist: ['mcp-adaptor'],
      ...dims
    });
    const mcp = opencodeMcp(spawned[0]);
    expect(mcp['zcc-inbox'].enabled).toBe(true);
    expect(mcp['mcp-adaptor']).toEqual({ enabled: false });
  });

  it('leaves a worker session untouched even when a denylist is configured', () => {
    ptys.create({
      projectId: 'p1',
      profile: 'opencode',
      config: cfg({ orchestratorMcpServerDenylist: ['mcp-adaptor'] }),
      cohort: orchestratorCohort({ role: 'worker', slotId: 'worker:1' }),
      // A worker never receives the resolved list from launchTeam; even if it did,
      // the role gate below drops it.
      orchestratorMcpServerDenylist: ['mcp-adaptor'],
      ...dims
    });
    const mcp = opencodeMcp(spawned[0]);
    expect(mcp['zcc-inbox'].enabled).toBe(true);
    expect(mcp['mcp-adaptor']).toBeUndefined();
  });

  it('leaves the orchestrator untouched when no denylist is resolved (default off)', () => {
    ptys.create({
      projectId: 'p1',
      profile: 'opencode',
      config: cfg(),
      cohort: orchestratorCohort(),
      ...dims
    });
    const mcp = opencodeMcp(spawned[0]);
    expect(Object.keys(mcp)).toEqual(['zcc-inbox']);
  });
});
