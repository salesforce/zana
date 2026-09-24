import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock node-pty so constructing PtyManager / injecting a live session never
// touches a real terminal.
vi.mock('node-pty', () => ({
  spawn: () => ({ pid: 1, write() {}, onData() { return { dispose() {} }; }, onExit() { return { dispose() {} }; }, resize() {}, kill() {} })
}));

// Preserve the rest of node:child_process (opencode provider imports `spawn`)
// but replace `execFile` with a controllable fake — the ssh probe round-trip.
const execFileMock = vi.fn();
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: (...args: unknown[]) => execFileMock(...args)
}));

import { PtyManager } from '../pty.js';
import type { LaunchProfileId } from '@zana-ai/zcc-domain/product';

type ProbeCb = (error: (Error & { code?: number | string; killed?: boolean }) | null, stdout: string) => void;

/** Make execFile resolve the ssh probe with a fixed (error, stdout). */
function respondWith(result: { error?: Error & { killed?: boolean }; stdout?: string }): void {
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ProbeCb) => {
    cb(result.error ?? null, result.stdout ?? '');
  });
}

/**
 * Inject a minimal live session into the manager's private map so we test the
 * REAL probeAgentLiveness wiring (reattach gate → providerFor(profile) →
 * capability gate → classifyPaneCommand) without driving the full remote
 * `create()` plumbing. probeAgentLiveness reads only `reattach` + `session.profile`.
 */
function injectSession(
  ptys: PtyManager,
  id: string,
  profile: LaunchProfileId,
  reattach: { target: string; tmuxName: string; probeOpts: string[] } | undefined
): void {
  const proc = { pid: 1, write() {}, onData() { return { dispose() {} }; }, onExit() { return { dispose() {} }; }, resize() {}, kill() {} };
  const entry: Record<string, unknown> = {
    session: { id, profile, projectId: 'p1', status: 'running', title: 't', createdAt: 0 },
    proc
  };
  if (reattach) {
    entry.reattach = { ...reattach, sshArgs: [], cols: 80, rows: 24, spawnEnv: {}, attempts: 0 };
  }
  (ptys as unknown as { live: Map<string, unknown> }).live.set(id, entry);
}

const REMOTE = { target: 'user@box', tmuxName: 'cc-sess', probeOpts: ['-o', 'ServerAliveInterval=5'] };

describe('PtyManager.probeAgentLiveness (real method wiring)', () => {
  let ptys: PtyManager;

  beforeEach(() => {
    execFileMock.mockReset();
    ptys = new PtyManager();
  });

  it('reports DEAD for an OpenCode remote worker whose pane runs a login shell (the zombie)', async () => {
    respondWith({ stdout: 'bash\n' });
    injectSession(ptys, 'sess', 'opencode', REMOTE);

    const verdict = await ptys.probeAgentLiveness('sess');

    expect(verdict).toBe('dead');
    // Proves the argv: probe opts + BatchMode + target + the pane-command query
    // as a SINGLE single-quoted remote operand (ssh re-parses trailing operands
    // under a remote `sh -c`; a bare `#{…}` would be swallowed as a comment).
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileMock.mock.calls[0];
    expect(cmd).toBe('ssh');
    expect(args).toEqual([
      '-o', 'ServerAliveInterval=5',
      '-o', 'BatchMode=yes',
      'user@box',
      "tmux display-message -p -t 'cc-sess' '#{pane_current_command}'"
    ]);
  });

  it('reports ALIVE for an OpenCode remote worker whose pane runs the agent binary', async () => {
    respondWith({ stdout: 'opencode\n' });
    injectSession(ptys, 'sess', 'opencode', REMOTE);
    expect(await ptys.probeAgentLiveness('sess')).toBe('alive');
  });

  it('reports UNKNOWN (and never runs ssh) for a provider that does not report liveness', async () => {
    respondWith({ stdout: 'bash\n' }); // would classify dead IF the provider reported liveness
    injectSession(ptys, 'sess', 'claude', REMOTE);
    expect(await ptys.probeAgentLiveness('sess')).toBe('unknown');
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('reports UNKNOWN (and never runs ssh) for a local session with no reattach recipe', async () => {
    respondWith({ stdout: 'bash\n' });
    injectSession(ptys, 'sess', 'opencode', undefined);
    expect(await ptys.probeAgentLiveness('sess')).toBe('unknown');
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('reports UNKNOWN on an ssh failure — fail safe, never a false dead', async () => {
    respondWith({ error: Object.assign(new Error('timed out'), { killed: true }), stdout: 'bash' });
    injectSession(ptys, 'sess', 'opencode', REMOTE);
    expect(await ptys.probeAgentLiveness('sess')).toBe('unknown');
  });

  it('reports UNKNOWN for an unknown session id', async () => {
    respondWith({ stdout: 'bash\n' });
    expect(await ptys.probeAgentLiveness('nope')).toBe('unknown');
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
