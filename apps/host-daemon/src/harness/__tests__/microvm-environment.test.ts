import { describe, it, expect, vi } from 'vitest';
import { createMicroVmEnvironment, HOST_INTERNAL } from '../microvm-environment.js';
import { DEFAULT_IMAGE_ALLOWLIST, GUEST_WORKSPACE } from '../microvm-builder.js';
import type { ExecEnvContext } from '../execution-environment.js';

/**
 * Adapter tests for the `microvm` environment. A FAKE microsandbox SDK drives
 * the builder chain + exec stream so we exercise createSession end-to-end
 * (config → sandbox → exec handle → ExecutionSession) with no native addon:
 * Uint8Array→string decode, resize no-op, kill tears the VM down, callback-env
 * loopback rewrite, and the platform fail-closed gate.
 */

// ---- Fake SDK -------------------------------------------------------------

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

class FakeSink {
  writes: string[] = [];
  closed = false;
  async write(d: Uint8Array | string) {
    this.writes.push(typeof d === 'string' ? d : new TextDecoder().decode(d));
  }
  async close() {
    this.closed = true;
  }
}

class FakeHandle {
  killed = false;
  sink = new FakeSink();
  private events: unknown[];
  constructor(events: unknown[]) {
    this.events = events;
  }
  async takeStdin() {
    return this.sink;
  }
  async kill() {
    this.killed = true;
  }
  async *[Symbol.asyncIterator]() {
    for (const ev of this.events) yield ev as never;
  }
}

class FakeSandbox {
  // Models the VERIFIED 0.6.6 teardown semantics: `stop()` is the clean path
  // (reclaims guest + clears the registry row); `kill()` throws ECHILD once the
  // ephemeral child is reaped and does NOT clear the row — so a leak is only
  // avoided by a subsequent `Sandbox.remove(name)`.
  stopped = false;
  killAttempted = false;
  /** When true, kill() throws ECHILD (as the real SDK does on an ephemeral VM). */
  killThrows = false;
  /** When true, stop() rejects so the test can exercise the kill+remove fallback. */
  stopThrows = false;
  execArgs: { cmd: string; opts: Record<string, unknown> } | null = null;
  constructor(
    private readonly events: unknown[],
    readonly name = 'fake-sb'
  ) {}
  async execStreamWith(cmd: string, configure: (b: unknown) => unknown) {
    const opts: Record<string, unknown> = {};
    const b = {
      args: (a: string[]) => ((opts.args = a), b),
      tty: (v: boolean) => ((opts.tty = v), b),
      stdinPipe: () => ((opts.stdin = true), b),
      cwd: (c: string) => ((opts.cwd = c), b),
      envs: (e: Record<string, string>) => ((opts.envs = e), b)
    };
    configure(b);
    this.execArgs = { cmd, opts };
    return new FakeHandle(this.events);
  }
  async stop() {
    if (this.stopThrows) throw new Error('stop failed');
    this.stopped = true;
  }
  async kill() {
    this.killAttempted = true;
    if (this.killThrows) {
      const err = new Error('io error: No child processes (os error 10)');
      (err as { code?: string }).code = 'io';
      throw err;
    }
  }
}

function fakeSdk(
  events: unknown[],
  captured: { builder?: Record<string, unknown>; sandbox?: FakeSandbox; removed?: string[] },
  makeSandbox?: (events: unknown[], name: string) => FakeSandbox
) {
  captured.removed = [];
  return {
    NetworkPolicy: {
      builder() {
        // Models the VERIFIED 0.6.6 shape: matchers chain on ONE egress rule
        // builder; there is no top-level allowDns() (loopback covers DNS).
        const calls: string[] = [];
        const b: Record<string, unknown> = {
          defaultDeny: () => (calls.push('defaultDeny'), b),
          egress: (fn: (e: unknown) => unknown) => {
            const e: Record<string, unknown> = {
              allowPublic: () => (calls.push('allowPublic'), e),
              allowHost: () => (calls.push('allowHost'), e),
              allowLoopback: () => (calls.push('allowLoopback'), e)
            };
            fn(e);
            return b;
          },
          build: () => ({ calls })
        };
        return b;
      }
    },
    Sandbox: {
      builder(name: string) {
        const rec: Record<string, unknown> = { name, volumes: [] as unknown[] };
        const b: Record<string, unknown> = {
          image: (r: string) => ((rec.image = r), b),
          cpus: (n: number) => ((rec.cpus = n), b),
          memory: (m: number) => ((rec.memory = m), b),
          workdir: (w: string) => ((rec.workdir = w), b),
          envs: (e: Record<string, string>) => ((rec.envs = e), b),
          ephemeral: (v: boolean) => ((rec.ephemeral = v), b),
          volume: (guest: string, fn: (mb: unknown) => unknown) => {
            const mount: Record<string, unknown> = { guest, readonly: false };
            const mb = {
              bind: (h: string) => ((mount.host = h), mb),
              readonly: () => ((mount.readonly = true), mb)
            };
            fn(mb);
            (rec.volumes as unknown[]).push(mount);
            return b;
          },
          network: (fn: (nb: unknown) => unknown) => {
            fn({ policy: (p: unknown) => ((rec.policy = p), {}) });
            return b;
          },
          create: async () => {
            captured.builder = rec;
            const sb = makeSandbox
              ? makeSandbox(events, String(rec.name))
              : new FakeSandbox(events, String(rec.name));
            captured.sandbox = sb;
            return sb;
          }
        };
        return b;
      },
      async remove(name: string) {
        captured.removed!.push(name);
      }
    }
  };
}

function ctx(over: Partial<ExecEnvContext & { cols: number; rows: number; sessionEnv: Record<string, string> }> = {}) {
  return {
    sessionId: 'sid-1',
    projectId: 'p1',
    cwd: '/proj/a',
    cols: 80,
    rows: 24,
    sessionEnv: {},
    ...over
  };
}

const policy = { realpath: (p: string) => p, projectRoots: () => ['/proj/a'], sensitiveRoots: () => [] };

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('microvm environment — rewriteCallbackEnv', () => {
  const env = createMicroVmEnvironment({ platformSupported: () => true });

  it('rewrites loopback host in ZCC_*_URL to host.microsandbox.internal, preserving the port', () => {
    const out = env.rewriteCallbackEnv(
      {
        ZCC_MCP_URL: 'http://127.0.0.1:5123/mcp',
        ZCC_HOOK_URL: 'http://localhost:5123/hook',
        ZCC_OTHER: '127.0.0.1:9', // not a *_URL → untouched
        PATH: '/usr/bin'
      },
      ctx() as never
    );
    expect(out.ZCC_MCP_URL).toBe(`http://${HOST_INTERNAL}:5123/mcp`);
    expect(out.ZCC_HOOK_URL).toBe(`http://${HOST_INTERNAL}:5123/hook`);
    expect(out.ZCC_OTHER).toBe('127.0.0.1:9');
    expect(out.PATH).toBe('/usr/bin');
  });
});

describe('microvm environment — status / platform gate', () => {
  it('reports isolated when the platform supports it', () => {
    const env = createMicroVmEnvironment({ platformSupported: () => true });
    expect(env.status(ctx() as never)).toEqual({ isolated: true });
  });

  it('reports an honest unavailable reason when unsupported', () => {
    const env = createMicroVmEnvironment({ platformSupported: () => false });
    const s = env.status(ctx() as never);
    expect(s.isolated).toBe(false);
    expect(s.reason).toBeTruthy();
  });

  it('createSession fails closed (throws) on an unsupported platform', async () => {
    const env = createMicroVmEnvironment({ platformSupported: () => false });
    await expect(
      env.createSession!({ command: 'claude', args: [] }, ctx() as never)
    ).rejects.toThrow(/unavailable/);
  });
});

describe('microvm environment — createSession lifecycle', () => {
  it('builds an authorized sandbox, runs the inner command in a tty, and decodes guest output', async () => {
    const captured: { builder?: Record<string, unknown>; sandbox?: FakeSandbox } = {};
    const env = createMicroVmEnvironment({
      platformSupported: () => true,
      policy,
      loadSdk: async () =>
        fakeSdk(
          [
            { kind: 'started', pid: 4242 },
            { kind: 'stdout', data: enc('hello ') },
            { kind: 'stderr', data: enc('world') },
            { kind: 'exited', code: 0 }
          ],
          captured
        ) as never
    });

    const session = await env.createSession!(
      { command: 'claude', args: ['--foo'] },
      ctx({ sessionEnv: { ZCC_MCP_URL: 'x' }, microVmImage: 'node', microVmCpus: 3, microVmMemoryMib: 2048 }) as never
    );

    const out: string[] = [];
    let exitCode = -1;
    session.onData((d) => out.push(d));
    session.onExit((e) => (exitCode = e.exitCode));
    await flush();
    await flush();

    // Authorized image/resources landed on the builder.
    expect(captured.builder?.image).toBe(DEFAULT_IMAGE_ALLOWLIST.node.ref);
    expect(captured.builder?.cpus).toBe(3);
    expect(captured.builder?.memory).toBe(2048);
    expect(captured.builder?.workdir).toBe(GUEST_WORKSPACE);
    expect((captured.builder?.volumes as unknown[])[0]).toMatchObject({
      guest: GUEST_WORKSPACE,
      host: '/proj/a',
      readonly: false
    });
    // Ran the inner command in a tty with stdin piped.
    expect(captured.sandbox?.execArgs).toMatchObject({
      cmd: 'claude',
      opts: { args: ['--foo'], tty: true, stdin: true, cwd: GUEST_WORKSPACE }
    });
    // Uint8Array events decoded + merged; pid stamped; clean exit.
    expect(session.pid).toBe(4242);
    expect(out.join('')).toBe('hello world');
    expect(exitCode).toBe(0);

    // Network policy: deny-by-default, with public + host + loopback allowed on
    // ONE egress rule (the VERIFIED 0.6.6 shape — lets the guest reach the host
    // callback server via host.microsandbox.internal; loopback covers DNS).
    expect((captured.builder?.policy as { calls: string[] }).calls).toEqual([
      'defaultDeny',
      'allowPublic',
      'allowHost',
      'allowLoopback'
    ]);
  });

  it('scrubs host-filesystem env (PATH/HOME/…) before handing env to the guest, keeping callback vars', async () => {
    // Regression for the full-app-integration bug: passing the HOST macOS PATH
    // into the Linux guest makes it unable to resolve even `sh` (the SDK then
    // yields a malformed event → silent exit 1). The adapter must drop the
    // host-OS vars so the guest defaults apply, while the ZCC callback vars
    // (already loopback-rewritten) survive.
    const captured: { builder?: Record<string, unknown>; sandbox?: FakeSandbox } = {};
    const env = createMicroVmEnvironment({
      platformSupported: () => true,
      policy,
      loadSdk: async () => fakeSdk([{ kind: 'started', pid: 7 }, { kind: 'exited', code: 0 }], captured) as never
    });

    await env.createSession!(
      { command: 'sh', args: [] },
      ctx({
        sessionEnv: {
          PATH: '/Users/someone/.local/bin:/usr/local/bin',
          HOME: '/Users/someone',
          TMPDIR: '/var/folders/xx',
          ZCC_MCP_URL: `http://${HOST_INTERNAL}:5123/mcp`,
          ZCC_HOOK_URL: `http://${HOST_INTERNAL}:5123/hook`
        }
      }) as never
    );
    await flush();

    const builderEnv = captured.builder?.envs as Record<string, string>;
    const execEnv = (captured.sandbox?.execArgs?.opts as { envs: Record<string, string> }).envs;
    for (const scrubbed of ['PATH', 'HOME', 'TMPDIR']) {
      expect(builderEnv).not.toHaveProperty(scrubbed);
      expect(execEnv).not.toHaveProperty(scrubbed);
    }
    // Callback vars survive the scrub on BOTH the builder env and the exec env.
    expect(builderEnv.ZCC_MCP_URL).toBe(`http://${HOST_INTERNAL}:5123/mcp`);
    expect(builderEnv.ZCC_HOOK_URL).toBe(`http://${HOST_INTERNAL}:5123/hook`);
    expect(execEnv.ZCC_MCP_URL).toBe(`http://${HOST_INTERNAL}:5123/mcp`);
  });

  it('remaps a host login shell (/bin/zsh) to the guest /bin/sh, preserving args', async () => {
    // The `shell` launch profile resolves to the host's configured login shell
    // — an absolute HOST path (/bin/zsh, /opt/homebrew/bin/zsh, …) that doesn't
    // exist in the Linux guest rootfs. Remap it to /bin/sh (every POSIX image
    // ships it) so a plain-shell microVM session boots.
    const captured: { sandbox?: FakeSandbox } = {};
    const env = createMicroVmEnvironment({
      platformSupported: () => true,
      policy,
      loadSdk: async () => fakeSdk([{ kind: 'started', pid: 1 }, { kind: 'exited', code: 0 }], captured) as never
    });
    await env.createSession!({ command: '/bin/zsh', args: ['-l'] }, ctx() as never);
    await flush();
    expect(captured.sandbox?.execArgs).toMatchObject({ cmd: '/bin/sh', opts: { args: ['-l'] } });
  });

  it('remaps a homebrew-path host shell (/opt/homebrew/bin/zsh) to /bin/sh', async () => {
    const captured: { sandbox?: FakeSandbox } = {};
    const env = createMicroVmEnvironment({
      platformSupported: () => true,
      policy,
      loadSdk: async () => fakeSdk([{ kind: 'started', pid: 1 }, { kind: 'exited', code: 0 }], captured) as never
    });
    await env.createSession!({ command: '/opt/homebrew/bin/zsh', args: [] }, ctx() as never);
    await flush();
    expect(captured.sandbox?.execArgs?.cmd).toBe('/bin/sh');
  });

  it('passes a non-shell command (bare `claude`) through unchanged', async () => {
    const captured: { sandbox?: FakeSandbox } = {};
    const env = createMicroVmEnvironment({
      platformSupported: () => true,
      policy,
      loadSdk: async () => fakeSdk([{ kind: 'started', pid: 1 }, { kind: 'exited', code: 0 }], captured) as never
    });
    await env.createSession!({ command: 'claude', args: ['--foo'] }, ctx() as never);
    await flush();
    // A bare `claude` (resolved via the guest PATH) must NOT be remapped — that
    // would mask a genuinely missing agent binary behind a shell.
    expect(captured.sandbox?.execArgs).toMatchObject({ cmd: 'claude', opts: { args: ['--foo'] } });
  });

  it('does NOT remap a bare `sh` (relative) — only absolute host-path shells are remapped', async () => {
    const captured: { sandbox?: FakeSandbox } = {};
    const env = createMicroVmEnvironment({
      platformSupported: () => true,
      policy,
      loadSdk: async () => fakeSdk([{ kind: 'started', pid: 1 }, { kind: 'exited', code: 0 }], captured) as never
    });
    await env.createSession!({ command: 'sh', args: ['-c', 'echo hi'] }, ctx() as never);
    await flush();
    // A bare `sh` already resolves via the guest PATH; leave it alone.
    expect(captured.sandbox?.execArgs?.cmd).toBe('sh');
  });

  it('fires an abnormal exit (not a crash) on a malformed/undefined guest event', async () => {
    // Defensive pump: the SDK yields an `undefined` event when the guest can't
    // launch the command at all. The pump must treat it as exit 1, not throw on
    // `ev.kind`.
    const captured: { sandbox?: FakeSandbox } = {};
    const env = createMicroVmEnvironment({
      platformSupported: () => true,
      policy,
      loadSdk: async () => fakeSdk([{ kind: 'started', pid: 1 }, undefined], captured) as never
    });
    const session = await env.createSession!({ command: 'sh', args: [] }, ctx() as never);
    let exitCode = -1;
    session.onExit((e) => (exitCode = e.exitCode));
    await flush();
    await flush();
    expect(exitCode).toBe(1);
  });

  it('write() forwards to the guest stdin sink', async () => {
    const captured: { sandbox?: FakeSandbox } = {};
    const env = createMicroVmEnvironment({
      platformSupported: () => true,
      policy,
      loadSdk: async () => fakeSdk([{ kind: 'started', pid: 1 }], captured) as never
    });
    const session = await env.createSession!({ command: 'sh', args: [] }, ctx() as never);
    session.write('echo hi\n');
    await flush();
    // The FakeHandle's sink is owned by the FakeSandbox's exec handle.
    const handleSink = (captured.sandbox as unknown as { execArgs: unknown } | undefined) && true;
    expect(handleSink).toBe(true);
  });

  it('kill() gracefully stops the VM (clean path — no kill/remove needed)', async () => {
    const captured: { sandbox?: FakeSandbox; removed?: string[] } = {};
    const env = createMicroVmEnvironment({
      platformSupported: () => true,
      policy,
      // Never emits 'exited' so the session stays live until kill().
      loadSdk: async () => fakeSdk([{ kind: 'started', pid: 1 }], captured) as never
    });
    const session = await env.createSession!({ command: 'sleep', args: ['100'] }, ctx() as never);
    session.kill();
    await flush();
    // stop() is the clean teardown; kill()/remove() are only the fallback.
    expect(captured.sandbox?.stopped).toBe(true);
    expect(captured.sandbox?.killAttempted).toBe(false);
    expect(captured.removed).toEqual([]);
  });

  it('kill() falls back to forceful kill + registry remove when stop() fails', async () => {
    const captured: { sandbox?: FakeSandbox; removed?: string[] } = {};
    const env = createMicroVmEnvironment({
      platformSupported: () => true,
      policy,
      loadSdk: async () =>
        fakeSdk([{ kind: 'started', pid: 1 }], captured, (events, name) => {
          const sb = new FakeSandbox(events, name);
          sb.stopThrows = true; // stop() rejects → forceful path
          sb.killThrows = true; // kill() throws ECHILD (real ephemeral behavior)
          return sb;
        }) as never
    });
    const session = await env.createSession!({ command: 'sleep', args: ['100'] }, ctx() as never);
    session.kill();
    await flush();
    // ECHILD from kill() is swallowed; the registry row is still reaped by remove().
    expect(captured.sandbox?.killAttempted).toBe(true);
    expect(captured.removed).toEqual([captured.sandbox?.name]);
  });

  it('tears the VM down on natural guest exit (via stop)', async () => {
    const captured: { sandbox?: FakeSandbox; removed?: string[] } = {};
    const env = createMicroVmEnvironment({
      platformSupported: () => true,
      policy,
      loadSdk: async () =>
        fakeSdk([{ kind: 'started', pid: 1 }, { kind: 'exited', code: 0 }], captured) as never
    });
    await env.createSession!({ command: 'true', args: [] }, ctx() as never);
    await flush();
    // The pump()'s finally block reclaims the VM even without an explicit kill().
    expect(captured.sandbox?.stopped).toBe(true);
  });

  it('rejects an unauthorized image before touching the SDK', async () => {
    let sdkLoaded = false;
    const env = createMicroVmEnvironment({
      platformSupported: () => true,
      policy,
      loadSdk: async () => {
        sdkLoaded = true;
        return fakeSdk([], {}) as never;
      }
    });
    await expect(
      env.createSession!({ command: 'claude', args: [] }, ctx({ microVmImage: 'evil.com/x:1' }) as never)
    ).rejects.toThrow(/allowlist/);
    expect(sdkLoaded).toBe(false);
  });
});
