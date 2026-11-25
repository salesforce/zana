import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A durable Squad orchestrator's Claude argv is about 25 K before plugin
 * instructions; on Windows anything past 32766 characters is refused by
 * CreateProcess. Over the limit the system-prompt layers move to one file.
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
  alwaysOnPluginMcpAllowlist: () => [],
  sessionPluginMcpServers: () => []
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

const PERSONA_TEXT_UNUSED = 'PERSONA-ROLE-CONTRACT: review only, never merge.';
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



const lineLength = (c: SpawnCall) => [c.command, ...c.args].reduce((n, a) => n + a.length + 3, 0);
const launch = (pluginLen: number) => {
  spawns.length = 0;
  const mgr = new PtyManager();
  mgr.setMcpBaseUrl(MCP_BASE);
  const persona = personaFor('claude', { id: 'builtin:orchestrator', appendSystemPrompt: 'x'.repeat(1500), allowedTools: [], modelLevel: 'medium' } as never);
  create(mgr, 'claude', persona, {
    autonomous: true, coordinationMode: 'job-team', extraArgs: ['y'.repeat(9000)],
    ...(pluginLen ? { pluginInstructions: 'p'.repeat(pluginLen) } : {}),
    authoredPlanPaths: ['/tmp/work/.zcc/plan.md']
  });
  return { mgr, call: spawns[spawns.length - 1]! };
};
const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const setPlatform = (p: string) => Object.defineProperty(process, 'platform', { ...realPlatform, value: p });

describe('Windows orchestrator command line', () => {
  beforeEach(() => { vi.stubEnv('OPENCODE_CONFIG', undefined); });
  afterEach(() => { Object.defineProperty(process, 'platform', realPlatform); spawns.forEach((c) => c.fireExit()); });

  it('spills the system-prompt layers to a 0600 file when the line is over the limit', () => {
    setPlatform('win32');
    const { call } = launch(16000);
    expect(call.args).not.toContain('--append-system-prompt');
    expect(lineLength(call)).toBeLessThan(32766);
    const i = call.args.indexOf('--append-system-prompt-file');
    expect(i).toBeGreaterThan(-1);
    const path = call.args[i + 1]!;
    expect(path.startsWith(tmpdir()) || path.includes('zcc-session-mcp')).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('x'.repeat(1500));
    expect(text).toContain('p'.repeat(16000));
    if (process.platform !== 'win32' && realPlatform.value !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    call.fireExit();
    expect(existsSync(path)).toBe(false);
  });

  it('keeps inline layers when the line fits', () => {
    setPlatform('win32');
    const { call } = launch(0);
    expect(call.args).toContain('--append-system-prompt');
    expect(call.args).not.toContain('--append-system-prompt-file');
  });

  it('keeps inline layers on other platforms even when long', () => {
    setPlatform('linux');
    const { call } = launch(16000);
    expect(call.args).toContain('--append-system-prompt');
    expect(call.args).not.toContain('--append-system-prompt-file');
  });
});
