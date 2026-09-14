import { describe, it, expect, afterEach, vi } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import {
  augmentPath,
  augmentPathWithNodePrefixes,
  augmentPathWithZcc,
  fallbackDirs,
  resolveZccCliBinDir,
  ensureProcessPath,
  launchedPathOverrides,
  nodePrefixBinDirs,
  stripInheritedClaudeSession,
  ensureInteractiveTerminalEnv,
  INHERITED_CLAUDE_SESSION_VARS
} from './env.js';

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
    // Real dotfile-installer dirs (asdf, volta, cargo, AI Suite, …) live directly
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
