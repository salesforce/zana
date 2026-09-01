import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, HarnessModelRoutingV1, LaunchProfileId } from '@zana-ai/zcc-domain/product';

interface SpawnCall {
  command: string;
  args: string[];
}

const spawns: SpawnCall[] = [];

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[]) => {
    spawns.push({ command, args });
    return {
      pid: 4000,
      write() {},
      onData() {},
      onExit() {},
      resize() {},
      kill() {}
    };
  }
}));

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: () => '/tmp/proj1/.mcp.json'
}));

vi.mock('../tmux.js', () => ({
  isTmuxAvailable: () => false,
  buildLocalTmuxCommand: (_id: string, command: string, args: string[]) => ({ command, args }),
  wrapRemoteTmux: (_id: string, command: string) => command
}));

vi.mock('@zana-ai/zcc-llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-llm')>();
  return { ...actual, resolveModelAlias: (model: string) => model };
});

import { PtyManager } from '../pty.js';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
};

function routing(adapter: string, target: Record<string, unknown>): HarnessModelRoutingV1 {
  return { schemaVersion: 1, byAdapter: { [adapter]: target } } as HarnessModelRoutingV1;
}

function spawn(profile: LaunchProfileId, harnessRouting?: HarnessModelRoutingV1): SpawnCall {
  const manager = new PtyManager();
  manager.create({
    projectId: 'proj1',
    profile,
    cwd: '/tmp/work',
    cols: 80,
    rows: 24,
    config: CONFIG,
    harnessRouting
  });
  return spawns.at(-1)!;
}

describe('structured providers final local argv', () => {
  beforeEach(() => {
    spawns.length = 0;
  });

  it('emits Codex model and execution tuple once in final order', () => {
    expect(spawn('codex', routing('codex', {
      modelTargetId: 'gpt-4o',
      executionState: 'plan'
    }))).toEqual({
      command: 'codex',
      args: ['-m', 'gpt-4o', '-s', 'read-only', '-a', 'on-request']
    });
  });

  it('emits Cursor model and execution policy once in final order', () => {
    expect(spawn('cursor', routing('cursor', {
      modelTargetId: 'gpt-5.6-sol-medium',
      executionState: 'autonomous'
    }))).toEqual({
      command: 'cursor-agent',
      args: ['--model', 'gpt-5.6-sol-medium', '--force']
    });
  });

  it('emits OpenCode model and execution policy in final order', () => {
    expect(spawn('opencode', routing('opencode', {
      modelTargetId: 'llmgw/gpt-5.6-sol-1M',
      executionState: 'accept-edits'
    }))).toEqual({
      command: 'opencode',
      args: [
        '--model', 'llmgw/gpt-5.6-sol-1M',
        '--auto'
      ]
    });
  });

  it('emits per-tab OpenCode role in final argv', () => {
    expect(spawn('opencode', routing('opencode', {
      roleTargetId: 'custom-agent'
    }))).toEqual({
      command: 'opencode',
      args: ['--agent', 'custom-agent']
    });
  });

  it('keeps PI provider/model/thinking project settings in final argv', () => {
    const manager = new PtyManager();
    manager.create({
      projectId: 'proj1',
      profile: 'pi',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: CONFIG,
      projectSettings: {
        piProvider: 'anthropic',
        piModel: 'claude-sonnet-4-5',
        piThinking: 'high'
      }
    });

    expect(spawns.at(-1)).toEqual({
      command: 'pi',
      args: ['--provider', 'anthropic', '--model', 'claude-sonnet-4-5', '--thinking', 'high']
    });
  });
});

describe('structured providers remote blocking', () => {
  it('blocks unsupported PI execution before producing remote argv', async () => {
    spawns.length = 0;
    const manager = new PtyManager();
    expect(() => manager.create({
      projectId: 'proj1',
      profile: 'pi',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: CONFIG,
      remote: { host: 'devbox', remotePath: '/srv/app' },
      harnessRouting: routing('pi', { executionState: 'plan' })
    })).toThrow('PI does not support plan execution state.');
    expect(spawns).toHaveLength(0);
  });
});
