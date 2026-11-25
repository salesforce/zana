import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * A durable Squad orchestrator's Claude argv is about 25 K before plugin
 * instructions; on Windows anything past 32766 characters is refused by
 * CreateProcess. Over the limit the system-prompt layers move to one file.
 */

interface SpawnCall {
  command: string;
  args: string[];
  fireExit: () => void;
}
const spawns: SpawnCall[] = [];
const fileSupport = vi.fn(() => true);

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[]) => {
    let onExitCb: ((e: { exitCode: number }) => void) | undefined;
    const call: SpawnCall = { command, args, fireExit: () => onExitCb?.({ exitCode: 0 }) };
    spawns.push(call);
    return {
      pid: 7000 + spawns.length,
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
  alwaysOnPluginMcpAllowlist: () => [],
  sessionPluginMcpServers: () => []
}));

vi.mock('../harness/claude/binary-identity.js', () => ({
  resolveGenuineClaudeFromPath: (fallback: string) => fallback
}));

vi.mock('../harness/claude/system-prompt-file-support.js', () => ({
  claudeSupportsAppendSystemPromptFile: () => fileSupport()
}));

import { PtyManager } from '../pty.js';
import type { AppConfig, Persona } from '@zana-ai/zcc-domain/product';

const MCP_BASE = 'http://127.0.0.1:39999';
const config = (): AppConfig =>
  ({ version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null, tmuxScope: 'off' }) as AppConfig;

const persona = (): Persona =>
  ({ id: 'builtin:orchestrator', name: 'Orchestrator', baseProfile: 'claude', appendSystemPrompt: 'x'.repeat(1500), allowedTools: [], modelLevel: 'medium' }) as unknown as Persona;

const lineLength = (c: SpawnCall) => [c.command, ...c.args].reduce((n, a) => n + a.length + 3, 0);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const normalise = (args: string[]) => args.map((a) => a.replace(UUID, '<SID>'));

const launch = (pluginLen: number) => {
  const mgr = new PtyManager();
  mgr.setMcpBaseUrl(MCP_BASE);
  mgr.create({
    projectId: 'proj1', profile: 'claude', cwd: '/tmp/work', cols: 80, rows: 24, config: config(),
    persona: persona(), squadSeat: true, autonomous: true, coordinationMode: 'job-team',
    extraArgs: ['y'.repeat(9000)],
    ...(pluginLen ? { pluginInstructions: 'p'.repeat(pluginLen) } : {}),
    authoredPlanPaths: ['/tmp/work/.zcc/plan.md']
  } as never);
  return spawns[spawns.length - 1]!;
};

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const setPlatform = (p: string) => Object.defineProperty(process, 'platform', { ...realPlatform, value: p });
const layersOf = (args: string[]) => args.flatMap((a, i) => (args[i - 1] === '--append-system-prompt' ? [a] : []));

describe('Windows orchestrator command line', () => {
  beforeEach(() => {
    spawns.length = 0;
    fileSupport.mockReset();
    fileSupport.mockReturnValue(true);
    vi.stubEnv('OPENCODE_CONFIG', undefined);
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform);
    spawns.forEach((c) => c.fireExit());
    vi.restoreAllMocks();
  });

  it('spills the system-prompt layers to its own 0600 file when the line is over the limit, and logs it', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    setPlatform('win32');
    const call = launch(16000);
    expect(call.args).not.toContain('--append-system-prompt');
    expect(lineLength(call)).toBeLessThan(32766);
    const i = call.args.indexOf('--append-system-prompt-file');
    expect(i).toBeGreaterThan(-1);
    const path = call.args[i + 1]!;
    // Own slot: never the plugin-instructions file (`<sid>.instructions.md`).
    expect(basename(path)).toMatch(/\.system-prompt\.md$/);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('x'.repeat(1500));
    expect(text).toContain('p'.repeat(16000));
    if (realPlatform.value !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/over the Windows limit; moved \d+ system-prompt layer\(s\), \d+ chars/));
    call.fireExit();
    expect(existsSync(path)).toBe(false);
  });

  it('gives the same concatenated prompt and the same position as the inline flags', () => {
    setPlatform('linux');
    const inline = launch(16000);
    const inlineArgs = normalise(inline.args);
    const layers = layersOf(inlineArgs);
    expect(layers.length).toBeGreaterThan(1);
    const firstFlag = inlineArgs.indexOf('--append-system-prompt');

    setPlatform('win32');
    const spilled = launch(16000);
    const winArgs = normalise(spilled.args);
    const fileFlag = winArgs.indexOf('--append-system-prompt-file');
    expect(fileFlag).toBe(firstFlag);
    expect(readFileSync(spilled.args[fileFlag + 1]!, 'utf8')).toBe(layers.join('\n\n'));
    const withoutFile = winArgs.filter((_, i) => i !== fileFlag && i !== fileFlag + 1);
    const withoutLayers = inlineArgs.filter((a, i) => a !== '--append-system-prompt' && inlineArgs[i - 1] !== '--append-system-prompt');
    expect(withoutFile.map((a) => a.replace(/[^\s]*zcc-session-mcp[^\s]*/g, '<F>'))).toEqual(
      withoutLayers.map((a) => a.replace(/[^\s]*zcc-session-mcp[^\s]*/g, '<F>'))
    );
  });

  it('keeps inline layers when the claude build does not support the file flag', () => {
    fileSupport.mockReturnValue(false);
    setPlatform('win32');
    expect(() => launch(16000)).toThrow(/over the Windows limit/);
    expect(spawns).toHaveLength(0);
  });

  it('keeps inline layers when the line fits', () => {
    setPlatform('win32');
    const call = launch(0);
    expect(call.args).toContain('--append-system-prompt');
    expect(call.args).not.toContain('--append-system-prompt-file');
    expect(fileSupport).not.toHaveBeenCalled();
  });

  it('keeps inline layers on other platforms even when long', () => {
    setPlatform('linux');
    const call = launch(16000);
    expect(call.args).toContain('--append-system-prompt');
    expect(call.args).not.toContain('--append-system-prompt-file');
  });
});
