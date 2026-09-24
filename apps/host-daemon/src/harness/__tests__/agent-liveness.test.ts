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
    // Argv carries the probe opts, BatchMode, the target, and — as a SINGLE
    // quoted remote-command string — the pane-command query. The tmux command
    // is one operand (not split argv): ssh space-joins trailing operands and
    // re-parses them under a remote `sh -c`, so a bare `#{…}` would be eaten as
    // a `#` comment. Single-quoting keeps the format string intact.
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('ssh');
    expect(calls[0].timeout).toBe(12_000);
    expect(calls[0].args).toEqual([
      '-o', 'ServerAliveInterval=5',
      '-o', 'BatchMode=yes',
      'user@host',
      "tmux display-message -p -t 'zcc-x' '#{pane_current_command}'"
    ]);
  });

  it('sends the tmux command as ONE quoted remote operand — never a bare #{…} (comment-eat regression)', async () => {
    const { run, calls } = fakeRunner({ stdout: 'opencode\n' });
    await probeAgentLiveness({
      execFile: run, target: 'user@host', tmuxName: 'zcc-x', probeOpts: [], timeoutMs: 12_000, classify: stubClassify
    });
    // Exactly one trailing operand after the target — the whole tmux invocation.
    const targetIdx = calls[0].args.indexOf('user@host');
    const trailing = calls[0].args.slice(targetIdx + 1);
    expect(trailing).toHaveLength(1);
    const remoteCmd = trailing[0];
    // The format string is single-quoted so the remote `sh -c` cannot treat `#`
    // as a comment; there is no un-quoted bare `#{pane_current_command}` operand.
    expect(remoteCmd).toContain("'#{pane_current_command}'");
    expect(calls[0].args).not.toContain('#{pane_current_command}');
  });

  it('POSIX-single-quote-escapes a tmux session name containing a single quote', async () => {
    const { run, calls } = fakeRunner({ stdout: 'opencode\n' });
    await probeAgentLiveness({
      execFile: run, target: 'user@host', tmuxName: "od'x", probeOpts: [], timeoutMs: 12_000, classify: stubClassify
    });
    const remoteCmd = calls[0].args[calls[0].args.length - 1];
    // `'` inside the name is closed-escaped-reopened: od'x -> 'od'\''x'
    expect(remoteCmd).toBe("tmux display-message -p -t 'od'\\''x' '#{pane_current_command}'");
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
    // A later tick sees the freshly-cached decisive verdict (get re-probes until stored).
    await vi.waitFor(() => expect(cache.get('s1')).toBe('dead'));
  });

  it('returns a fresh decisive verdict synchronously and proactively re-probes on read', async () => {
    let clock = 1_000;
    const probe = vi.fn(async () => 'dead' as AgentLiveness);
    const cache = new AgentLivenessCache(probe, { now: () => clock, staleMs: DEFAULT_LIVENESS_STALE_MS });
    await cache.refresh('s1'); // probe #1
    expect(cache.get('s1')).toBe('dead'); // fresh, returned synchronously
    // get() ALWAYS kicks a deduped background probe even when fresh, so a verdict
    // that flips mid-window is caught on the next tick (finding: no refresh while fresh).
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
  });

  it('flips a stale fresh verdict when the proactive probe returns a new value', async () => {
    let clock = 1_000;
    let next: AgentLiveness = 'alive';
    const probe = vi.fn(async () => next);
    const cache = new AgentLivenessCache(probe, { now: () => clock, staleMs: 90_000 });
    await cache.refresh('s1'); // stores alive@1000
    expect(cache.get('s1')).toBe('alive');
    // Agent dies right after the successful probe; the proactive refresh on the
    // next read observes it within the freshness window (no wait for staleness).
    next = 'dead';
    cache.get('s1'); // kicks the proactive probe
    await vi.waitFor(() => expect(cache.get('s1')).toBe('dead'));
  });

  it('treats a verdict older than staleMs as unknown and re-probes', async () => {
    let clock = 1_000;
    const probe = vi.fn(async () => 'dead' as AgentLiveness);
    const cache = new AgentLivenessCache(probe, { now: () => clock, staleMs: 90_000 });
    await cache.refresh('s1'); // probe #1, stores dead@1000
    expect(cache.get('s1')).toBe('dead'); // fresh
    clock += 90_001; // entry now older than staleMs
    expect(cache.get('s1')).toBe('unknown'); // stale window exceeded → fail safe
    // The proactive probe re-populates the cache (dead@now); a later read is fresh again.
    await vi.waitFor(() => expect(cache.get('s1')).toBe('dead'));
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

  it('refresh() joins the in-flight probe scheduled by get() — one probe, one store (no stale clobber)', async () => {
    let resolveProbe: (v: AgentLiveness) => void = () => {};
    const probe = vi.fn(() => new Promise<AgentLiveness>((resolve) => { resolveProbe = resolve; }));
    const cache = new AgentLivenessCache(probe);
    cache.get('s1'); // schedules the background probe
    const refreshed = cache.refresh('s1'); // must join it, not start a second
    expect(probe).toHaveBeenCalledTimes(1);
    resolveProbe('alive');
    await expect(refreshed).resolves.toBe('alive'); // refresh sees the shared verdict
    expect(cache.get('s1')).toBe('alive');
  });

  it('logs a rejected background probe with the session id, still failing safe to unknown', async () => {
    const onProbeError = vi.fn();
    const probe = vi.fn(async () => { throw new Error('ssh exploded'); });
    const cache = new AgentLivenessCache(probe, { onProbeError });
    await expect(cache.refresh('s7')).resolves.toBe('unknown');
    expect(onProbeError).toHaveBeenCalledTimes(1);
    expect(onProbeError.mock.calls[0][0]).toBe('s7'); // session context, not a silent swallow
    expect(onProbeError.mock.calls[0][1]).toBeInstanceOf(Error);
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
    const cache = new AgentLivenessCache(probe, { onProbeError: () => {} }); // silence console in test
    await expect(cache.refresh('s1')).resolves.toBe('unknown');
    expect(cache.get('s1')).toBe('unknown');
  });
});
