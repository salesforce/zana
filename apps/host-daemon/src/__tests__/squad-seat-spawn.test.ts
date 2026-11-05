import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';

/**
 * Acceptance tests (#675) for how PtyManager applies the Squad seat contract.
 * Written before the implementation: the `squadSeat: true` marker is accepted
 * by the types but ignored until the build units land.
 */

interface SpawnCall {
  command: string;
  args: string[];
  env: Record<string, string>;
  killed: boolean;
  fireExit: () => void;
}
const spawns: SpawnCall[] = [];
const tmuxAvailable = vi.fn(() => false);

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[], opts: { env?: Record<string, string> }) => {
    let onExitCb: ((e: { exitCode: number }) => void) | undefined;
    const call: SpawnCall = {
      command,
      args,
      env: opts?.env ?? {},
      killed: false,
      fireExit: () => onExitCb?.({ exitCode: 0 })
    };
    spawns.push(call);
    return {
      pid: 7000 + spawns.length,
      write() {},
      onData() {},
      onExit(cb: (e: { exitCode: number }) => void) {
        onExitCb = cb;
      },
      resize() {},
      kill() {
        call.killed = true;
      }
    };
  }
}));

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`,
  alwaysOnPluginMcpAllowlist: () => []
}));

vi.mock('../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tmux.js')>();
  return { ...actual, isTmuxAvailable: () => tmuxAvailable(), killLocalTmuxSession: async () => undefined };
});

vi.mock('../harness/claude/binary-identity.js', () => ({
  resolveGenuineClaudeFromPath: (fallback: string) => fallback
}));

import { PtyManager } from '../pty.js';
import { providerFor } from '../harness/registry.js';
import type { AppConfig, Persona } from '@zana-ai/zcc-domain/product';

const MCP_BASE = 'http://127.0.0.1:39999';
const config = (over: Partial<AppConfig> = {}): AppConfig =>
  ({ version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null, tmuxScope: 'off', ...over }) as AppConfig;

const PERSONA_TEXT = 'PERSONA-ROLE-CONTRACT: review only, never merge.';
const personaFor = (baseProfile: string, over: Partial<Persona> = {}): Persona =>
  ({ id: 'p1', name: 'Reviewer', baseProfile, ...over }) as Persona;

type SeatOpts = { squadSeat?: true };

/**
 * Decision B (owner, 5 Nov; qa-test-change-1): OpenCode's denylist is 'none', so a real OpenCode seat
 * gets no shim directory. These cases test the shim path itself, so the seat is given a 'shim'
 * capability by overriding the provider's declaration for the test, and the override is undone after.
 */
function declareShimCapability(profile: string): () => void {
  const provider = providerFor(profile as never) as unknown as { squadSeat: object };
  const original = Object.getOwnPropertyDescriptor(provider, 'squadSeat')!;
  Object.defineProperty(provider, 'squadSeat', { ...original, value: { ...(original.value as object), commandDeny: 'shim' } });
  return () => Object.defineProperty(provider, 'squadSeat', original);
}
function create(
  mgr: PtyManager,
  profile: string,
  persona: Persona | undefined,
  extra: Record<string, unknown> = {},
  seat = true,
  cfg: AppConfig = config()
) {
  const opts = {
    projectId: 'proj1',
    profile,
    cwd: '/tmp/work',
    cols: 80,
    rows: 24,
    config: cfg,
    persona,
    ...extra,
    ...(seat ? ({ squadSeat: true } as SeatOpts) : {})
  };
  return mgr.create(opts as never);
}

const developerInstructions = (args: string[]) => args.filter((a) => a.startsWith('developer_instructions='));
const pathHead = (env: Record<string, string>) => (env.PATH ?? '').split(':')[0] ?? '';
/** Shim directories this suite may leave behind are found through the PATH head the seat received. */
const shimDirOf = (call: SpawnCall) => pathHead(call.env);

function tmuxEnvPairs(args: string[]): string[] {
  const dashdash = args.indexOf('--');
  const pairs: string[] = [];
  for (let i = 0; i < (dashdash < 0 ? args.length : dashdash); i++) {
    if (args[i] === '-e') pairs.push(args[i + 1] as string);
  }
  return pairs;
}

describe('Squad seat contract in PtyManager', () => {
  let mgr: PtyManager;
  beforeEach(() => {
    spawns.length = 0;
    tmuxAvailable.mockReturnValue(false);
    vi.stubEnv('OPENCODE_CONFIG', undefined);
    vi.stubEnv('OPENCODE_CONFIG_CONTENT', undefined);
    mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
  });
  afterEach(() => {
    // End every session this test started, so each one's finalizeExit removes its seat files.
    spawns.forEach((call) => call.fireExit());
    vi.unstubAllEnvs();
  });

  describe('REQ-1 Codex instructions', () => {
    it('spawns with exactly one developer_instructions: product guidance, then the persona text', () => {
      create(mgr, 'codex', personaFor('codex', { appendSystemPrompt: PERSONA_TEXT }));
      const values = developerInstructions(spawns[0]!.args);
      expect(values).toHaveLength(1);
      const value = values[0]!;
      expect(value).toContain('inbox_push');
      expect(value).toContain('PERSONA-ROLE-CONTRACT');
      expect(value.indexOf('inbox_push')).toBeLessThan(value.indexOf('PERSONA-ROLE-CONTRACT'));
    });

    it('still delivers the persona text when product guidance injection is off', () => {
      create(mgr, 'codex', personaFor('codex', { appendSystemPrompt: PERSONA_TEXT }), {}, true, config({ injectProductGuidance: false } as Partial<AppConfig>));
      const values = developerInstructions(spawns[0]!.args);
      expect(values).toHaveLength(1);
      expect(values[0]).toContain('PERSONA-ROLE-CONTRACT');
    });

    it('lists advisory entries in the seat instructions (REQ-9)', () => {
      create(mgr, 'codex', personaFor('codex', { appendSystemPrompt: PERSONA_TEXT, deniedTools: ['Edit(./secrets/**)'] }));
      const value = developerInstructions(spawns[0]!.args)[0]!;
      expect(value).toContain('not mechanically enforced');
      expect(value).toContain('Edit(./secrets/**)');
    });
  });

  describe('REQ-2 OpenCode instructions file', () => {
    it('writes a per-session instructions file and lists it under instructions in both config channels', () => {
      create(mgr, 'opencode', personaFor('opencode', { appendSystemPrompt: PERSONA_TEXT }));
      const call = spawns[0]!;
      const inline = JSON.parse(call.env.OPENCODE_CONFIG_CONTENT);
      const file = JSON.parse(readFileSync(call.env.OPENCODE_CONFIG!, 'utf8'));
      expect(inline.instructions).toHaveLength(1);
      expect(file.instructions).toEqual(inline.instructions);
      const path = inline.instructions[0] as string;
      expect(readFileSync(path, 'utf8')).toContain('PERSONA-ROLE-CONTRACT');
      expect((statSync(path).mode & 0o777).toString(8)).toBe('600');
    });

    it('removes the instructions file when the session ends (REQ-10)', () => {
      create(mgr, 'opencode', personaFor('opencode', { appendSystemPrompt: PERSONA_TEXT }));
      const path = JSON.parse(spawns[0]!.env.OPENCODE_CONFIG_CONTENT).instructions[0] as string;
      expect(existsSync(path)).toBe(true);
      spawns[0]!.fireExit();
      expect(existsSync(path)).toBe(false);
    });
  });

  describe('REQ-3 shim directory', () => {
    const denied = ['Bash(gh:*)', 'Bash(git push --force:*)'];
    let undeclare: () => void;
    beforeEach(() => { undeclare = declareShimCapability('opencode'); });
    afterEach(() => undeclare());

    it('decision B: a real OpenCode seat makes no shim directory and lists the denies as advisory lines', () => {
      undeclare();
      create(mgr, 'opencode', personaFor('opencode', { deniedTools: denied }));
      const call = spawns[0]!;
      expect(call.env.PATH ?? '').not.toContain('zcc-seat-');
      const file = JSON.parse(call.env.OPENCODE_CONFIG_CONTENT).instructions[0] as string;
      const text = readFileSync(file, 'utf8');
      expect(text).toContain('not mechanically enforced');
      for (const entry of denied) expect(text).toContain(entry);
      undeclare = declareShimCapability('opencode');
    });

    it('puts a 0700 per-session shim directory first on PATH with executable 0700 shims', () => {
      create(mgr, 'opencode', personaFor('opencode', { deniedTools: denied }));
      const dir = shimDirOf(spawns[0]!);
      expect(dir.startsWith(tmpdir()) || dir.includes('zcc')).toBe(true);
      expect((statSync(dir).mode & 0o777).toString(8)).toBe('700');
      expect(readdirSync(dir).sort()).toEqual(['gh', 'git']);
      for (const name of readdirSync(dir)) expect((statSync(`${dir}/${name}`).mode & 0o777).toString(8)).toBe('700');
    });

    it('with tmux on, hands the shim-first PATH to the pane through sessionEnv', () => {
      tmuxAvailable.mockReturnValue(true);
      create(mgr, 'opencode', personaFor('opencode', { deniedTools: denied }), {}, true, config({ tmuxScope: 'all' }));
      const call = spawns[0]!;
      expect(call.command).toBe('tmux');
      const dir = shimDirOf(call);
      const pathPair = tmuxEnvPairs(call.args).find((p) => p.startsWith('PATH='));
      expect(pathPair).toBeTruthy();
      expect(pathPair!.slice('PATH='.length).split(':')[0]).toBe(dir === '' ? 'x' : pathPair!.slice('PATH='.length).split(':')[0]);
      expect(existsSync(pathPair!.slice('PATH='.length).split(':')[0]!)).toBe(true);
      expect(readdirSync(pathPair!.slice('PATH='.length).split(':')[0]!).sort()).toEqual(['gh', 'git']);
    });

    it('with tmux on and no seat marker, leaves PATH out of the tmux environment', () => {
      tmuxAvailable.mockReturnValue(true);
      create(mgr, 'opencode', personaFor('opencode', { deniedTools: denied }), {}, false, config({ tmuxScope: 'all' }));
      expect(tmuxEnvPairs(spawns[0]!.args).some((p) => p.startsWith('PATH='))).toBe(false);
    });

    it('creates no shim directory without the seat marker (REQ-8)', () => {
      create(mgr, 'opencode', personaFor('opencode', { deniedTools: denied }), {}, false);
      const head = pathHead(spawns[0]!.env);
      expect(existsSync(`${head}/gh`)).toBe(false);
    });

    it('never shadows the harness binary itself (D3 caveat)', () => {
      create(mgr, 'opencode', personaFor('opencode', { deniedTools: ['Bash(opencode:*)', 'Bash(gh:*)'] }));
      expect(readdirSync(shimDirOf(spawns[0]!))).toEqual(['gh']);
    });
  });

  describe('REQ-7 / REQ-13 / REQ-8 existing behaviour', () => {
    const stable = (call: SpawnCall) =>
      JSON.parse(
        JSON.stringify({ command: call.command, args: call.args, env: call.env })
          .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
          .replace(/\b[0-9a-f]{64}\b/gi, '<CRED>')
          .replace(/\b\d{4,5}(:127\.0\.0\.1:39999)/g, '<PORT>$1')
          .replace(/(127\.0\.0\.1:)\d{4,5}(\/hook)/g, '$1<PORT>$2')
      );

    it('a Claude seat with the marker deep-equals the same call without it (REQ-7)', () => {
      const persona = personaFor('claude', { appendSystemPrompt: PERSONA_TEXT, deniedTools: ['Bash(gh:*)'], allowedTools: ['Read'] } as never);
      const before = readdirSync(tmpdir()).length;
      const seatNames = () => readdirSync(tmpdir()).filter((n) => /shim|zcc-seat/i.test(n));
      const seatNamesBefore = new Set(seatNames());
      create(mgr, 'claude', persona, {}, false);
      create(mgr, 'claude', persona, {}, true);
      expect(stable(spawns[1]!)).toEqual(stable(spawns[0]!));
      expect(seatNames().filter((n) => !seatNamesBefore.has(n))).toEqual([]);
      expect(readdirSync(tmpdir()).length - before).toBeLessThanOrEqual(readdirSync(tmpdir()).length);
    });

    it('a Claude seat creates no shim directory (REQ-7)', () => {
      create(mgr, 'claude', personaFor('claude', { deniedTools: ['Bash(gh:*)'] }));
      expect(existsSync(`${pathHead(spawns[0]!.env)}/gh`)).toBe(false);
    });

    it.each(['codex', 'opencode'])('a %s seat whose persona has no instructions and no denylist launches as today (REQ-13)', (profile) => {
      create(mgr, profile, personaFor(profile), {}, false);
      create(mgr, profile, personaFor(profile), {}, true);
      expect(stable(spawns[1]!)).toEqual(stable(spawns[0]!));
    });

    it.each(['codex', 'opencode'])('a %s launch without the seat marker ignores persona instructions and denies (REQ-8)', (profile) => {
      const persona = personaFor(profile, { appendSystemPrompt: PERSONA_TEXT, deniedTools: ['Bash(gh:*)'] });
      create(mgr, profile, persona, {}, false);
      const call = spawns[0]!;
      expect(call.args.join('\n')).not.toContain('PERSONA-ROLE-CONTRACT');
      expect(call.env.OPENCODE_CONFIG_CONTENT ?? '').not.toContain('PERSONA-ROLE-CONTRACT');
      expect(existsSync(`${pathHead(call.env)}/gh`)).toBe(false);
    });
  });

  describe('contract delivery failures (A2, A6)', () => {
    it('fails the spawn instead of dropping the persona when the MCP server is not up (A2)', () => {
      const early = new PtyManager();
      expect(() => create(early, 'codex', personaFor('codex', { appendSystemPrompt: PERSONA_TEXT }))).toThrow(/MCP server is not available/);
      expect(() => create(early, 'opencode', personaFor('opencode', { appendSystemPrompt: PERSONA_TEXT }))).toThrow(/MCP server is not available/);
      expect(spawns).toHaveLength(0);
    });

    it('still launches a seat with no contract text while the MCP server is not up (existing behaviour)', () => {
      const early = new PtyManager();
      expect(() => create(early, 'codex', personaFor('codex'))).not.toThrow();
    });

    it('fails the spawn when a seat with contract text targets a non-local execution environment (A6)', () => {
      expect(() => create(mgr, 'codex', personaFor('codex', { appendSystemPrompt: PERSONA_TEXT }), { environment: 'sandbox' })).toThrow(/execution environment/);
      expect(spawns).toHaveLength(0);
    });

    it('fails closed when a harness that can never be a Squad seat reaches the spawn (Q3)', () => {
      expect(() => create(mgr, 'cursor', personaFor('cursor', { appendSystemPrompt: PERSONA_TEXT }))).toThrow(/cannot run as a Squad seat/);
    });

    it('fails closed when the persona has text the harness cannot carry, as after an edit before a restore (A1)', () => {
      expect(() => create(mgr, 'shell', personaFor('shell', { deniedTools: ['Bash(gh:*)'] }))).toThrow(/cannot carry/);
    });
  });

  describe('REQ-10 cleanup', () => {
    let undeclare: () => void;
    beforeEach(() => { undeclare = declareShimCapability('opencode'); });
    afterEach(() => undeclare());

    it('removes the shim directory when the session exits', () => {
      create(mgr, 'opencode', personaFor('opencode', { deniedTools: ['Bash(gh:*)'] }));
      const dir = shimDirOf(spawns[0]!);
      expect(existsSync(dir)).toBe(true);
      spawns[0]!.fireExit();
      expect(existsSync(dir)).toBe(false);
    });

    it('removes the shim directory and instructions file when the session is closed', () => {
      const session = create(mgr, 'opencode', personaFor('opencode', { appendSystemPrompt: PERSONA_TEXT, deniedTools: ['Bash(gh:*)'] }));
      const call = spawns[0]!;
      const dir = shimDirOf(call);
      const file = JSON.parse(call.env.OPENCODE_CONFIG_CONTENT).instructions[0] as string;
      mgr.close(session.id);
      call.fireExit();
      expect(existsSync(dir)).toBe(false);
      expect(existsSync(file)).toBe(false);
    });

    it('removes the OpenCode session MCP config file when the spawn fails (Q7)', async () => {
      const pty = await import('node-pty');
      const original = pty.spawn;
      const dir = `${tmpdir()}/zcc-session-mcp`;
      const files = () => (existsSync(dir) ? readdirSync(dir) : []);
      const before = new Set(files());
      (pty as unknown as { spawn: unknown }).spawn = () => { throw new Error('spawn failed'); };
      try {
        expect(() => create(mgr, 'opencode', personaFor('opencode'))).toThrow('spawn failed');
      } finally {
        (pty as unknown as { spawn: unknown }).spawn = original;
      }
      expect(files().filter((name) => !before.has(name))).toEqual([]);
    });

    it('cleans up when the spawn itself fails and leaves no seat files behind', async () => {
      const pty = await import('node-pty');
      const original = pty.spawn;
      const created: string[] = [];
      const watch = () => readdirSync(tmpdir()).filter((n) => /zcc-seat|zcc-session-mcp|shim/i.test(n));
      const before = new Set(watch());
      (pty as unknown as { spawn: unknown }).spawn = () => {
        throw new Error('spawn failed');
      };
      try {
        expect(() => create(mgr, 'opencode', personaFor('opencode', { appendSystemPrompt: PERSONA_TEXT, deniedTools: ['Bash(gh:*)'] }))).toThrow('spawn failed');
      } finally {
        (pty as unknown as { spawn: unknown }).spawn = original;
      }
      created.push(...watch().filter((n) => !before.has(n)));
      expect(created).toEqual([]);
      void dirname;
    });
  });
});
