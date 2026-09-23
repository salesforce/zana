import { describe, it, expect, vi } from 'vitest';
import {
  AgentLivenessCache,
  DEFAULT_LIVENESS_STALE_MS,
  probeAgentLiveness,
  type AgentLiveness,
  type ProbeExecError,
  type ProbeRunner
} from '../agent-liveness.js';

/**
 * A fake `execFile`-shaped runner: enqueue the (error, stdout) it should hand
 * back, and it records every argv it was called with. Never touches the network.
 */
function fakeRunner(result: { error?: ProbeExecError; stdout?: string }): {
  run: ProbeRunner;
  calls: { command: string; args: string[]; timeout: number }[];
} {
  const calls: { command: string; args: string[]; timeout: number }[] = [];
  const run: ProbeRunner = (command, args, options, cb) => {
    calls.push({ command, args, timeout: options.timeout });
    cb(result.error ?? null, result.stdout ?? '');
  };
  return { run, calls };
}

// Isolate the probe from the real provider classifier: a tiny stub is enough to
// prove the probe wires stdout → classify and fails safe on error.
const stubClassify = (command: string): AgentLiveness =>
  command.includes('bash') ? 'dead' : command.includes('opencode') ? 'alive' : 'unknown';

describe('probeAgentLiveness', () => {
  it('classifies a login-shell pane command as dead', async () => {
    const { run, calls } = fakeRunner({ stdout: 'bash\n' });
    const verdict = await probeAgentLiveness({
      execFile: run, target: 'user@host', tmuxName: 'zcc-x', probeOpts: ['-o', 'ServerAliveInterval=5'],
      timeoutMs: 12_000, classify: stubClassify
    });
    expect(verdict).toBe('dead');
    // Argv carries the probe opts, BatchMode, the target, and the pane-command query.
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('ssh');
    expect(calls[0].timeout).toBe(12_000);
    expect(calls[0].args).toEqual([
      '-o', 'ServerAliveInterval=5',
      '-o', 'BatchMode=yes',
      'user@host',
      'tmux', 'display-message', '-p', '-t', 'zcc-x', '#{pane_current_command}'
    ]);
  });

  it('classifies an agent-binary pane command as alive', async () => {
    const { run } = fakeRunner({ stdout: 'opencode\n' });
    const verdict = await probeAgentLiveness({
      execFile: run, target: 'host', tmuxName: 'zcc-x', probeOpts: [], timeoutMs: 12_000, classify: stubClassify
    });
    expect(verdict).toBe('alive');
  });

  it('returns unknown on any ssh error, ignoring stdout (fail safe — never a false dead)', async () => {
    const { run } = fakeRunner({ error: Object.assign(new Error('timed out'), { killed: true }), stdout: 'bash' });
    const verdict = await probeAgentLiveness({
      execFile: run, target: 'host', tmuxName: 'zcc-x', probeOpts: [], timeoutMs: 12_000, classify: stubClassify
    });
    expect(verdict).toBe('unknown');
  });

  it('returns unknown for an unrecognized pane command', async () => {
    const { run } = fakeRunner({ stdout: 'some-random-tool' });
    const verdict = await probeAgentLiveness({
      execFile: run, target: 'host', tmuxName: 'zcc-x', probeOpts: [], timeoutMs: 12_000, classify: stubClassify
    });
    expect(verdict).toBe('unknown');
  });

  it('short-circuits a leading-dash target to unknown WITHOUT running ssh', async () => {
    const { run, calls } = fakeRunner({ stdout: 'opencode' });
    const verdict = await probeAgentLiveness({
      execFile: run, target: '-oProxyCommand=evil', tmuxName: 'zcc-x', probeOpts: [], timeoutMs: 12_000, classify: stubClassify
    });
    expect(verdict).toBe('unknown');
    expect(calls).toHaveLength(0);
  });
});

describe('AgentLivenessCache', () => {
  it('returns unknown for an unseen session and schedules a background probe', async () => {
    const probe = vi.fn(async () => 'dead' as AgentLiveness);
    const cache = new AgentLivenessCache(probe);
    expect(cache.get('s1')).toBe('unknown'); // nothing cached yet
    await vi.waitFor(() => expect(probe).toHaveBeenCalledWith('s1'));
    // Next tick sees the freshly-cached decisive verdict.
    expect(cache.get('s1')).toBe('dead');
  });

  it('returns a fresh decisive verdict synchronously after refresh', async () => {
    let clock = 1_000;
    const probe = vi.fn(async () => 'dead' as AgentLiveness);
    const cache = new AgentLivenessCache(probe, { now: () => clock, staleMs: DEFAULT_LIVENESS_STALE_MS });
    await cache.refresh('s1');
    expect(cache.get('s1')).toBe('dead');
    expect(probe).toHaveBeenCalledTimes(1); // fresh — no re-probe
  });

  it('treats a verdict older than staleMs as unknown and re-probes', async () => {
    let clock = 1_000;
    const probe = vi.fn(async () => 'dead' as AgentLiveness);
    const cache = new AgentLivenessCache(probe, { now: () => clock, staleMs: 90_000 });
    await cache.refresh('s1');
    expect(cache.get('s1')).toBe('dead');
    clock += 90_001; // stale
    expect(cache.get('s1')).toBe('unknown');
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
  });

  it('does NOT cache an unknown verdict — re-probes every tick until decisive', async () => {
    const probe = vi.fn(async () => 'unknown' as AgentLiveness);
    const cache = new AgentLivenessCache(probe);
    await cache.refresh('s1');
    expect(cache.get('s1')).toBe('unknown');
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2)); // get re-scheduled a probe
  });

  it('dedupes concurrent in-flight probes for the same session', async () => {
    let resolveProbe: (v: AgentLiveness) => void = () => {};
    const probe = vi.fn(() => new Promise<AgentLiveness>((resolve) => { resolveProbe = resolve; }));
    const cache = new AgentLivenessCache(probe);
    cache.get('s1');
    cache.get('s1');
    cache.get('s1');
    expect(probe).toHaveBeenCalledTimes(1); // one in-flight probe, not three
    resolveProbe('dead');
    await vi.waitFor(() => expect(cache.get('s1')).toBe('dead'));
  });

  it('evict drops the cached verdict', async () => {
    let clock = 1_000;
    const probe = vi.fn(async () => 'dead' as AgentLiveness);
    const cache = new AgentLivenessCache(probe, { now: () => clock });
    await cache.refresh('s1');
    expect(cache.get('s1')).toBe('dead');
    cache.evict('s1');
    expect(cache.get('s1')).toBe('unknown'); // gone
  });

  it('does not throw when the injected probe rejects', async () => {
    const probe = vi.fn(async () => { throw new Error('boom'); });
    const cache = new AgentLivenessCache(probe);
    await expect(cache.refresh('s1')).resolves.toBe('unknown');
    expect(cache.get('s1')).toBe('unknown');
  });
});
