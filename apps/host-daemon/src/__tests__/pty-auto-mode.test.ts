import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Auto mode wiring in the pty launch path. Auto mode (Claude Code's native
 * classifier-backed `--permission-mode auto`) is the DEFAULT for interactive
 * claude launches (AppConfig.autoModeEnabled absent ⇒ on). These tests capture
 * both the spawned argv AND the env so we can assert the flag, the
 * CLAUDE_CODE_ENABLE_AUTO_MODE enable var, the classifier --settings block, and
 * the mutual exclusion with the Overseer hook.
 */
interface FakeProc {
  pid: number;
  args: string[];
  env: Record<string, string>;
  write: () => void;
  onData: () => void;
  onExit: () => void;
  resize: () => void;
  kill: () => void;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: (_command: string, args: string[], opts: { env?: Record<string, string> }) => {
    const proc: FakeProc = {
      pid: 3000 + spawned.length,
      args,
      env: opts?.env ?? {},
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

import { PtyManager } from '../pty.js';
import { buildClaudeAutoModeSettings } from '../harness/claude/hooks.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

const BASE: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
};

/** Pull the JSON payload from the last `--settings <json>` pair, or null. */
function lastSettings(): Record<string, unknown> | null {
  const argv = spawned[spawned.length - 1].args;
  const i = argv.indexOf('--settings');
  if (i < 0) return null;
  try {
    return JSON.parse(argv[i + 1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function permModeValue(): string | undefined {
  const argv = spawned[spawned.length - 1].args;
  const i = argv.indexOf('--permission-mode');
  return i < 0 ? undefined : argv[i + 1];
}

function make(config: AppConfig, extra?: Partial<Parameters<PtyManager['create']>[0]>) {
  const mgr = new PtyManager();
  mgr.setMcpBaseUrl('http://127.0.0.1:3000');
  mgr.create({
    projectId: 'proj1',
    profile: 'claude',
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    config,
    ...extra
  });
}

// The pty spreads `...process.env` into the child, so any of these vars set in
// the *test runner's own* environment (this suite may itself run under the app,
// which exports CLAUDE_CODE_ENABLE_AUTO_MODE / ZCC_OVERSEER_URL) would leak into
// spawned[].env and defeat the env-absence assertions. Neutralize them per test
// so we only observe what pty.create() itself sets, then restore.
const AMBIENT_KEYS = ['CLAUDE_CODE_ENABLE_AUTO_MODE', 'ZCC_OVERSEER_URL'] as const;
const savedAmbient: Record<string, string | undefined> = {};

describe('auto mode — launch wiring', () => {
  beforeEach(() => {
    spawned.length = 0;
    for (const k of AMBIENT_KEYS) {
      savedAmbient[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of AMBIENT_KEYS) {
      if (savedAmbient[k] === undefined) delete process.env[k];
      else process.env[k] = savedAmbient[k];
    }
  });

  it('is ON by default (autoModeEnabled absent) — emits --permission-mode auto + enable env', () => {
    make(BASE);
    expect(permModeValue()).toBe('auto');
    expect(spawned[0].env.CLAUDE_CODE_ENABLE_AUTO_MODE).toBe('1');
  });

  it('is suppressed when autoModeEnabled === false — falls back, no enable env', () => {
    make({ ...BASE, autoModeEnabled: false });
    expect(permModeValue()).toBeUndefined();
    expect(spawned[0].env.CLAUDE_CODE_ENABLE_AUTO_MODE).toBeUndefined();
  });

  it('does not use auto mode for a haiku model (unsupported on Bedrock/Vertex/Foundry)', () => {
    make(BASE, { persona: { id: 'p', name: 'P', model: 'haiku' } });
    expect(permModeValue()).toBeUndefined();
    expect(spawned[0].env.CLAUDE_CODE_ENABLE_AUTO_MODE).toBeUndefined();
  });

  it('respects a per-persona permissionMode override (no auto)', () => {
    make(BASE, { persona: { id: 'p', name: 'P', permissionMode: 'plan' } });
    // persona flag is emitted last; the global auto default is turned off.
    expect(permModeValue()).toBe('plan');
    expect(spawned[0].args.filter((a) => a === '--permission-mode').length).toBe(1);
  });

  it('respects portable project and Persona execution overrides (no auto env)', () => {
    make(BASE, {
      projectSettings: { executionState: 'plan' },
      persona: { id: 'p', name: 'P', executionState: 'accept-edits' }
    });
    expect(permModeValue()).toBeUndefined();
    expect(spawned[0].env.CLAUDE_CODE_ENABLE_AUTO_MODE).toBeUndefined();
    expect(spawned[0].args.filter((arg) => arg === '--permission-mode')).toHaveLength(0);
  });

  it('never uses auto mode for claude-yolo (already --dangerously-skip-permissions)', () => {
    make(BASE, { profile: 'claude-yolo' });
    expect(spawned[0].args).toContain('--dangerously-skip-permissions');
    expect(permModeValue()).toBeUndefined();
    expect(spawned[0].env.CLAUDE_CODE_ENABLE_AUTO_MODE).toBeUndefined();
  });

  it('suppresses the Overseer hook when auto mode is active (mutual exclusion)', () => {
    // Overseer armed AND auto mode on ⇒ Overseer hook must NOT be installed.
    make({ ...BASE, overseerMode: 'on', autoModeEnabled: true });
    const settings = lastSettings();
    const preTool = (settings?.hooks as Record<string, unknown[]> | undefined)?.PreToolUse ?? [];
    // The Overseer hook is a match-all ('') PreToolUse entry whose command hits
    // $ZCC_OVERSEER_URL. Assert none of the installed PreToolUse commands do.
    const flat = JSON.stringify(preTool);
    expect(flat).not.toContain('ZCC_OVERSEER_URL');
    expect(spawned[0].env.ZCC_OVERSEER_URL).toBeUndefined();
  });

  it('installs the Overseer hook when auto mode is OFF and Overseer is armed', () => {
    make({ ...BASE, overseerMode: 'on', autoModeEnabled: false });
    const settings = lastSettings();
    const preTool = (settings?.hooks as Record<string, unknown[]> | undefined)?.PreToolUse ?? [];
    expect(JSON.stringify(preTool)).toContain('ZCC_OVERSEER_URL');
    expect(spawned[0].env.ZCC_OVERSEER_URL).toBeDefined();
  });

  it('injects the classifier autoMode block from config, with $defaults spliced in', () => {
    make({
      ...BASE,
      autoModeEnvironment: ['Source control: github.com/acme'],
      autoModeClassifyAllShell: true
    });
    const settings = lastSettings();
    const block = settings?.autoMode as Record<string, unknown> | undefined;
    expect(block).toBeDefined();
    expect(block?.environment).toEqual(['$defaults', 'Source control: github.com/acme']);
    expect(block?.classifyAllShell).toBe(true);
    // Untouched lists are omitted entirely.
    expect(block?.allow).toBeUndefined();
  });

  it('omits the autoMode block when no classifier trust is configured', () => {
    make(BASE);
    const settings = lastSettings();
    // Auto mode is on (the flag enables it) but with no operator trust config the
    // block is omitted — the bare flag is enough.
    expect(settings?.autoMode).toBeUndefined();
  });
});

describe('autonomous flag gating — non-Claude harness', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  // Regression: a Team/autonomous launch used to splice Claude-only
  // `--permission-mode acceptEdits` + `--disallowedTools AskUserQuestion` into
  // EVERY autonomous spawn, gated only on `claude-yolo`. opencode rejects both
  // (prints usage, exits 1) so all Team slots died at ~0s. Now gated on
  // `acceptsPermissionMode` / `injectsClaudeMcpConfig` (both false for opencode).
  it('opencode structured Team spawn omits --permission-mode and --disallowedTools', () => {
    make(BASE, {
      profile: 'opencode',
      autonomous: true,
      coordinationMode: 'structured',
      persona: { id: 'p', name: 'P', executionState: 'autonomous' }
    });
    const argv = spawned[0].args;
    // Neither Claude-only flag — opencode rejects them and exits 1 at spawn.
    expect(argv).not.toContain('--permission-mode');
    expect(argv).not.toContain('--disallowedTools');
    // Autonomy is conveyed by opencode's own executionContribution.
    expect(argv).toContain('--agent');
  });

  it('opencode freeform Team spawn is identical (no Claude flags)', () => {
    make(BASE, {
      profile: 'opencode',
      autonomous: true,
      coordinationMode: 'freeform',
      persona: { id: 'p', name: 'P', executionState: 'autonomous' }
    });
    const argv = spawned[0].args;
    expect(argv).not.toContain('--permission-mode');
    expect(argv).not.toContain('--disallowedTools');
    expect(argv).toContain('--agent');
  });

  it('claude Team spawn still injects the Claude-only --disallowedTools (gate lets Claude through)', () => {
    make({ ...BASE, autoModeEnabled: false }, { autonomous: true, coordinationMode: 'structured' });
    const argv = spawned[0].args;
    // A structured/autonomous claude Team resolves to the yolo base
    // (--dangerously-skip-permissions), so --permission-mode is correctly absent
    // (mutually exclusive), but the AskUserQuestion suppression still applies.
    expect(argv).toContain('--disallowedTools');
    expect(argv[argv.indexOf('--disallowedTools') + 1]).toBe('AskUserQuestion');
  });
});

describe('buildClaudeAutoModeSettings', () => {
  it('returns undefined when nothing is configured', () => {
    expect(buildClaudeAutoModeSettings(BASE)).toBeUndefined();
  });

  it('splices $defaults in front of every non-empty list', () => {
    const block = buildClaudeAutoModeSettings({
      ...BASE,
      autoModeEnvironment: ['a'],
      autoModeAllow: ['b'],
      autoModeSoftDeny: ['c'],
      autoModeHardDeny: ['d']
    });
    expect(block).toEqual({
      environment: ['$defaults', 'a'],
      allow: ['$defaults', 'b'],
      soft_deny: ['$defaults', 'c'],
      hard_deny: ['$defaults', 'd']
    });
  });

  it('emits classifyAllShell only when true', () => {
    expect(buildClaudeAutoModeSettings({ ...BASE, autoModeClassifyAllShell: false })).toBeUndefined();
    expect(buildClaudeAutoModeSettings({ ...BASE, autoModeClassifyAllShell: true })).toEqual({
      classifyAllShell: true
    });
  });
});

/**
 * squad-bugs: a non-autonomous durable orchestrator must never receive broad edit
 * permission. Plan authoring is allowed only through a path-scoped `Edit(//abs)`
 * rule (the CLI ignores `Write(path)` rules and covers Write via `Edit`).
 */
describe('durable orchestrator permissions — no broad edit grant (squad-bugs)', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  function allowedTools(): string[] {
    const argv = spawned[spawned.length - 1].args;
    const out: string[] = [];
    argv.forEach((arg, i) => {
      if (arg === '--allowedTools' || arg === '--allowed-tools') {
        for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) out.push(...argv[j].split(',').map((s) => s.trim()).filter(Boolean));
      }
    });
    return out;
  }

  it('freeform non-autonomous orchestrator gets no acceptEdits and no bare Write/Edit', () => {
    make({ ...BASE, autoModeEnabled: false }, { coordinationMode: 'freeform', persona: { id: 'p', name: 'P' } });
    expect(permModeValue()).not.toBe('acceptEdits');
    const allowed = allowedTools();
    expect(allowed).not.toContain('Write');
    expect(allowed).not.toContain('Edit');
    expect(allowed).not.toContain('MultiEdit');
  });

  it('grants only an exact-file Edit rule for the authored plan path, never Write(path) or acceptEdits', () => {
    const planPath = '/tmp/proj1/.zana/execution-plan-exec-1.md';
    make({ ...BASE, autoModeEnabled: false }, {
      coordinationMode: 'freeform',
      persona: { id: 'p', name: 'P' },
      authoredPlanPaths: [planPath]
    } as Partial<Parameters<PtyManager['create']>[0]>);
    const allowed = allowedTools();
    expect(allowed).toContain(`Edit(/${planPath})`);
    expect(allowed.some((rule) => rule.startsWith('Write('))).toBe(false);
    expect(allowed).not.toContain('Edit');
    expect(permModeValue()).not.toBe('acceptEdits');
  });

  it('grants one exact-file Edit rule per plan-handoff path (authored + correction files)', () => {
    const paths = [
      '/tmp/proj1/.zana/execution-plan-exec-1.md',
      '/tmp/proj1/.zana/execution-plan-corrected-exec-1.md',
      '/tmp/proj1/.zana/execution-plan-correction-exec-1.md'
    ];
    make({ ...BASE, autoModeEnabled: false }, {
      coordinationMode: 'freeform',
      persona: { id: 'p', name: 'P' },
      authoredPlanPaths: paths
    } as Partial<Parameters<PtyManager['create']>[0]>);
    const allowed = allowedTools();
    for (const path of paths) expect(allowed).toContain(`Edit(/${path})`);
    expect(allowed.filter((rule) => rule.startsWith('Edit('))).toHaveLength(3);
    expect(allowed).not.toContain('Edit');
    expect(permModeValue()).not.toBe('acceptEdits');
  });
});

describe('authored plan grant guards (squad-bugs)', () => {
  beforeEach(() => {
    spawned.length = 0;
  });
  const allowedJoined = () => {
    const argv = spawned[spawned.length - 1].args;
    const i = argv.indexOf('--allowedTools');
    return i >= 0 ? argv[i + 1] : '';
  };

  it('ignores the path outside a durable coordination launch', () => {
    make({ ...BASE }, { authoredPlanPaths: ['/tmp/proj1/.zana/execution-plan-x.md'] } as Partial<Parameters<PtyManager['create']>[0]>);
    expect(allowedJoined()).not.toContain('Edit(');
  });

  it.each([
    'relative/.zana/plan.md', '/tmp/a(b)/plan.md', '/tmp/a,b/plan.md',
    '/tmp/project/*.md', '/tmp/project/plan?.md', '/tmp/project/[draft].md',
    '/tmp/project/../outside.md', '/tmp/project/sub/../../outside.md'
  ])('refuses an unsafe or relative path %s', (path) => {
    make({ ...BASE }, { coordinationMode: 'freeform', persona: { id: 'p', name: 'P' }, authoredPlanPaths: [path] } as Partial<Parameters<PtyManager['create']>[0]>);
    expect(allowedJoined()).not.toContain('Edit(');
  });

  it('drops only the unsafe entry and keeps the safe exact-file rules', () => {
    make({ ...BASE }, {
      coordinationMode: 'freeform', persona: { id: 'p', name: 'P' },
      authoredPlanPaths: ['/tmp/proj1/.zana/execution-plan-x.md', 'relative/plan.md', '/tmp/a(b)/plan.md']
    } as Partial<Parameters<PtyManager['create']>[0]>);
    expect(allowedJoined()).toContain('Edit(//tmp/proj1/.zana/execution-plan-x.md)');
    expect(allowedJoined()).not.toContain('relative/plan.md');
    expect(allowedJoined()).not.toContain('a(b)');
  });

  it('drops wildcard and traversal entries while keeping a safe sibling exact-file rule', () => {
    make({ ...BASE }, {
      coordinationMode: 'freeform', persona: { id: 'p', name: 'P' },
      authoredPlanPaths: [
        '/tmp/proj1/.zana/execution-plan-x.md', '/tmp/proj1/.zana/*.md',
        '/tmp/proj1/.zana/plan?.md', '/tmp/proj1/.zana/[draft].md',
        '/tmp/proj1/.zana/../outside.md'
      ]
    } as Partial<Parameters<PtyManager['create']>[0]>);
    expect(allowedJoined()).toContain('Edit(//tmp/proj1/.zana/execution-plan-x.md)');
    expect(allowedJoined()).not.toContain('*');
    expect(allowedJoined()).not.toContain('?');
    expect(allowedJoined()).not.toContain('[draft]');
    expect(allowedJoined()).not.toContain('outside.md');
  });
});
