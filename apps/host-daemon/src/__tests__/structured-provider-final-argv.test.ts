import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, HarnessModelRoutingV1, LaunchProfileId } from '@zana-ai/zcc-domain/product';

interface SpawnCall {
  command: string;
  args: string[];
}

/** Tests name harness CLIs by basename; `resolveHarnessCommand` may absolutize PATH hits. */
function snapshotCommand(command: string): string {
  if (!command.includes('/') && !command.includes('\\')) return command;
  return command.replace(/.*[/\\]/, '') || command;
}

const MINTED_SESSION_ID = expect.stringMatching(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
);

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
  ensureMcpConfigForProjectSync: () => '/tmp/proj1/.mcp.json',
  alwaysOnPluginMcpAllowlist: () => []
}));

vi.mock('../tmux.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../tmux.js')>()),
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
  const last = spawns.at(-1)!;
  return { command: snapshotCommand(last.command), args: last.args };
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

  it('omits Codex sandbox flags for accept-edits', () => {
    expect(spawn('codex', routing('codex', {
      modelTargetId: 'gpt-4o',
      executionState: 'accept-edits'
    }))).toEqual({
      command: 'codex',
      args: ['-m', 'gpt-4o']
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

  it('does not inject --force for Cursor CLI Agent Edits', () => {
    expect(spawn('cursor', routing('cursor', {
      modelTargetId: 'gpt-5.6-sol-medium',
      executionState: 'accept-edits'
    }))).toEqual({
      command: 'cursor-agent',
      args: ['--model', 'gpt-5.6-sol-medium']
    });
  });

  it.each([
    ['claude', { executionState: 'plan' as const }, ['--permission-mode', 'plan']],
    ['cursor', { executionState: 'plan' as const }, ['--mode', 'plan']],
    ['codex', { executionState: 'plan' as const }, ['-s', 'read-only', '-a', 'on-request']]
  ] as const)('spawns %s Plan without crashing', (profile, target, flags) => {
    const result = spawn(profile, routing(profile, { ...target }));
    expect(result.args).toEqual(expect.arrayContaining([...flags]));
  });

  it('keeps default Agent launches off the Plan flags', () => {
    expect(spawn('claude').args.join(' ')).not.toMatch(/--permission-mode plan/);
    expect(spawn('cursor').args).not.toContain('--mode');
    expect(spawn('codex').args).not.toEqual(expect.arrayContaining(['-s', 'read-only', '-a', 'on-request']));
  });

  it('omits --model when Cursor Auto sentinels are selected', () => {
    expect(spawn('cursor', routing('cursor', {
      modelTargetId: 'auto'
    }))).toEqual({
      command: 'cursor-agent',
      args: []
    });
  });

  it('emits OpenCode model without auto-approve for accept-edits', () => {
    expect(spawn('opencode', routing('opencode', {
      modelTargetId: 'fixture-provider/gpt-6.1-sol',
      executionState: 'accept-edits'
    }))).toEqual({
      command: 'opencode',
      args: ['--model', 'fixture-provider/gpt-6.1-sol']
    });
  });

  it.each([false, true])('emits an explicit dynamic provider/model pair verbatim (remote=%s)', remote => {
    new PtyManager().create({
      projectId: 'proj1', profile: 'opencode', cwd: '/tmp/work', cols: 80, rows: 24, config: CONFIG,
      harnessRouting: routing('opencode', {
        providerTargetId: 'new-install-provider', modelTargetId: 'new-install-provider/model-v2'
      }),
      ...(remote ? { remote: { host: 'fixture-host', remotePath: '/remote/work' } } : {})
    });
    const args = spawns.at(-1)!.args.join(' ');
    expect(args).toContain('--model');
    expect(args).toContain('new-install-provider/model-v2');
  });

  it('maps an OpenCode portable level to the authorized pin of THIS launch only', () => {
    // Two slots sharing ONE worktree cwd, each authorized with its own resolved
    // id: each spawn uses its own pin verbatim; no keyed state links them.
    const create = (targetId?: string) => {
      new PtyManager().create({
        projectId: 'proj1', profile: 'opencode', cwd: '/tmp/shared-worktree', cols: 80, rows: 24, config: CONFIG,
        harnessRouting: routing('opencode', { modelLevel: 'low' }),
        ...(targetId ? { authorizedModel: { adapterId: 'opencode', level: 'low' as const, targetId } } : {})
      });
      return spawns.at(-1)!.args;
    };
    expect(create('fixture-provider/gpt-7-luna')).toEqual(expect.arrayContaining(['--model', 'fixture-provider/gpt-7-luna']));
    expect(create('fixture-provider/gpt-8-luna')).toEqual(expect.arrayContaining(['--model', 'fixture-provider/gpt-8-luna']));
    expect(create('fixture-provider/gpt-7-luna')).not.toContain('fixture-provider/gpt-8-luna');
    // Inventory names cannot authorize an unconfigured portable tier.
    expect(() => create()).toThrow('does not support low model level');
  });

  it('a native role still suppresses an authorized model pin', () => {
    new PtyManager().create({
      projectId: 'proj1', profile: 'opencode', cwd: '/tmp/shared-worktree', cols: 80, rows: 24, config: CONFIG,
      harnessRouting: routing('opencode', { modelLevel: 'low', roleTargetId: 'reviewer' }),
      authorizedModel: { adapterId: 'opencode', level: 'low', targetId: 'fixture-provider/gpt-7-luna' }
    });
    expect(spawns.at(-1)!.args).not.toContain('--model');
  });

  it.each([false, true])('launches a native role with an unsupported persona tier (remote=%s)', remote => {
    new PtyManager().create({
      projectId: 'proj1', profile: 'opencode', cwd: '/tmp/work', cols: 80, rows: 24, config: CONFIG,
      persona: { id: 'p', name: 'P', modelLevel: 'low' },
      harnessRouting: routing('opencode', { roleTargetId: 'reviewer' }),
      ...(remote ? { remote: { host: 'fixture-host', remotePath: '/remote/work' } } : {})
    });
    const args = spawns.at(-1)!.args.join(' ');
    expect(args).toContain('reviewer');
    expect(args).not.toContain('--model');
  });

  it('emits OpenCode auto-approve only for autonomous', () => {
    expect(spawn('opencode', routing('opencode', {
      modelTargetId: 'fixture-provider/gpt-6.1-sol',
      executionState: 'autonomous'
    }))).toEqual({
      command: 'opencode',
      args: [
        '--model', 'fixture-provider/gpt-6.1-sol',
        '--agent', 'build', '--auto'
      ]
    });
  });

  it('emits Grok catalog model without extra execution flags for Edits', () => {
    expect(spawn('grok', routing('grok', {
      modelTargetId: 'grok-4.5',
      executionState: 'accept-edits'
    }))).toEqual({
      command: 'grok',
      args: ['--session-id', MINTED_SESSION_ID, '--model', 'grok-4.5']
    });
  });

  it('emits Mastra Code catalog model without extra execution flags for Edits', () => {
    expect(spawn('mastracode', routing('mastracode', {
      modelTargetId: 'anthropic/claude-opus-4-6',
      executionState: 'accept-edits'
    }))).toEqual({
      command: 'mastracode',
      args: ['--model', 'anthropic/claude-opus-4-6']
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

  it('drops a co-selected per-tab model when an OpenCode native role is picked', () => {
    // A native `--agent` pins the agent's own model; a forced catalog `--model`
    // alongside it dies with ProviderModelNotFoundError (exit 64) on any install
    // whose inventory differs from the shipped snapshot. The role wins, no model.
    expect(spawn('opencode', routing('opencode', {
      modelTargetId: 'fixture-provider/gpt-6.1-sol',
      roleTargetId: 'custom-agent'
    }))).toEqual({
      command: 'opencode',
      args: ['--agent', 'custom-agent']
    });
  });

  it('suppresses a GLOBAL-routing OpenCode model when a per-tab native role is picked', () => {
    // The real-world exit-64 bug: global harnessRouting injects a `--model` even
    // when the composer sends none. A resolved native role must suppress it from
    // ANY source (per-tab / persona / project / global), not just per-tab.
    const manager = new PtyManager();
    manager.create({
      projectId: 'proj1',
      profile: 'opencode',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: { ...CONFIG, harnessRouting: routing('opencode', { modelTargetId: 'fixture-provider/gpt-6.1-sol' }) },
      harnessRouting: routing('opencode', { roleTargetId: 'custom-agent' })
    });
    const last = spawns.at(-1)!;
    expect({ command: snapshotCommand(last.command), args: last.args }).toEqual({
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

    const last = spawns.at(-1)!;
    expect({ command: snapshotCommand(last.command), args: last.args }).toEqual({
      command: 'pi',
      args: ['--session-id', MINTED_SESSION_ID, '--provider', 'anthropic', '--model', 'claude-sonnet-4-5', '--thinking', 'high']
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

describe('cliPlanIntent session stamp', () => {
  beforeEach(() => {
    spawns.length = 0;
  });

  it('stamps local Claude Plan without changing Plan argv', () => {
    const manager = new PtyManager();
    const session = manager.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: CONFIG,
      harnessRouting: routing('claude', { executionState: 'plan' })
    });
    expect(session.cliPlanIntent).toBe(true);
    expect(spawns.at(-1)!.args).toEqual(expect.arrayContaining(['--permission-mode', 'plan']));
  });

  it('stamps local Cursor Plan and OpenCode --agent plan', () => {
    const manager = new PtyManager();
    expect(manager.create({
      projectId: 'proj1',
      profile: 'cursor',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: CONFIG,
      harnessRouting: routing('cursor', { executionState: 'plan' })
    }).cliPlanIntent).toBe(true);
    expect(manager.create({
      projectId: 'proj1',
      profile: 'opencode',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: CONFIG,
      harnessRouting: routing('opencode', { roleTargetId: 'plan' })
    }).cliPlanIntent).toBe(true);
  });

  it('does not stamp default Agent or Codex Plan', () => {
    const manager = new PtyManager();
    expect(manager.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: CONFIG
    }).cliPlanIntent).toBeUndefined();
    expect(manager.create({
      projectId: 'proj1',
      profile: 'codex',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: CONFIG,
      harnessRouting: routing('codex', { executionState: 'plan' })
    }).cliPlanIntent).toBeUndefined();
  });
});
