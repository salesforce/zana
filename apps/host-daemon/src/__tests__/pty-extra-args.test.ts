import { describe, it, expect, beforeEach, vi } from 'vitest';

// PtyManager imports node-pty (real subprocesses). Mock it with a fake IPty
// that RECORDS the argv it was spawned with, so we can assert exactly what
// reaches the command line — in particular, that a blank opening prompt never
// lands as a stray positional.
interface FakeProc {
  pid: number;
  args: string[];
  write: () => void;
  onData: () => void;
  onExit: () => void;
  resize: () => void;
  kill: () => void;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: (_command: string, args: string[]) => {
    const proc: FakeProc = {
      pid: 2000 + spawned.length,
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

// Keep claude-profile spawns from writing a real ~/.zcc/mcp file.
vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`
}));

import { PtyManager, cleanExtraArgs, extractPinnedSessionId } from '../pty.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

const UUID = 'a8ca9b2c-eaaa-4b62-b865-841a9344151e';

/** Pull the value following a flag in a recorded argv (or undefined). */
function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

describe('cleanExtraArgs', () => {
  it('drops an empty-string opening prompt so no stray positional is emitted', () => {
    expect(cleanExtraArgs([''])).toEqual([]);
  });

  it('drops whitespace-only prompt args', () => {
    expect(cleanExtraArgs(['   ', '\n', '\t'])).toEqual([]);
  });

  it('passes a non-empty prompt through unchanged', () => {
    expect(cleanExtraArgs(['Investigate W-123'])).toEqual(['Investigate W-123']);
  });

  it('preserves real flags and the -- end-of-options marker, dropping only blanks', () => {
    expect(cleanExtraArgs(['--', '-leading-dash prompt', ''])).toEqual([
      '--',
      '-leading-dash prompt'
    ]);
  });

  it('treats undefined as an empty arg list', () => {
    expect(cleanExtraArgs(undefined)).toEqual([]);
  });
});

describe('PtyManager.create — empty-prompt invariant', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('never spawns claude with a blank positional when the prompt is empty', () => {
    const mgr = new PtyManager();
    mgr.create({
      projectId: 'p1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      extraArgs: ['']
    });
    const argv = spawned[0].args;
    expect(argv).not.toContain('');
  });

  it('passes a non-empty opening prompt through as a positional', () => {
    const mgr = new PtyManager();
    mgr.create({
      projectId: 'p1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      extraArgs: ['Investigate W-123']
    });
    expect(spawned[0].args).toContain('Investigate W-123');
  });
});

describe('PtyManager.create — autonomous team runs (yolo base)', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  // A persona pinning baseProfile 'claude' + permissionMode 'plan'. An
  // autonomous spawn must OVERRIDE that base onto claude-yolo (full bypass).
  const promptingPersona = {
    id: 'builtin:orchestrator',
    name: 'Orchestrator',
    baseProfile: 'claude' as const,
    permissionMode: 'plan' as const
  };

  // Autonomous squad runs launch on the claude-yolo base for maximum autonomy:
  // --dangerously-skip-permissions (no per-tool prompts at all), OVERRIDING the
  // persona's claude base + plan mode. Because skip-permissions is strictly
  // broader, no --permission-mode flag is emitted (the CLI rejects combining
  // them).
  it('launches on the yolo base (--dangerously-skip-permissions) and emits no --permission-mode', () => {
    const mgr = new PtyManager();
    mgr.create({
      projectId: 'p1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      persona: promptingPersona,
      autonomous: true
    });
    const argv = spawned[0].args;
    expect(argv).toContain('--dangerously-skip-permissions');
    // No --permission-mode alongside full bypass (would conflict / be redundant).
    expect(argv).not.toContain('--permission-mode');
  });

  it('without autonomous, the same persona keeps its own permission-mode (plan)', () => {
    const mgr = new PtyManager();
    mgr.create({
      projectId: 'p1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      persona: promptingPersona
    });
    const argv = spawned[0].args;
    expect(argv).not.toContain('--dangerously-skip-permissions');
    expect(flagValue(argv, '--permission-mode')).toBe('plan');
  });

  // The decisive gate for "agents talk without approval": agent_send is the tool
  // autonomous teammates use to message each other. Prompt-on-first-send for
  // normal agents, pre-approved for autonomous runs.
  it('pre-approves agent_send in --allowedTools ONLY for autonomous runs', () => {
    const mgr = new PtyManager();
    // The mesh allowlist is gated on an MCP config being wired (mcpBaseUrl set);
    // the file path itself is mocked (ensureMcpConfigForProjectSync above).
    mgr.setMcpBaseUrl('http://127.0.0.1:9999');
    mgr.create({
      projectId: 'p1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      autonomous: true
    });
    const allowed = flagValue(spawned[0].args, '--allowedTools') ?? '';
    expect(allowed).toContain('mcp__zcc-inbox__agent_send');
  });

  it('does NOT pre-approve agent_send for a normal (non-autonomous) agent', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:9999');
    mgr.create({
      projectId: 'p1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG
    });
    const allowed = flagValue(spawned[0].args, '--allowedTools') ?? '';
    // agent_inbox IS pre-approved (read-only); agent_send is NOT (prompt-on-first-send).
    expect(allowed).toContain('mcp__zcc-inbox__agent_inbox');
    expect(allowed).not.toContain('mcp__zcc-inbox__agent_send');
  });

  // AskUserQuestion is a built-in TOOL that interactively asks the user and
  // BLOCKS — acceptEdits does not suppress it. Autonomous runs must disallow it
  // so an unsure agent decides instead of stalling on the operator.
  it('disallows AskUserQuestion for autonomous runs', () => {
    const mgr = new PtyManager();
    mgr.create({
      projectId: 'p1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      autonomous: true
    });
    const denied = flagValue(spawned[0].args, '--disallowedTools') ?? '';
    expect(denied).toContain('AskUserQuestion');
  });

  it('does NOT disallow AskUserQuestion for a normal agent', () => {
    const mgr = new PtyManager();
    mgr.create({
      projectId: 'p1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG
    });
    const denied = flagValue(spawned[0].args, '--disallowedTools') ?? '';
    expect(denied).not.toContain('AskUserQuestion');
  });
});

describe('extractPinnedSessionId', () => {
  it('recovers a UUID from --resume <uuid>', () => {
    expect(extractPinnedSessionId(['--resume', UUID])).toBe(UUID);
    expect(extractPinnedSessionId(['-r', UUID])).toBe(UUID);
    expect(extractPinnedSessionId(['--session-id', UUID])).toBe(UUID);
  });

  it('recovers a UUID from the =-joined forms', () => {
    expect(extractPinnedSessionId([`--resume=${UUID}`])).toBe(UUID);
    expect(extractPinnedSessionId([`--session-id=${UUID}`])).toBe(UUID);
  });

  it('returns undefined for a bare --resume (the picker, no id)', () => {
    expect(extractPinnedSessionId(['--resume'])).toBeUndefined();
    expect(extractPinnedSessionId(['--resume', '--model'])).toBeUndefined();
  });

  it('returns undefined when no resume/session flag is present', () => {
    expect(extractPinnedSessionId(['--model', 'opus'])).toBeUndefined();
  });
});

describe('PtyManager.create — per-tab claude session id', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('mints a --session-id and stamps it on the session for a fresh claude tab', () => {
    const mgr = new PtyManager();
    const session = mgr.create({
      projectId: 'p1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG
    });
    const id = flagValue(spawned[0].args, '--session-id');
    expect(id).toBeDefined();
    // The forced id is what the session reports, so restore can resume it.
    expect(session.claudeSessionId).toBe(id);
  });

  it('gives sibling tabs in the same cwd DISTINCT session ids', () => {
    const mgr = new PtyManager();
    const a = mgr.create({ projectId: 'p1', profile: 'claude', cwd: '/tmp', cols: 80, rows: 24, config: CONFIG });
    const b = mgr.create({ projectId: 'p1', profile: 'claude', cwd: '/tmp', cols: 80, rows: 24, config: CONFIG });
    expect(a.claudeSessionId).toBeDefined();
    expect(b.claudeSessionId).toBeDefined();
    expect(a.claudeSessionId).not.toBe(b.claudeSessionId);
  });

  it('does NOT mint a second id when restore pins --resume <uuid>, but surfaces that id', () => {
    const mgr = new PtyManager();
    const session = mgr.create({
      projectId: 'p1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      extraArgs: ['--resume', UUID]
    });
    // No forced --session-id (would conflict with --resume) ...
    expect(spawned[0].args).not.toContain('--session-id');
    // ... but the pinned id is surfaced so the resume chain survives relaunches.
    expect(session.claudeSessionId).toBe(UUID);
  });

  it('does not mint a session id for shell tabs', () => {
    const mgr = new PtyManager();
    const session = mgr.create({
      projectId: 'p1',
      profile: 'shell',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG
    });
    expect(spawned[0].args).not.toContain('--session-id');
    expect(session.claudeSessionId).toBeUndefined();
  });
});
