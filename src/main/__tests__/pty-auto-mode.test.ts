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
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`
}));

import { PtyManager, buildAutoModeSettings } from '../pty.js';
import type { AppConfig } from '../../shared/types.js';

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
    expect(permModeValue()).toBe('acceptEdits');
    expect(spawned[0].env.CLAUDE_CODE_ENABLE_AUTO_MODE).toBeUndefined();
    expect(spawned[0].args.filter((arg) => arg === '--permission-mode')).toHaveLength(1);
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

describe('buildAutoModeSettings', () => {
  it('returns undefined when nothing is configured', () => {
    expect(buildAutoModeSettings(BASE)).toBeUndefined();
  });

  it('splices $defaults in front of every non-empty list', () => {
    const block = buildAutoModeSettings({
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
    expect(buildAutoModeSettings({ ...BASE, autoModeClassifyAllShell: false })).toBeUndefined();
    expect(buildAutoModeSettings({ ...BASE, autoModeClassifyAllShell: true })).toEqual({
      classifyAllShell: true
    });
  });
});
