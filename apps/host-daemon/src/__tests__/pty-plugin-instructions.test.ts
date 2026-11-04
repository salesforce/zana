import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let failGateWrite = false;
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: ((path: unknown, ...rest: unknown[]) => {
      if (failGateWrite && (String(path).endsWith('.native-tool-gate.mjs') || String(path).endsWith('hooks.json'))) throw new Error('disk full');
      return (actual.writeFileSync as (...a: unknown[]) => void)(path, ...rest);
    }) as typeof actual.writeFileSync
  };
});

/**
 * Per-session plugin instructions on PTY launches: the MAIN-only
 * `pluginInstructions` opt reaches Claude as an additive
 * `--append-system-prompt`, Codex folded into `developer_instructions`, and
 * OpenCode through a 0600 per-session file listed in its config `instructions`.
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
    spawns.push({ command, args, env: opts?.env ?? {}, fireExit: () => onExitCb?.({ exitCode: 0 }) });
    return {
      pid: 6000 + spawns.length,
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
import { PTY_SESSION_INSTRUCTIONS_MAX_CHARS } from '@zana-ai/zcc-contracts/runtime';
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
const TEXT = 'Instructions from the ZCC plugin "demo":\nbe polite';

function launch(profile: string, pluginInstructions?: string) {
  const mgr = new PtyManager();
  mgr.setMcpBaseUrl(MCP_BASE);
  mgr.create({
    projectId: 'proj1',
    profile: profile as never,
    cwd: '/tmp/work',
    cols: 80,
    rows: 24,
    config: BASE_CONFIG,
    ...(pluginInstructions === undefined ? {} : { pluginInstructions })
  });
  return spawns[spawns.length - 1]!;
}

describe('PTY plugin instructions', () => {
  beforeEach(() => {
    spawns.length = 0;
    vi.stubEnv('OPENCODE_CONFIG', undefined);
    vi.stubEnv('OPENCODE_CONFIG_CONTENT', undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('adds an --append-system-prompt layer for Claude', () => {
    const { args } = launch('claude', TEXT);
    const at = args.findIndex((a, i) => a === '--append-system-prompt' && args[i + 1] === TEXT);
    expect(at).toBeGreaterThanOrEqual(0);
  });

  it('leaves Claude argv unchanged when the text is absent or blank', () => {
    const base = launch('claude').args;
    expect(launch('claude', '   \n').args.length).toBe(base.length);
    expect(base.join('\u0000')).not.toContain(TEXT);
  });

  it('folds the text into Codex developer_instructions', () => {
    const { args } = launch('codex', TEXT);
    const dev = args.find((a) => a.startsWith('developer_instructions='));
    expect(dev).toBeTruthy();
    expect(dev).toContain('be polite');
    expect(args).not.toContain('--append-system-prompt');
  });

  it('bounds the delivered text', () => {
    const { args } = launch('claude', 'x'.repeat(PTY_SESSION_INSTRUCTIONS_MAX_CHARS + 500));
    const at = args.indexOf('--append-system-prompt');
    const delivered = args.filter((a, i) => args[i - 1] === '--append-system-prompt' && a.startsWith('xxx'));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(delivered[0]!.length).toBe(PTY_SESSION_INSTRUCTIONS_MAX_CHARS);
  });

  it('lists a 0600 instructions file in the OpenCode config and unlinks it on exit', () => {
    const call = launch('opencode', TEXT);
    const cfg = JSON.parse(readFileSync(call.env.OPENCODE_CONFIG, 'utf8'));
    expect(Array.isArray(cfg.instructions)).toBe(true);
    const file = cfg.instructions.find((p: string) => p.endsWith('.instructions.md'));
    expect(file).toBeTruthy();
    expect(readFileSync(file, 'utf8')).toBe(TEXT);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    call.fireExit();
    expect(existsSync(file)).toBe(false);
  });

  it('adds no instructions file for OpenCode without text', () => {
    const call = launch('opencode');
    const cfg = JSON.parse(readFileSync(call.env.OPENCODE_CONFIG, 'utf8'));
    expect((cfg.instructions ?? []).some((p: string) => p.endsWith('.instructions.md'))).toBe(false);
  });
});

describe('PTY native tool gate (OpenCode)', () => {
  beforeEach(() => {
    spawns.length = 0;
    vi.stubEnv('OPENCODE_CONFIG', undefined);
    vi.stubEnv('OPENCODE_CONFIG_CONTENT', undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('names a 0600 gate module in the config, advertises the veto, and unlinks it on exit', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    const session = mgr.create({ projectId: 'proj1', profile: 'opencode' as never, cwd: '/tmp/work', cols: 80, rows: 24, config: BASE_CONFIG });
    const call = spawns[spawns.length - 1]!;
    const cfg = JSON.parse(readFileSync(call.env.OPENCODE_CONFIG, 'utf8'));
    expect(cfg.plugin).toHaveLength(1);
    const file = fileURLToPath(cfg.plugin[0]);
    expect(file.endsWith('.native-tool-gate.mjs')).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain(`${MCP_BASE}/hook/nativetool/proj1/${session.id}`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(session.capabilitySurface).toMatchObject({ harness: 'opencode', hookBase: true });
    call.fireExit();
    expect(existsSync(file)).toBe(false);
  });

  it('adds no gate when no policy transport exists and none is required', () => {
    const mgr = new PtyManager();
    const session = mgr.create({ projectId: 'proj1', profile: 'opencode' as never, cwd: '/tmp/work', cols: 80, rows: 24, config: BASE_CONFIG, nativeToolPolicyRequired: false });
    const call = spawns[spawns.length - 1]!;
    expect(call.env.OPENCODE_CONFIG).toBeUndefined();
    expect(session.capabilitySurface).toMatchObject({ hookBase: false });
  });

  it('refuses the spawn when a policy is required and the gate cannot be written', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    failGateWrite = true;
    try {
      expect(() => mgr.create({ projectId: 'proj1', profile: 'opencode' as never, cwd: '/tmp/work', cols: 80, rows: 24, config: BASE_CONFIG }))
        .toThrow(/native tool gate/);
      expect(spawns).toHaveLength(0);
      // Not required: the launch proceeds, honestly advertising no veto.
      const session = mgr.create({ projectId: 'proj1', profile: 'opencode' as never, cwd: '/tmp/work', cols: 80, rows: 24, config: BASE_CONFIG, nativeToolPolicyRequired: false });
      expect(session.capabilitySurface).toMatchObject({ hookBase: false });
      const cfg = JSON.parse(readFileSync(spawns[0]!.env.OPENCODE_CONFIG, 'utf8'));
      expect(cfg.plugin).toBeUndefined();
    } finally {
      failGateWrite = false;
    }
  });
});

describe('PTY native tool gate (directory on argv)', () => {
  beforeEach(() => { spawns.length = 0; });
  const create = (extra: Record<string, unknown> = {}) => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    const session = mgr.create({ projectId: 'proj1', profile: 'cursor' as never, cwd: '/tmp/work', cols: 80, rows: 24, config: BASE_CONFIG, ...extra });
    return { session, call: spawns[spawns.length - 1]! };
  };

  it('names a private gate directory with --plugin-dir, advertises the veto, and removes it on exit', () => {
    const { session, call } = create();
    const at = call.args.indexOf('--plugin-dir');
    expect(at).toBeGreaterThanOrEqual(0);
    const dir = call.args[at + 1]!;
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const hooksFile = join(dir, 'hooks', 'hooks.json');
    expect(statSync(hooksFile).mode & 0o777).toBe(0o600);
    const hooks = JSON.parse(readFileSync(hooksFile, 'utf8'));
    expect(hooks.hooks.preToolUse[0]).toMatchObject({ failClosed: true });
    expect(hooks.hooks.preToolUse[0].command).toContain(`${MCP_BASE}/hook/nativetool/proj1/${session.id}`);
    expect(session.capabilitySurface).toMatchObject({ harness: 'cursor', hookBase: true });
    call.fireExit();
    expect(existsSync(dir)).toBe(false);
  });

  it('adds no gate directory when no policy is required', () => {
    const { session, call } = create({ nativeToolPolicyRequired: false });
    expect(call.args).not.toContain('--plugin-dir');
    expect(session.capabilitySurface).toMatchObject({ hookBase: false });
  });

  it('refuses the spawn, leaving no directory, when a policy is required and the gate cannot be written', () => {
    failGateWrite = true;
    try {
      expect(() => create()).toThrow(/native tool gate/);
      expect(spawns).toHaveLength(0);
    } finally {
      failGateWrite = false;
    }
  });

  it('sweeps a crash-orphaned gate directory on the next launch', async () => {
    const root = join(tmpdir(), 'zcc-session-mcp');
    const orphan = join(root, 'orphan-session.native-tool-gate.d');
    mkdirSync(join(orphan, 'hooks'), { recursive: true });
    writeFileSync(join(orphan, 'hooks', 'hooks.json'), '{}');
    const old = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    utimesSync(orphan, old, old);
    // The sweep is throttled per minute; move the clock past any earlier run.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 10 * 60_000 });
    try {
      create();
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(() => expect(existsSync(orphan)).toBe(false), { timeout: 2000 });
  });
});
