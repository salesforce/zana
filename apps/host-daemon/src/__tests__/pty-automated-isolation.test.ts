import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Spawn {
  command: string;
  args: string[];
  env: Record<string, string>;
  exit: () => void;
}
const spawned: Spawn[] = [];
const spawnControl = { failNext: false };

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[], opts: { env?: Record<string, string> }) => {
    if (spawnControl.failNext) {
      spawnControl.failNext = false;
      throw new Error('spawn failed');
    }
    let onExit: (event: { exitCode: number }) => void = () => undefined;
    spawned.push({
      command,
      args,
      env: opts?.env ?? {},
      exit: () => onExit({ exitCode: 0 })
    });
    return {
      pid: 3000 + spawned.length,
      write() {},
      onData() {},
      onExit(cb: (event: { exitCode: number }) => void) {
        onExit = cb;
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

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

const ENV_KEYS = ['ZCC_DATA_DIR', 'CLAUDE_CONFIG_DIR'] as const;

function create(mgr: PtyManager, extra: Record<string, unknown> = {}) {
  return mgr.create({
    projectId: 'p1',
    profile: 'claude',
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    config: CONFIG,
    ...extra
  } as never);
}

describe('PtyManager.create — unattended Claude config isolation', () => {
  let dataDir: string;
  let claudeHome: string;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    spawned.length = 0;
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    dataDir = mkdtempSync(join(tmpdir(), 'zcc-pty-data-'));
    claudeHome = mkdtempSync(join(tmpdir(), 'zcc-pty-claude-'));
    writeFileSync(
      join(claudeHome, 'settings.json'),
      JSON.stringify({ apiKeyHelper: '/bin/helper', hooks: { Stop: [{ command: 'x' }] } })
    );
    process.env.ZCC_DATA_DIR = dataDir;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(claudeHome, { recursive: true, force: true });
  });

  it.each([['scheduled'], ['headless'], ['autonomous']])(
    'isolates a %s claude run and removes the dir on exit',
    (kind) => {
      const session = create(new PtyManager(), { [kind]: true });
      const call = spawned[0]!;
      const leaf = call.env.CLAUDE_CONFIG_DIR!;
      expect(leaf).toBe(join(dataDir, 'claude-automated-config', session.id));
      expect(statSync(leaf).mode & 0o777).toBe(0o700);
      const i = call.args.indexOf('--setting-sources');
      expect(call.args[i + 1]).toBe('user');
      expect(JSON.parse(readFileSync(join(leaf, 'settings.json'), 'utf8'))).toEqual({
        apiKeyHelper: '/bin/helper'
      });
      call.exit();
      expect(existsSync(leaf)).toBe(false);
      // the real projects dir (transcripts) survives teardown
      expect(existsSync(join(claudeHome, 'projects'))).toBe(true);
    }
  );

  it('releases the config dir when the spawn throws', () => {
    spawnControl.failNext = true;
    expect(() => create(new PtyManager(), { scheduled: true })).toThrow('spawn failed');
    const parent = join(dataDir, 'claude-automated-config');
    expect(existsSync(parent) ? readdirSync(parent) : []).toEqual([]);
  });

  it('does not isolate an interactive claude run', () => {
    create(new PtyManager());
    expect(spawned[0]!.args).not.toContain('--setting-sources');
    expect(spawned[0]!.env.CLAUDE_CONFIG_DIR).toBe(claudeHome);
  });

  it('does not isolate a non-claude unattended run', () => {
    create(new PtyManager(), { profile: 'shell', scheduled: true });
    expect(spawned[0]!.args).not.toContain('--setting-sources');
    expect(existsSync(join(dataDir, 'claude-automated-config'))).toBe(false);
  });

  it('does not isolate a sandboxed unattended run', () => {
    try {
      create(new PtyManager(), { scheduled: true, environment: 'sandbox' });
    } catch {
      /* sandbox may be unavailable on this host; the dir assertion below is what matters */
    }
    expect(existsSync(join(dataDir, 'claude-automated-config'))).toBe(false);
  });
});
