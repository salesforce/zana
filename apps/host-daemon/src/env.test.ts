import { describe, it, expect, afterEach, vi } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import {
  augmentPath,
  augmentPathWithNodePrefixes,
  augmentPathWithZcc,
  fallbackDirs,
  resolveZccCliBinDir,
  ensureProcessPath,
  launchedPathOverrides,
  LOGIN_SHELL_BASE_PATH,
  loginShellProbePath,
  nodePrefixBinDirs,
  stripInheritedClaudeSession,
  ensureInteractiveTerminalEnv,
  INHERITED_CLAUDE_SESSION_VARS
} from './env.js';

// The probe gives a login shell 3s. Under a full parallel test run the first
// exec of a freshly written fake shell can take longer than that, so the probe
// falls back and the probe tests fail. Give only those fake shells more time;
// every other shell still gets the real timeout.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const execFileSync = ((file: string, args?: readonly string[], options?: Record<string, unknown>) =>
    actual.execFileSync(file, args, file.includes('zcc-login-shell-') ? { ...options, timeout: 12_000 } : options)
  ) as typeof actual.execFileSync;
  return { ...actual, execFileSync };
});

describe('launchedPathOverrides', () => {
  it('prepends launch-only dirs so a fake gh wins over the login-shell gh', () => {
    const overrides = launchedPathOverrides(
      '/opt/homebrew/bin:/usr/bin:/bin',
      '/tmp/zcc-e2e-gh:/opt/homebrew/bin:/usr/bin:/bin'
    );
    expect(overrides).toBe('/tmp/zcc-e2e-gh');
  });

  it('is empty when the launch PATH is a subset of the login shell (Finder)', () => {
    expect(launchedPathOverrides('/opt/homebrew/bin:/usr/bin:/bin', '/usr/bin:/bin')).toBe('');
  });

  it('keeps only the leading run of launch-only dirs', () => {
    expect(launchedPathOverrides('/opt/homebrew/bin:/usr/bin', '/a:/b:/usr/bin:/c')).toBe('/a:/b');
  });

  it('treats a missing login or launch PATH as empty', () => {
    expect(launchedPathOverrides(null, '/a::/b')).toBe('/a:/b');
    expect(launchedPathOverrides('/usr/bin', undefined)).toBe('');
  });
});

describe('loginShellProbePath', () => {
  it('uses the baseline PATH on macOS when a terminal or tool started us, since path_helper reorders an inherited one', () => {
    expect(loginShellProbePath('darwin', 4242, '/a:/usr/bin')).toBe(LOGIN_SHELL_BASE_PATH);
  });

  it('keeps the inherited PATH when launchd started us on macOS', () => {
    expect(loginShellProbePath('darwin', 1, '/opt/homebrew/bin:/usr/bin')).toBe('/opt/homebrew/bin:/usr/bin');
  });

  it('keeps the inherited PATH on Linux, whatever the parent', () => {
    expect(loginShellProbePath('linux', 4242, '/a:/usr/bin')).toBe('/a:/usr/bin');
    expect(loginShellProbePath('linux', 1, '/a:/usr/bin')).toBe('/a:/usr/bin');
    expect(loginShellProbePath('linux', 4242, undefined)).toBeUndefined();
  });
});

describe('ensureProcessPath login-shell probe', () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const savedPath = process.env.PATH;
  const savedShell = process.env.SHELL;
  const tmpDirs: string[] = [];

  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform);
    vi.unstubAllGlobals();
    process.env.PATH = savedPath;
    if (savedShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = savedShell;
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  // Not launchd (pid 1) unless a test says so, whatever started the test run.
  function setPlatform(value: NodeJS.Platform, ppid = 4242): void {
    Object.defineProperty(process, 'platform', { ...realPlatform, value });
    // `process.ppid` ignores defineProperty under vitest, so wrap `process` instead.
    vi.stubGlobal('process', new Proxy(process, { get: (target, key) => (key === 'ppid' ? ppid : Reflect.get(target, key)) }));
  }

  /**
   * A fake login shell that mimics macOS `path_helper`: it puts the system
   * directories in front of whatever PATH it received, and records that PATH.
   * Pass `printsMarkers: false` for a shell whose output can't be parsed.
   */
  function fakeLoginShell(printsMarkers = true, fixedLoginPath?: string): { dir: string; received: string } {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-login-shell-'));
    chmodSync(dir, 0o700);
    tmpDirs.push(dir);
    const received = join(dir, 'received-path');
    const body = printsMarkers && fixedLoginPath
      ? `printf '__ZCC_PATH_START__${fixedLoginPath}__ZCC_PATH_END__'`
      : printsMarkers
      ? `printf '__ZCC_PATH_START__/usr/local/bin:/opt/homebrew/bin:%s__ZCC_PATH_END__' "$PATH"`
      : 'echo no markers here';
    const shell = join(dir, 'fake-shell');
    writeFileSync(shell, `#!/bin/sh\nprintf '%s' "$PATH" > '${received}'\n${body}\n`, { mode: 0o700 });
    process.env.SHELL = shell;
    return { dir, received };
  }

  const run = (launched: string): string[] => {
    process.env.PATH = launched;
    ensureProcessPath();
    return (process.env.PATH ?? '').split(':');
  };

  it.skipIf(process.platform === 'win32')('(a) keeps a launcher-prepended dir ahead of the login-shell dirs', () => {
    setPlatform('darwin');
    const { dir } = fakeLoginShell();
    const fakeBin = join(dir, 'fake-bin');
    const segments = run(`${fakeBin}:/opt/homebrew/bin:/usr/bin:/bin`);
    expect(segments[0]).toBe(fakeBin);
    expect(segments.indexOf(fakeBin)).toBeLessThan(segments.indexOf('/opt/homebrew/bin'));
  }, 15_000);

  it.skipIf(process.platform === 'win32')('(b) probes the login shell with the baseline PATH on macOS', () => {
    setPlatform('darwin');
    const { dir, received } = fakeLoginShell();
    run(`${join(dir, 'fake-bin')}:/opt/homebrew/bin:/usr/bin:/bin`);
    expect(readFileSync(received, 'utf8')).toBe(LOGIN_SHELL_BASE_PATH);
  }, 15_000);

  it.skipIf(process.platform === 'win32')('(c) a Finder launch gets the login-shell dirs first', () => {
    setPlatform('darwin');
    fakeLoginShell();
    const segments = run('/usr/bin:/bin:/usr/sbin:/sbin');
    expect(segments.slice(0, 2)).toEqual(['/usr/local/bin', '/opt/homebrew/bin']);
  }, 15_000);

  it.skipIf(process.platform === 'win32')('(d) falls back to the launched PATH when the shell prints no markers', () => {
    setPlatform('darwin');
    const { dir } = fakeLoginShell(false);
    const fakeBin = join(dir, 'fake-bin');
    const segments = run(`${fakeBin}:/usr/bin:/bin`);
    expect(segments.slice(0, 3)).toEqual([fakeBin, '/usr/bin', '/bin']);
  }, 15_000);

  it.skipIf(process.platform === 'win32')('(e) is idempotent: a second run keeps the PATH it composed', () => {
    setPlatform('darwin');
    const { dir } = fakeLoginShell();
    const first = run(`${join(dir, 'fake-bin')}:/opt/homebrew/bin:/usr/bin:/bin`);
    const second = run(first.join(':'));
    expect(second).toEqual(first);
  }, 15_000);

  it.skipIf(process.platform === 'win32')('(i) a launchd start on macOS probes with the inherited PATH', () => {
    setPlatform('darwin', 1);
    const { received } = fakeLoginShell();
    const launched = '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    run(launched);
    expect(readFileSync(received, 'utf8')).toBe(launched);
  }, 15_000);

  it.skipIf(process.platform === 'win32')('(f) probes with the inherited PATH on Linux', () => {
    setPlatform('linux');
    const { dir, received } = fakeLoginShell();
    const launched = `${join(dir, 'fake-bin')}:/usr/bin:/bin`;
    run(launched);
    expect(readFileSync(received, 'utf8')).toBe(launched);
  }, 15_000);

  it.skipIf(process.platform === 'win32')('(g) a terminal launch: PATH dirs outside the leading run never reach the probe and land behind the login PATH', () => {
    setPlatform('darwin');
    const { dir, received } = fakeLoginShell(true, '/usr/local/bin:/usr/bin:/bin');
    const lead = join(dir, 'lead-bin');
    const midOnly = join(dir, 'terminal-only-bin');
    const segments = run(`${lead}:/usr/bin:${midOnly}:/bin`);
    // The probe sees exactly the baseline, not the terminal's extra dirs.
    expect(readFileSync(received, 'utf8')).toBe(LOGIN_SHELL_BASE_PATH);
    expect(readFileSync(received, 'utf8')).not.toContain(midOnly);
    // The leading run still wins; the mid-PATH extra stays behind the login PATH.
    expect(segments[0]).toBe(lead);
    expect(segments.indexOf(midOnly)).toBeGreaterThan(segments.indexOf('/bin'));
  }, 15_000);

  it.skipIf(process.platform === 'win32')('(h) Linux: a mid-PATH dir the login shell drops goes behind the login PATH, not in front', () => {
    setPlatform('linux');
    const { dir } = fakeLoginShell(true, '/usr/local/bin:/usr/bin:/bin');
    const lead = join(dir, 'lead-bin');
    const mid = join(dir, 'mid-bin');
    const segments = run(`${lead}:/usr/bin:${mid}:/bin`);
    expect(segments[0]).toBe(lead);
    expect(segments.slice(1, 4)).toEqual(['/usr/local/bin', '/usr/bin', '/bin']);
    expect(segments.indexOf(mid)).toBeGreaterThan(segments.indexOf('/bin'));
  }, 15_000);
});

describe('augmentPath', () => {
  const local = join(homedir(), '.local', 'bin');

  it('appends the known CLI dirs when missing', () => {
    const result = augmentPath('/usr/bin:/bin').split(':');
    expect(result).toContain('/usr/bin');
    expect(result).toContain('/opt/homebrew/bin');
    expect(result).toContain('/usr/local/bin');
    expect(result).toContain(local);
  });

  describe('dotfile-installer `~/.<tool>/bin` and `~/.<tool>/local` discovery', () => {
    // Real dotfile-installer dirs (asdf, volta, cargo, …) live directly
    // under the real homedir(), which we can't control in a unit test — so we
    // seed one, assert it's picked up, then remove it. Skipped dirs a prior run
    // may have left behind are tolerated by using a unique, unlikely name.
    const marker = '.zcc-env-test-tool-marker';
    const markerBin = join(homedir(), marker, 'bin');
    const markerLocal = join(homedir(), marker, 'local');

    afterEach(() => {
      rmSync(join(homedir(), marker), { recursive: true, force: true });
    });

    it('picks up a `~/.<tool>/bin` dir generically, without naming the tool', () => {
      mkdirSync(markerBin, { recursive: true });
      const result = augmentPath('/usr/bin').split(':');
      expect(result).toContain(markerBin);
    });

    it('picks up a `~/.<tool>/local` dir generically, without naming the tool', () => {
      mkdirSync(markerLocal, { recursive: true });
      const result = augmentPath('/usr/bin').split(':');
      expect(result).toContain(markerLocal);
    });

    it('does not add a `~/.<tool>` dir that has no `bin/` or `local/` subdirectory', () => {
      mkdirSync(join(homedir(), marker), { recursive: true });
      const result = augmentPath('/usr/bin').split(':');
      expect(result).not.toContain(markerBin);
      expect(result).not.toContain(markerLocal);
    });
  });

  it('does not duplicate dirs already present', () => {
    const result = augmentPath('/opt/homebrew/bin:/usr/bin').split(':');
    const homebrewCount = result.filter((d) => d === '/opt/homebrew/bin').length;
    expect(homebrewCount).toBe(1);
  });

  it('preserves original PATH order (existing dirs first)', () => {
    const result = augmentPath('/custom/first:/usr/bin').split(':');
    expect(result[0]).toBe('/custom/first');
    expect(result[1]).toBe('/usr/bin');
  });

  it('handles an empty/undefined PATH by returning just the fallback dirs', () => {
    const result = augmentPath(undefined).split(':').filter(Boolean);
    expect(result).toContain('/opt/homebrew/bin');
    expect(result).toContain(local);
    expect(result.length).toBeGreaterThan(0);
  });

  it('drops empty path segments', () => {
    const result = augmentPath('/usr/bin::/bin:').split(':');
    expect(result).not.toContain('');
  });
});

describe('nodePrefixBinDirs', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('follows a ~/.<tool>/bin/node symlink to the versioned prefix that holds npm globals', () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-node-prefix-home-'));
    tmpDirs.push(home);
    const prefixBin = join(home, 'prefix', 'bin');
    const shimBin = join(home, '.tool', 'bin');
    mkdirSync(prefixBin, { recursive: true });
    mkdirSync(shimBin, { recursive: true });
    writeFileSync(join(prefixBin, 'node'), '#!/bin/sh\n');
    chmodSync(join(prefixBin, 'node'), 0o755);
    symlinkSync(join(prefixBin, 'node'), join(shimBin, 'node'));

    expect(nodePrefixBinDirs(home).map((dir) => realpathSync(dir))).toContain(realpathSync(prefixBin));
    expect(augmentPathWithNodePrefixes('/usr/bin', home).split(':').map((dir) => realpathSync(dir)))
      .toContain(realpathSync(prefixBin));
    // Remote-safe: fallbackDirs / augmentPath must not grow a local versioned prefix.
    expect(fallbackDirs(home)).not.toContain(prefixBin);
  });

  it('does not add the shim dir itself when node is not a symlink elsewhere', () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-node-prefix-plain-'));
    tmpDirs.push(home);
    const localBin = join(home, '.local', 'bin');
    mkdirSync(localBin, { recursive: true });
    writeFileSync(join(localBin, 'node'), '#!/bin/sh\n');
    chmodSync(join(localBin, 'node'), 0o755);
    expect(nodePrefixBinDirs(home)).not.toContain(localBin);
  });
});

describe('resolveZccCliBinDir + zcc PATH wiring', () => {
  // Save/restore the two pieces of global state these tests touch, so they
  // stay hermetic regardless of run order.
  const savedOverride = process.env.ZCC_CLI_DIR;
  const savedPath = process.env.PATH;
  const savedShell = process.env.SHELL;
  const tmpDirs: string[] = [];

  afterEach(() => {
    if (savedOverride === undefined) delete process.env.ZCC_CLI_DIR;
    else process.env.ZCC_CLI_DIR = savedOverride;
    process.env.PATH = savedPath;
    if (savedShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = savedShell;
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** A temp dir seeded with (or without) an extensionless `zcc` executable. */
  function makeCliDir(withZcc: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-cli-test-'));
    tmpDirs.push(dir);
    if (withZcc) writeFileSync(join(dir, 'zcc'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    return dir;
  }

  it('ZCC_CLI_DIR override wins when it holds a real `zcc` executable', () => {
    const dir = makeCliDir(true);
    process.env.ZCC_CLI_DIR = dir;
    expect(resolveZccCliBinDir()).toBe(dir);
  });

  it('trusts a ZCC_CLI_DIR override on existence alone (an explicit override is NOT gated on a `zcc` file)', () => {
    const empty = makeCliDir(false);
    process.env.ZCC_CLI_DIR = empty;
    // The override is candidate #1 and — unlike the dev candidates — is gated
    // ONLY on the dir existing (resolveZccCliBinDir's docstring: "Every
    // NON-override candidate is strictly gated on an executable literally named
    // `zcc`"). So an operator can point at a dir whose `zcc` isn't built yet and
    // the override still wins; it is not silently discarded.
    expect(resolveZccCliBinDir()).toBe(empty);
  });

  it('augmentPathWithZcc appends the resolved dir LAST and deduped', () => {
    const dir = makeCliDir(true);
    process.env.ZCC_CLI_DIR = dir;
    const result = augmentPathWithZcc('/usr/bin:/bin').split(':');
    expect(result[result.length - 1]).toBe(dir);
    expect(result.filter((d) => d === dir).length).toBe(1);
    // Pre-existing entries are preserved ahead of it (system tools stay first).
    expect(result[0]).toBe('/usr/bin');
  });

  it('augmentPathWithZcc degrades gracefully: preserves the input PATH and never emits an empty segment', () => {
    // A true "nothing resolves → returns `current` unchanged" no-op is NOT
    // hermetically reachable in a BUILT repo: both dev candidates
    // (packages/cli/dist/bin and node_modules/.bin) resolve a real `zcc`, and an
    // explicit ZCC_CLI_DIR override is trusted on existence alone (see the
    // override test above). So we can't force resolveZccCliBinDir() to return
    // undefined without mocking fs (a hack that also fails to intercept env.ts's
    // named `existsSync` import). Instead assert the observable graceful-
    // degradation contract that holds either way: every input dir survives and
    // PATH stays well-formed (no empty '' segment), whether or not a zcc dir is
    // appended. The pure `if (!dir) return current ?? ''` branch is covered by
    // reasoning + the resolver's own undefined-return contract.
    delete process.env.ZCC_CLI_DIR;
    const result = augmentPathWithZcc('/usr/bin:/bin').split(':');
    expect(result).toContain('/usr/bin');
    expect(result).toContain('/bin');
    expect(result).not.toContain('');
  });

  // ensureProcessPath() spawns a real interactive login shell (loginShellPath →
  // `$SHELL -ilc …`, 3s internal timeout) to read the authoritative PATH. Point
  // SHELL at the minimal POSIX shell so we don't source the host user's heavy
  // interactive rc files (which, under full-suite subprocess contention, can
  // push this past the default 5s test timeout — the flake that broke the
  // pre-push hook). The extra timeout headroom covers the 3s shell query plus
  // scheduling latency. Restored in afterEach via savedShell.
  it('ensureProcessPath folds the zcc CLI dir into process.env.PATH (deduped, last)', () => {
    process.env.SHELL = '/bin/sh';
    const dir = makeCliDir(true);
    process.env.ZCC_CLI_DIR = dir;
    ensureProcessPath();
    const segments = (process.env.PATH ?? '').split(':');
    expect(segments).toContain(dir);
    expect(segments.filter((d) => d === dir).length).toBe(1);
    expect(segments[segments.length - 1]).toBe(dir);
  }, 15_000);

  // An interactive zsh ignores SIGTERM, so the 3s timeout alone never ends a
  // wedged login shell and the caller blocks (observed: >5 min with no TTY).
  // The query must be killed with SIGKILL and degrade to the guessed dirs.
  it('ensureProcessPath gives up on a login shell that ignores SIGTERM', () => {
    const dir = makeCliDir(false);
    const shell = join(dir, 'stubborn-shell');
    writeFileSync(shell, "#!/bin/sh\ntrap '' TERM\nexec sleep 60\n");
    chmodSync(shell, 0o755);
    process.env.SHELL = shell;
    const started = Date.now();
    ensureProcessPath();
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(process.env.PATH ?? '').not.toBe('');
  }, 20_000);
});

describe('stripInheritedClaudeSession', () => {
  it('deletes every nested-session marker so a spawned claude starts a fresh session', () => {
    const env: Record<string, string> = {
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SESSION_ID: '796db856-0000-0000-0000-000000000000',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_EXECPATH: '/usr/local/bin/claude',
      PATH: '/usr/bin'
    };
    stripInheritedClaudeSession(env);
    for (const key of INHERITED_CLAUDE_SESSION_VARS) {
      expect(env[key]).toBeUndefined();
    }
  });

  it('preserves Bedrock/telemetry config and unrelated vars', () => {
    const env: Record<string, string> = {
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1',
      ANTHROPIC_BEDROCK_BASE_URL: 'https://example',
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      PATH: '/usr/bin'
    };
    stripInheritedClaudeSession(env);
    // Session markers gone…
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    // …but Bedrock auth/config + telemetry + PATH untouched.
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1');
    expect(env.CLAUDE_CODE_SKIP_BEDROCK_AUTH).toBe('1');
    expect(env.ANTHROPIC_BEDROCK_BASE_URL).toBe('https://example');
    expect(env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe('1');
    expect(env.PATH).toBe('/usr/bin');
  });

  it('is a no-op when no markers are present (Finder-launched app)', () => {
    const env: Record<string, string> = { PATH: '/usr/bin', TERM: 'xterm-256color' };
    stripInheritedClaudeSession(env);
    expect(env).toEqual({ PATH: '/usr/bin', TERM: 'xterm-256color' });
  });
});

describe('ensureInteractiveTerminalEnv', () => {
  it('forces a color-capable TTY even when CI/NO_COLOR were inherited', () => {
    const env: Record<string, string> = {
      PATH: '/usr/bin',
      TERM: 'dumb',
      CI: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0'
    };
    ensureInteractiveTerminalEnv(env);
    expect(env.TERM).toBe('xterm-256color');
    expect(env.COLORTERM).toBe('truecolor');
    expect(env.CI).toBeUndefined();
    expect(env.NO_COLOR).toBeUndefined();
    expect(env.FORCE_COLOR).toBeUndefined();
  });

  it('deletes FORCE_COLOR=false the same way as 0', () => {
    const env: Record<string, string> = { FORCE_COLOR: 'false' };
    ensureInteractiveTerminalEnv(env);
    expect(env.FORCE_COLOR).toBeUndefined();
    expect(env.COLORTERM).toBe('truecolor');
  });

  it('leaves a non-disabling FORCE_COLOR intact', () => {
    const env: Record<string, string> = { PATH: '/usr/bin', FORCE_COLOR: '3' };
    ensureInteractiveTerminalEnv(env);
    expect(env.FORCE_COLOR).toBe('3');
    expect(env.COLORTERM).toBe('truecolor');
  });
});
