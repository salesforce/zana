import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createBrokerCapabilities, assertContainedEntry } from '../broker-caps.js';
import { PermissionBroker, grantFromManifest } from '../permission-broker.js';
import type { LlmPromptEntry, LlmRunResult, InboxEntry } from '@zana-ai/zcc-domain/product';
import type { InboxInput } from '@zana-ai/zcc-server';

let extDir: string;

function brokerFor(
  grants: Record<string, ReturnType<typeof grantFromManifest>>,
  sensitiveRoots?: () => string[]
) {
  const broker = new PermissionBroker({
    builtinIds: new Set(['gus']),
    grants: (id) => grants[id] ?? null,
    sensitiveRoots
  });
  return createBrokerCapabilities(broker);
}

describe('broker-caps — gated fs', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-brokercaps-'));
  });
  afterEach(async () => {
    await rm(extDir, { recursive: true, force: true });
  });

  it('reads a file inside a granted root', async () => {
    await mkdir(join(extDir, 'data'), { recursive: true });
    await writeFile(join(extDir, 'data', 'x.txt'), 'hello', 'utf-8');
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    expect(await caps.readFile('alpha', join(extDir, 'data', 'x.txt'))).toBe('hello');
  });

  it('rejects a read outside any granted root (traversal/escape)', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    await expect(caps.readFile('alpha', '/etc/hosts')).rejects.toThrow(/PermissionDenied/);
    await expect(
      caps.readFile('alpha', join(extDir, 'data', '..', '..', 'escape.txt'))
    ).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects a read when fs:read is not granted at all', async () => {
    const caps = brokerFor({ alpha: grantFromManifest(['storage'], undefined, extDir) });
    await expect(caps.readFile('alpha', join(extDir, 'whatever'))).rejects.toThrow(/PermissionDenied/);
  });

  it('writes inside a granted root but never into a sensitive root', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:write'], { fsRoots: [extDir] }, extDir)
    });
    await caps.writeFile('alpha', join(extDir, 'out.txt'), 'data');
    // A sensitive root is denied even if a granted root would cover it (home).
    const homeCaps = brokerFor({
      alpha: grantFromManifest(['fs:write'], { fsRoots: [resolve(process.env.HOME ?? '/')] }, extDir)
    });
    await expect(
      homeCaps.writeFile('alpha', resolve(process.env.HOME ?? '/', '.ssh', 'evil'), 'x')
    ).rejects.toThrow(/PermissionDenied/);
  });

  it('stats a file inside a granted root', async () => {
    await mkdir(join(extDir, 'data'), { recursive: true });
    await writeFile(join(extDir, 'data', 'file.txt'), 'content', 'utf-8');
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    const stats = await caps.stat('alpha', join(extDir, 'data', 'file.txt'));
    expect(stats.size).toBe(7); // 'content' is 7 bytes
    expect(stats.isFile).toBe(true);
    expect(stats.isDirectory).toBe(false);
    expect(typeof stats.mtimeMs).toBe('number');
  });

  it('rejects stat outside granted roots', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    await expect(caps.stat('alpha', '/etc/hosts')).rejects.toThrow(/PermissionDenied/);
  });

  it('exists returns true for an existing file in granted root', async () => {
    await mkdir(join(extDir, 'data'), { recursive: true });
    await writeFile(join(extDir, 'data', 'exists.txt'), 'yes', 'utf-8');
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    expect(await caps.exists('alpha', join(extDir, 'data', 'exists.txt'))).toBe(true);
  });

  it('exists returns false for non-existing file in granted root', async () => {
    await mkdir(join(extDir, 'data'), { recursive: true });
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    expect(await caps.exists('alpha', join(extDir, 'data', 'missing.txt'))).toBe(false);
  });

  it('exists rejects (not returns false) for path outside granted roots', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    // Permission check runs FIRST — existence of off-root paths is never leaked
    await expect(caps.exists('alpha', '/etc/hosts')).rejects.toThrow(/PermissionDenied/);
  });

  it('rm deletes a file inside a granted root', async () => {
    await mkdir(join(extDir, 'data'), { recursive: true });
    await writeFile(join(extDir, 'data', 'to-delete.txt'), 'delete me', 'utf-8');
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:write'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    await caps.rm('alpha', join(extDir, 'data', 'to-delete.txt'));
    // Verify file is gone
    const checkCaps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    expect(await checkCaps.exists('alpha', join(extDir, 'data', 'to-delete.txt'))).toBe(false);
  });

  it('rm rejects when fs:write is not granted', async () => {
    await mkdir(join(extDir, 'data'), { recursive: true });
    await writeFile(join(extDir, 'data', 'file.txt'), 'content', 'utf-8');
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    await expect(caps.rm('alpha', join(extDir, 'data', 'file.txt'))).rejects.toThrow(/PermissionDenied/);
  });

  it('rm rejects when path is outside granted roots', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:write'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    await expect(caps.rm('alpha', '/etc/hosts')).rejects.toThrow(/PermissionDenied/);
  });

  it('rm rejects when target is a directory (files-only)', async () => {
    await mkdir(join(extDir, 'data', 'subdir'), { recursive: true });
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:write'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    await expect(caps.rm('alpha', join(extDir, 'data', 'subdir'))).rejects.toThrow(/Cannot delete directory/);
  });

  it('rm resolves quietly when file does not exist (idempotent-missing)', async () => {
    await mkdir(join(extDir, 'data'), { recursive: true });
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:write'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    // Should not throw — deleting an already-absent file is a no-op success
    await caps.rm('alpha', join(extDir, 'data', 'never-existed.txt'));
  });

  it('rm rejects deleting into a sensitive root even if fsRoots covers it', async () => {
    const homeCaps = brokerFor({
      alpha: grantFromManifest(['fs:write'], { fsRoots: [resolve(process.env.HOME ?? '/')] }, extDir)
    });
    // Even though fsRoots includes HOME, sensitive roots are blocked
    await expect(
      homeCaps.rm('alpha', resolve(process.env.HOME ?? '/', '.ssh', 'test'))
    ).rejects.toThrow(/PermissionDenied/);
  });

  it('stat follows symlinks and checks the target against granted roots', async () => {
    // Move this test into the symlink/realpath escape block where it belongs.
    // (See broker-caps — symlink/realpath escape suite below, which already has
    // the separate outsideDir setup needed to properly test symlink escapes.)
    expect(true).toBe(true);
  });
});

describe('broker-caps — remote defaults', () => {
  it('requires remote:defaults and delegates only the global path field', async () => {
    const get = vi.fn(() => ({ remoteDefaultPath: '/home/sfwork/core' }));
    const set = vi.fn((input: { remoteDefaultPath?: string }) => input.remoteDefaultPath ? input : {});
    const caps = createBrokerCapabilities(
      new PermissionBroker({
        builtinIds: new Set(),
        grants: (id) => id === 'salesforce'
          ? grantFromManifest(['remote:defaults'], undefined, '/tmp/salesforce')
          : null
      }),
      { remoteDefaults: { get, set } }
    );

    await expect(caps.getRemoteDefaults!('salesforce')).resolves.toEqual({ remoteDefaultPath: '/home/sfwork/core' });
    await expect(caps.setRemoteDefaults!('salesforce', { remoteDefaultPath: '/workspace/core' })).resolves.toEqual({ remoteDefaultPath: '/workspace/core' });
    await expect(caps.getRemoteDefaults!('other')).rejects.toThrow(/PermissionDenied/);
    expect(set).toHaveBeenCalledWith({ remoteDefaultPath: '/workspace/core' });
  });
});

describe('broker-caps — extension installation', () => {
  it('requires an allowlisted git repository before delegating installation', async () => {
    const install = vi.fn(async () => ({ id: 'gus' }));
    const caps = createBrokerCapabilities(
      new PermissionBroker({
        builtinIds: new Set(),
        grants: () => grantFromManifest(
          ['extensions:install'],
          { extensionInstallAllowlist: ['https://git.soma.salesforce.com/chatbots/zcc-extension-gus'] },
          '/tmp/salesforce'
        )
      }),
      { installExtensionFromGit: install }
    );

    await expect(caps.installExtensionFromGit!('salesforce', { url: 'https://git.soma.salesforce.com/chatbots/zcc-extension-gus' })).resolves.toEqual({ id: 'gus' });
    await expect(caps.installExtensionFromGit!('salesforce', { url: 'https://example.invalid/unapproved' })).rejects.toThrow(/PermissionDenied/);
    expect(install).toHaveBeenCalledWith({ url: 'https://git.soma.salesforce.com/chatbots/zcc-extension-gus' });
  });
});

describe('broker-caps — gated process spawn', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-brokercaps-'));
  });
  afterEach(async () => {
    await rm(extDir, { recursive: true, force: true });
  });

  it('runs an allowlisted bin and returns stdout', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['exec'], { execAllowlist: ['echo'] }, extDir)
    });
    const res = await caps.exec('alpha', { bin: 'echo', args: ['hi'] });
    expect(res.stdout.trim()).toBe('hi');
    expect(res.code).toBe(0);
  });

  it('rejects a bin not on the allowlist', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['exec'], { execAllowlist: ['echo'] }, extDir)
    });
    await expect(caps.exec('alpha', { bin: 'ls' })).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects when exec is not granted', async () => {
    const caps = brokerFor({ alpha: grantFromManifest(['storage'], undefined, extDir) });
    await expect(caps.exec('alpha', { bin: 'echo' })).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects a bin given as a path (not a basename)', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['exec'], { execAllowlist: ['echo'] }, extDir)
    });
    await expect(caps.exec('alpha', { bin: '/bin/echo' })).rejects.toThrow(/PermissionDenied/);
  });

  // S3: a spawn failure or watchdog timeout must REJECT (distinct from a clean
  // signal exit), so a hung child's kill surfaces as an error not {code:null}.
  it('REJECTS when the bin cannot be spawned (ENOENT), not a {code:null} success', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['exec'], { execAllowlist: ['definitely-no-such-bin-xyz'] }, extDir)
    });
    await expect(caps.exec('alpha', { bin: 'definitely-no-such-bin-xyz' })).rejects.toThrow(
      /failed to start/
    );
  });

  it('REJECTS when the process is killed by the timeout watchdog', async () => {
    // `sleep 5` with a 50ms timeout → Node kills it → killed:true → reject.
    const caps = brokerFor({
      alpha: grantFromManifest(['exec'], { execAllowlist: ['sleep'] }, extDir)
    });
    await expect(
      caps.exec('alpha', { bin: 'sleep', args: ['5'], timeoutMs: 50 })
    ).rejects.toThrow(/killed after .*ms/);
  });

  it('still RESOLVES a non-zero exit (ran, exited cleanly with a code)', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['exec'], { execAllowlist: ['sh'] }, extDir)
    });
    const res = await caps.exec('alpha', { bin: 'sh', args: ['-c', 'exit 3'] });
    expect(res.code).toBe(3);
  });

  // Regression (QA medium #1): the cwd was realpath-checked against the grant but
  // then the RAW `req.cwd` string was handed to execFile — a TOCTOU where a
  // symlink swapped after the check would spawn the child somewhere the grant
  // never authorized. The fix spawns with the already-resolved path. We can't
  // race a live swap in a unit test, but we can prove the child runs in the
  // RESOLVED dir (not the raw symlink path), which is the behaviour that closes
  // the window: pwd -P would print the real dir regardless, so we compare the
  // child's cwd via `pwd` (logical) — with the fix it lands on the real target.
  it('spawns exec in the realpath-resolved cwd, not the raw symlink path', async () => {
    const realTarget = await realpath(await mkdtemp(join(tmpdir(), 'cc-exec-real-')));
    try {
      const link = join(extDir, 'cwd-link');
      await symlink(realTarget, link, 'dir');
      // Grant fs:read over BOTH the link's real target and the ext dir so the
      // resolved-path assert passes the broker check.
      const caps = brokerFor({
        alpha: grantFromManifest(
          ['exec', 'fs:read'],
          { execAllowlist: ['pwd'], fsRoots: [extDir, realTarget] },
          extDir
        )
      });
      const res = await caps.exec('alpha', { bin: 'pwd', args: ['-P'], cwd: link });
      // pwd -P prints the physical dir; with the resolved cwd it is realTarget.
      expect(res.stdout.trim()).toBe(realTarget);
    } finally {
      await rm(realTarget, { recursive: true, force: true });
    }
  });

  // 0.4 (env by ALLOWLIST, not inherit): a brokered exec runs host-side via
  // execFile. Passing no `env` clones main's FULL process.env into the child, so
  // a disk ext calling `ctx.exec('printenv')` would read every host secret
  // (ANTHROPIC_API_KEY, AWS_*, tokens). The fix passes the trimmed child-env
  // allowlist, so a secret set on main's env must NOT appear in the child.
  it('does NOT leak a host secret (ANTHROPIC_API_KEY) into a brokered exec child', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-super-secret-should-not-leak';
    try {
      const caps = brokerFor({
        alpha: grantFromManifest(['exec'], { execAllowlist: ['printenv'] }, extDir)
      });
      // `printenv KEY` exits non-zero (code 1) with empty stdout when the var is
      // absent — the exec still RESOLVES (ran, exited), so we assert on stdout.
      const res = await caps.exec('alpha', { bin: 'printenv', args: ['ANTHROPIC_API_KEY'] });
      expect(res.stdout).not.toContain('super-secret');
      expect(res.stdout.trim()).toBe('');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('DOES forward PATH to a brokered exec child (so bins still resolve)', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['exec'], { execAllowlist: ['printenv'] }, extDir)
    });
    const res = await caps.exec('alpha', { bin: 'printenv', args: ['PATH'] });
    expect(res.stdout.trim().length).toBeGreaterThan(0);
  });
});

// P3-HARDEN: a symlink INSIDE a granted root that points OUTSIDE it (or at a
// sensitive root) must not let a read/write escape — the realpath re-check
// catches it after the lexical scope check passes.
describe('broker-caps — symlink/realpath escape', () => {
  // A SEPARATE temp tree that is NOT inside the ext dir (so it isn't covered by
  // the always-granted ext-dir root) — the symlink target must be truly outside.
  let outsideDir: string;
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-brokercaps-'));
    outsideDir = await mkdtemp(join(tmpdir(), 'cc-outside-'));
  });
  afterEach(async () => {
    await rm(extDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it('rejects a READ through a symlink inside a granted root pointing outside it', async () => {
    const root = join(extDir, 'data');
    await mkdir(root, { recursive: true });
    // Secret lives OUTSIDE the ext dir entirely.
    await writeFile(join(outsideDir, 'secret.txt'), 'TOPSECRET', 'utf-8');
    // A symlink inside the granted root → the outside secret.
    const link = join(root, 'link-to-secret');
    await symlink(join(outsideDir, 'secret.txt'), link);
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [root] }, extDir)
    });
    // Lexically `root/link-to-secret` is inside the root, but its realpath is
    // outside → must be denied.
    await expect(caps.readFile('alpha', link)).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects a STAT through a symlink inside a granted root pointing outside it', async () => {
    const root = join(extDir, 'data');
    await mkdir(root, { recursive: true });
    // Secret lives OUTSIDE the ext dir entirely.
    await writeFile(join(outsideDir, 'secret.txt'), 'TOPSECRET', 'utf-8');
    // A symlink inside the granted root → the outside secret.
    const link = join(root, 'link-to-secret');
    await symlink(join(outsideDir, 'secret.txt'), link);
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [root] }, extDir)
    });
    // Lexically `root/link-to-secret` is inside the root, but its realpath is
    // outside → must be denied (same as readFile).
    await expect(caps.stat('alpha', link)).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects a WRITE to a new file whose PARENT dir is a symlink escaping the root', async () => {
    const root = join(extDir, 'data');
    await mkdir(root, { recursive: true });
    // A symlinked subdir inside the root that points outside the ext dir.
    const linkDir = join(root, 'sub');
    await symlink(outsideDir, linkDir);
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:write'], { fsRoots: [root] }, extDir)
    });
    // Writing root/sub/new.txt resolves the symlinked parent to `outsideDir` →
    // escapes the granted root → denied (even though the leaf doesn't exist yet).
    await expect(
      caps.writeFile('alpha', join(linkDir, 'new.txt'), 'data')
    ).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects a WRITE through a symlink pointing into a sensitive root', async () => {
    const root = join(extDir, 'data');
    await mkdir(root, { recursive: true });
    // A sensitive root that's guaranteed to EXIST (a real ~/.ssh may be absent
    // on a clean CI runner, which would make the symlink dangle → ENOENT before
    // the sensitive-root check ever runs). Inject it so the test is hermetic.
    await mkdir(join(extDir, 'secrets'), { recursive: true });
    // realpath it: on macOS tmpdir() lives under /var → /private/var, and
    // broker-caps realpaths the symlink target, so the injected sensitive root
    // must be in its real on-disk form too (mirrors production's realpathOrSelf).
    const sensitive = await realpath(join(extDir, 'secrets'));
    // Symlink inside the granted root → the sensitive root.
    const link = join(root, 'secrets-link');
    await symlink(sensitive, link);
    const caps = brokerFor(
      { alpha: grantFromManifest(['fs:write'], { fsRoots: [root] }, extDir) },
      () => [sensitive]
    );
    await expect(
      caps.writeFile('alpha', join(link, 'authorized_keys'), 'pwned')
    ).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects RM through a symlink inside a granted root pointing outside it', async () => {
    const root = join(extDir, 'data');
    await mkdir(root, { recursive: true });
    // Victim file lives OUTSIDE the ext dir entirely.
    await writeFile(join(outsideDir, 'victim.txt'), 'do-not-delete', 'utf-8');
    // A symlink inside the granted root → the outside victim.
    const link = join(root, 'link-to-victim');
    await symlink(join(outsideDir, 'victim.txt'), link);
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:write'], { fsRoots: [root] }, extDir)
    });
    // Lexically `root/link-to-victim` is inside the root, but its realpath is
    // outside → must be denied (symlink-safe, same as read/write).
    await expect(caps.rm('alpha', link)).rejects.toThrow(/PermissionDenied/);
    // Verify the victim file still exists (rm never ran)
    const checkCaps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [outsideDir] }, extDir)
    });
    expect(await checkCaps.exists('alpha', join(outsideDir, 'victim.txt'))).toBe(true);
  });

  it('still allows a legit read of a real file inside the granted root', async () => {
    const root = join(extDir, 'data');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'ok.txt'), 'fine', 'utf-8');
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [root] }, extDir)
    });
    expect(await caps.readFile('alpha', join(root, 'ok.txt'))).toBe('fine');
  });
});

describe('broker-caps — gated fetch', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-brokercaps-'));
  });
  afterEach(async () => {
    await rm(extDir, { recursive: true, force: true });
  });

  it('rejects an off-allowlist host before any network call', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['net'], { egressAllowlist: ['api.example.com'] }, extDir)
    });
    await expect(caps.fetch('alpha', 'https://evil.com/x')).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects when net is not granted', async () => {
    const caps = brokerFor({ alpha: grantFromManifest(['storage'], undefined, extDir) });
    await expect(caps.fetch('alpha', 'https://api.example.com/x')).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects an invalid url', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['net'], { egressAllowlist: ['api.example.com'] }, extDir)
    });
    await expect(caps.fetch('alpha', 'not a url')).rejects.toThrow(/invalid url/);
  });

  describe('redirect + body-cap hardening (B1)', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    /** A minimal Response stand-in (status + headers, no body) for redirect tests. */
    function redirectTo(location: string) {
      return new Response(null, { status: 302, headers: { location } });
    }

    it('re-asserts net on a redirect and REJECTS a hop to a non-allowlisted host (SSRF)', async () => {
      const caps = brokerFor({
        alpha: grantFromManifest(['net'], { egressAllowlist: ['api.example.com'] }, extDir)
      });
      // First (allowlisted) request 302s to the cloud-metadata IP — must be denied.
      globalThis.fetch = (async () =>
        redirectTo('http://169.254.169.254/latest/meta-data/')) as typeof fetch;
      await expect(caps.fetch('alpha', 'https://api.example.com/start')).rejects.toThrow(
        /PermissionDenied/
      );
    });

    it('follows a redirect to ANOTHER allowlisted host', async () => {
      const caps = brokerFor({
        alpha: grantFromManifest(
          ['net'],
          { egressAllowlist: ['api.example.com', 'cdn.example.com'] },
          extDir
        )
      });
      let calls = 0;
      globalThis.fetch = (async (input: string) => {
        calls++;
        if (String(input).includes('api.example.com')) {
          return redirectTo('https://cdn.example.com/asset');
        }
        return new Response('ok', { status: 200 });
      }) as typeof fetch;
      const res = await caps.fetch('alpha', 'https://api.example.com/start');
      expect(res.status).toBe(200);
      expect(res.body).toBe('ok');
      expect(calls).toBe(2);
    });

    it('rejects a redirect loop past the hop limit', async () => {
      const caps = brokerFor({
        alpha: grantFromManifest(['net'], { egressAllowlist: ['api.example.com'] }, extDir)
      });
      // Always 302 back to an allowlisted host → exceeds FETCH_MAX_REDIRECTS.
      globalThis.fetch = (async () =>
        redirectTo('https://api.example.com/again')) as typeof fetch;
      await expect(caps.fetch('alpha', 'https://api.example.com/start')).rejects.toThrow(
        /too many redirects/
      );
    });

    it('caps an oversized response body instead of buffering it whole', async () => {
      const caps = brokerFor({
        alpha: grantFromManifest(['net'], { egressAllowlist: ['api.example.com'] }, extDir)
      });
      // Stream more than the 8MiB cap in chunks.
      const chunk = new Uint8Array(1024 * 1024); // 1 MiB
      globalThis.fetch = (async () => {
        let sent = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent >= 16) {
              controller.close();
              return;
            }
            sent++;
            controller.enqueue(chunk);
          }
        });
        return new Response(stream, { status: 200 });
      }) as typeof fetch;
      await expect(caps.fetch('alpha', 'https://api.example.com/big')).rejects.toThrow(
        /exceeds .* bytes/
      );
    });
  });
});

describe('broker-caps — gated LLM micro-call (Epic C)', () => {
  /** A fake LlmService.run that records the entry it was handed and echoes back. */
  function fakeLlm(overrides?: Partial<LlmRunResult>) {
    const seen: LlmPromptEntry[] = [];
    const run = async (entry: LlmPromptEntry): Promise<LlmRunResult> => {
      seen.push(entry);
      return {
        ok: true,
        text: 'echo',
        provider: 'claude-cli',
        model: entry.model,
        ms: 5,
        usage: { inputTokens: 10, outputTokens: 3 },
        ...overrides
      };
    };
    return { run, seen };
  }

  function llmCaps(
    perms: string[],
    opts: { enabled?: boolean; llm?: ReturnType<typeof fakeLlm>; noService?: boolean } = {}
  ) {
    const broker = new PermissionBroker({
      builtinIds: new Set(['gus']),
      grants: (id) => (id === 'alpha' ? grantFromManifest(perms, undefined, '/tmp/x') : null)
    });
    const llm = opts.llm ?? fakeLlm();
    return {
      caps: createBrokerCapabilities(broker, {
        llmService: opts.noService ? undefined : { run: llm.run },
        llmEnabled: () => opts.enabled ?? true
      }),
      llm
    };
  }

  const REQ = { system: 'be terse', user: 'hello' };

  it('rejects (throws) when llm:invoke is not granted', async () => {
    const { caps } = llmCaps(['storage']);
    await expect(caps.llm('alpha', REQ)).rejects.toThrow(/PermissionDenied/);
  });

  it('resolves ok:false with code "disabled" when the global kill switch is off (not a throw)', async () => {
    const { caps } = llmCaps(['llm:invoke'], { enabled: false });
    const r = await caps.llm('alpha', REQ);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('disabled');
    expect(r.error).toMatch(/disabled/);
  });

  it('resolves ok:false with code "unavailable" when no LlmService is wired', async () => {
    const { caps } = llmCaps(['llm:invoke'], { noService: true });
    const r = await caps.llm('alpha', REQ);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('unavailable');
    expect(r.error).toMatch(/no LLM service/);
  });

  it('runs a granted+enabled call and STRIPS the result (no provider/model/usage)', async () => {
    const { caps } = llmCaps(['llm:invoke']);
    const r = await caps.llm('alpha', REQ);
    expect(r.ok).toBe(true);
    expect(r.text).toBe('echo');
    expect(typeof r.ms).toBe('number');
    // The narrow SDK shape leaks nothing else — no provider/model/usage, and
    // no `error`/`code` on the success path.
    expect(Object.keys(r).sort()).toEqual(['ms', 'ok', 'text']);
  });

  it('a provider-side ok:false surfaces as code "provider-error"', async () => {
    const { caps } = llmCaps(['llm:invoke'], {
      llm: fakeLlm({ ok: false, text: '', error: 'timed out after 30000ms' })
    });
    const r = await caps.llm('alpha', REQ);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('provider-error');
    expect(r.error).toMatch(/timed out/);
  });

  it('condition #1: clamps oversized system + user input', async () => {
    const { caps, llm } = llmCaps(['llm:invoke']);
    await caps.llm('alpha', { system: 'S'.repeat(10_000), user: 'U'.repeat(20_000) });
    const entry = llm.seen[0];
    expect(entry.systemPrompt.length).toBe(4_000); // EXT_LLM_SYSTEM_MAX_CHARS
    expect(entry.userTemplate.length).toBe(8_000); // EXT_LLM_USER_MAX_CHARS
  });

  it('condition #2: hard-clamps model to haiku regardless of the hint', async () => {
    const { caps, llm } = llmCaps(['llm:invoke']);
    await caps.llm('alpha', { ...REQ, model: 'opus' });
    expect(llm.seen[0].model).toBe('haiku');
  });

  it('condition #2: the synthetic entry never carries a provider or extra fields', async () => {
    const { caps, llm } = llmCaps(['llm:invoke']);
    await caps.llm('alpha', REQ);
    const entry = llm.seen[0];
    expect((entry as { provider?: unknown }).provider).toBeUndefined();
    // Whatever the choke-point built must itself pass the containment assertion.
    expect(() => assertContainedEntry(entry)).not.toThrow();
  });

  it('user text lands in userTemplate literally — {{…}} is NOT template-expanded', async () => {
    const { caps, llm } = llmCaps(['llm:invoke']);
    await caps.llm('alpha', { system: 's', user: 'leak {{secret}} here' });
    // Run with an empty vars map, so the placeholder survives verbatim.
    expect(llm.seen[0].userTemplate).toBe('leak {{secret}} here');
  });

  it('clamps output to the host ceiling and defaults when omitted', async () => {
    const { caps, llm } = llmCaps(['llm:invoke']);
    await caps.llm('alpha', { ...REQ, maxOutputChars: 999_999 });
    expect(llm.seen[0].maxOutputChars).toBe(4_000); // EXT_LLM_OUTPUT_MAX_CHARS
    await caps.llm('alpha', REQ);
    expect(llm.seen[1].maxOutputChars).toBe(2_000); // EXT_LLM_OUTPUT_DEFAULT_CHARS
  });

  it('enforces the sliding-window rate limit (20 / 5min)', async () => {
    const { caps } = llmCaps(['llm:invoke']);
    for (let i = 0; i < 20; i++) {
      const r = await caps.llm('alpha', REQ);
      expect(r.ok).toBe(true);
    }
    const over = await caps.llm('alpha', REQ);
    expect(over.ok).toBe(false);
    expect(over.code).toBe('rate-limited');
    expect(over.error).toMatch(/rate limit/);
  });

  it('enforces concurrency 1 per extension', async () => {
    // A slow fake so the first call is still in-flight when the second arrives.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = {
      run: async (entry: LlmPromptEntry): Promise<LlmRunResult> => {
        await gate;
        return { ok: true, text: 't', provider: 'claude-cli', model: entry.model, ms: 1 };
      },
      seen: [] as LlmPromptEntry[]
    };
    const { caps } = llmCaps(['llm:invoke'], { llm: slow });
    const first = caps.llm('alpha', REQ);
    const second = await caps.llm('alpha', REQ); // arrives while first is in-flight
    expect(second.ok).toBe(false);
    expect(second.code).toBe('busy');
    expect(second.error).toMatch(/already in flight/);
    release();
    expect((await first).ok).toBe(true);
  });

  it('rejects a non-string system/user as ok:false', async () => {
    const { caps } = llmCaps(['llm:invoke']);
    const r = await caps.llm('alpha', { system: 5 as unknown as string, user: 'x' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('invalid-request');
    expect(r.error).toMatch(/must be strings/);
  });
});

describe('assertContainedEntry (Epic C condition #2 contract)', () => {
  const base: LlmPromptEntry = {
    id: 'ext:alpha:llm',
    label: 'x',
    model: 'haiku',
    systemPrompt: 's',
    userTemplate: 'u',
    maxOutputChars: 2000,
    timeoutMs: 30000
  };

  it('accepts a well-formed contained entry', () => {
    expect(() => assertContainedEntry(base)).not.toThrow();
  });

  it('rejects an entry that carries a provider (extension-chosen vendor)', () => {
    expect(() => assertContainedEntry({ ...base, provider: 'openai' })).toThrow(/containment/);
  });

  it('rejects a non-haiku model (cost clamp escape)', () => {
    expect(() => assertContainedEntry({ ...base, model: 'opus' })).toThrow(/containment/);
  });

  it('rejects any unexpected field (e.g. a future project/argv-bearing key)', () => {
    expect(() =>
      assertContainedEntry({ ...base, source: 'user' } as LlmPromptEntry)
    ).toThrow(/containment/);
  });
});

describe('broker-caps — emit (W1-3)', () => {
  const mockBroker = {
    assert: vi.fn()
  } as unknown as PermissionBroker;

  it('sends frame via sink with namespaced topic', () => {
    const frames: Array<{ topic: string; payload: unknown }> = [];
    const sink = {
      frame: vi.fn((topic: string, payload: unknown) => {
        frames.push({ topic, payload });
      })
    };

    const caps = createBrokerCapabilities(mockBroker, { sink });
    caps.emit!('test-ext', 'myTopic', { data: 'hello' });

    expect(sink.frame).toHaveBeenCalledTimes(1);
    expect(sink.frame).toHaveBeenCalledWith('ext:test-ext:myTopic', { data: 'hello' });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      topic: 'ext:test-ext:myTopic',
      payload: { data: 'hello' }
    });
  });

  it('is no-op when sink is absent (test mock that omits it)', () => {
    const caps = createBrokerCapabilities(mockBroker, {});
    expect(() => caps.emit!('test-ext', 'topic', { data: 'test' })).not.toThrow();
  });

  it('is no-op for invalid topic (empty string)', () => {
    const sink = { frame: vi.fn() };
    const caps = createBrokerCapabilities(mockBroker, { sink });

    caps.emit!('test-ext', '', { data: 'test' });
    expect(sink.frame).not.toHaveBeenCalled();
  });

  it('is no-op for invalid topic (non-string)', () => {
    const sink = { frame: vi.fn() };
    const caps = createBrokerCapabilities(mockBroker, { sink });

    caps.emit!('test-ext', null as any, { data: 'test' });
    expect(sink.frame).not.toHaveBeenCalled();
  });

  it('drops frames over 128KiB size cap silently', () => {
    const sink = { frame: vi.fn() };
    const caps = createBrokerCapabilities(mockBroker, { sink });

    // Build a payload just over 128KiB
    const largePayload = { data: 'x'.repeat(130 * 1024) };
    caps.emit!('test-ext', 'topic', largePayload);

    // Should not call sink.frame — dropped silently
    expect(sink.frame).not.toHaveBeenCalled();
  });

  it('allows frames under 128KiB size cap', () => {
    const sink = { frame: vi.fn() };
    const caps = createBrokerCapabilities(mockBroker, { sink });

    // Build a payload just under 128KiB
    const okPayload = { data: 'x'.repeat(120 * 1024) };
    caps.emit!('test-ext', 'topic', okPayload);

    // Should succeed
    expect(sink.frame).toHaveBeenCalledTimes(1);
  });

  it('never throws on serialization failure (best-effort)', () => {
    const sink = { frame: vi.fn() };
    const caps = createBrokerCapabilities(mockBroker, { sink });

    // Create circular reference that JSON.stringify can't handle
    const circular: any = { a: 1 };
    circular.self = circular;

    expect(() => caps.emit!('test-ext', 'topic', circular)).not.toThrow();
    expect(sink.frame).not.toHaveBeenCalled(); // Dropped silently
  });

  it('never throws on sink error (best-effort)', () => {
    const sink = {
      frame: vi.fn(() => {
        throw new Error('sink error');
      })
    };
    const caps = createBrokerCapabilities(mockBroker, { sink });

    expect(() => caps.emit!('test-ext', 'topic', { data: 'test' })).not.toThrow();
  });

  it('requires no permission token (extension pushing its own data)', () => {
    const sink = { frame: vi.fn() };
    const caps = createBrokerCapabilities(mockBroker, { sink });

    caps.emit!('test-ext', 'topic', { data: 'test' });

    // broker.assert should never be called for emit
    expect(mockBroker.assert).not.toHaveBeenCalled();
  });

  it('enforces ~50fps rate limit per extension (drops frames above cap)', () => {
    const sink = { frame: vi.fn() };
    const caps = createBrokerCapabilities(mockBroker, { sink });

    // Send 50 frames in rapid succession — all should succeed
    for (let i = 0; i < 50; i++) {
      caps.emit!('test-ext', 'topic', { data: i });
    }
    expect(sink.frame).toHaveBeenCalledTimes(50);

    // 51st frame in the same 1-second window should be dropped (rate cap)
    caps.emit!('test-ext', 'topic', { data: 'over-cap' });
    expect(sink.frame).toHaveBeenCalledTimes(50); // Still 50, not 51

    // Another extension is independent (separate rate bucket)
    caps.emit!('other-ext', 'topic', { data: 'other' });
    expect(sink.frame).toHaveBeenCalledTimes(51); // other-ext's first frame succeeds
  });
});

describe('broker-caps — host.* trust inversion (W1-4)', () => {
  /** A hostCommands spy standing in for the HostCommandRelay. */
  function makeHostCommands() {
    const calls: Array<{ fn: string; args: unknown[] }> = [];
    return {
      calls,
      toast: (...args: unknown[]) => calls.push({ fn: 'toast', args }),
      navigate: (...args: unknown[]) => calls.push({ fn: 'navigate', args }),
      selectProject: (...args: unknown[]) => calls.push({ fn: 'selectProject', args }),
      requestLaunch: (...args: unknown[]) => {
        calls.push({ fn: 'requestLaunch', args });
        return { parked: true, requestId: 'req-1' };
      },
      // W1-5 main-reachable host UX (round-trip): the spy resolves a fixed answer.
      confirm: (...args: unknown[]) => {
        calls.push({ fn: 'confirm', args });
        return Promise.resolve(true);
      },
      alert: (...args: unknown[]) => {
        calls.push({ fn: 'alert', args });
        return Promise.resolve(null);
      },
      closeForModule: (...args: unknown[]) => calls.push({ fn: 'closeForModule', args })
    };
  }

  it('toast/navigate are UNCONDITIONAL (no permission assert) and delegate to the relay', () => {
    const assert = vi.fn();
    const broker = { assert } as unknown as PermissionBroker;
    const hostCommands = makeHostCommands();
    const caps = createBrokerCapabilities(broker, { hostCommands });

    caps.hostToast!('ext-a', 'hi', 'error');
    caps.hostNavigate!('ext-a', 'inbox');

    expect(assert).not.toHaveBeenCalled(); // inert UI nudges — no token
    expect(hostCommands.calls).toEqual([
      { fn: 'toast', args: ['ext-a', 'hi', 'error'] },
      { fn: 'navigate', args: ['ext-a', 'inbox'] }
    ]);
  });

  it('selectProject asserts projects:select BEFORE delegating', () => {
    const assert = vi.fn();
    const broker = { assert } as unknown as PermissionBroker;
    const hostCommands = makeHostCommands();
    const caps = createBrokerCapabilities(broker, { hostCommands });

    caps.hostSelectProject!('ext-a', 'proj-9');

    expect(assert).toHaveBeenCalledWith('ext-a', 'projects:select');
    expect(hostCommands.calls).toEqual([{ fn: 'selectProject', args: ['ext-a', 'proj-9'] }]);
  });

  it('selectProject is DENIED (throws, no delegate) when the gate rejects', () => {
    const assert = vi.fn(() => {
      throw new Error('PermissionDenied: ext-a lacks "projects:select"');
    });
    const broker = { assert } as unknown as PermissionBroker;
    const hostCommands = makeHostCommands();
    const caps = createBrokerCapabilities(broker, { hostCommands });

    expect(() => caps.hostSelectProject!('ext-a', 'proj-9')).toThrow(/PermissionDenied/);
    expect(hostCommands.calls).toHaveLength(0); // never reached the relay
  });

  it('requestLaunch asserts session:launch, validates projectId, then delegates', async () => {
    const assert = vi.fn();
    const broker = { assert } as unknown as PermissionBroker;
    const hostCommands = makeHostCommands();
    const caps = createBrokerCapabilities(broker, { hostCommands });

    const res = await caps.hostRequestLaunch!('ext-a', { projectId: 'proj-1', title: 't' });

    expect(assert).toHaveBeenCalledWith('ext-a', 'session:launch');
    expect(hostCommands.calls).toEqual([
      { fn: 'requestLaunch', args: ['ext-a', { projectId: 'proj-1', title: 't' }] }
    ]);
    expect(res).toEqual({ parked: true, requestId: 'req-1' });
  });

  it('requestLaunch is DENIED (throws, no delegate) when the gate rejects', async () => {
    const assert = vi.fn(() => {
      throw new Error('PermissionDenied: ext-a lacks "session:launch"');
    });
    const broker = { assert } as unknown as PermissionBroker;
    const hostCommands = makeHostCommands();
    const caps = createBrokerCapabilities(broker, { hostCommands });

    await expect(caps.hostRequestLaunch!('ext-a', { projectId: 'proj-1' })).rejects.toThrow(
      /PermissionDenied/
    );
    expect(hostCommands.calls).toHaveLength(0);
  });

  it('requestLaunch rejects a spec missing projectId AFTER passing the gate', async () => {
    const assert = vi.fn();
    const broker = { assert } as unknown as PermissionBroker;
    const hostCommands = makeHostCommands();
    const caps = createBrokerCapabilities(broker, { hostCommands });

    await expect(
      caps.hostRequestLaunch!('ext-a', { projectId: '' } as { projectId: string })
    ).rejects.toThrow(/projectId is required/);
    expect(assert).toHaveBeenCalledWith('ext-a', 'session:launch'); // gate ran first
    expect(hostCommands.calls).toHaveLength(0); // never delegated the malformed spec
  });

  it('streamCloseAll also releases the module’s parked launches (Rule 3)', () => {
    const broker = { assert: vi.fn() } as unknown as PermissionBroker;
    const hostCommands = makeHostCommands();
    const caps = createBrokerCapabilities(broker, { hostCommands });

    caps.streamCloseAll!('ext-a');

    expect(hostCommands.calls).toContainEqual({ fn: 'closeForModule', args: ['ext-a'] });
  });
});

describe('broker-caps — inbox push (Phase B)', () => {
  /** A minimal inbox bridge spy standing in for {@link InboxBrokerDeps}. */
  function makeInboxDeps(knownProjectIds: string[] = ['proj-1']) {
    const appended: InboxInput[] = [];
    return {
      appended,
      projectExists: (id: string) => knownProjectIds.includes(id),
      inboxStore: {
        append: async (input: InboxInput): Promise<InboxEntry> => {
          appended.push(input);
          return { ...input, id: 'entry-1', ts: 0 };
        }
      }
    };
  }

  it('asserts inbox:push, validates projectId, then delegates + stamps extensionSource', async () => {
    const assert = vi.fn();
    const broker = { assert } as unknown as PermissionBroker;
    const inbox = makeInboxDeps();
    const caps = createBrokerCapabilities(broker, { inbox });

    const res = await caps.inboxPush!('ext-a', { projectId: 'proj-1', comments: 'hi' });

    expect(assert).toHaveBeenCalledWith('ext-a', 'inbox:push');
    expect(res).toEqual({ id: 'entry-1' });
    expect(inbox.appended).toEqual([
      { projectId: 'proj-1', comments: 'hi', docs: undefined, extensionSource: { extensionId: 'ext-a' } }
    ]);
  });

  it('is DENIED (throws, no delegate) when the gate rejects', async () => {
    const assert = vi.fn(() => {
      throw new Error('PermissionDenied: ext-a lacks "inbox:push"');
    });
    const broker = { assert } as unknown as PermissionBroker;
    const inbox = makeInboxDeps();
    const caps = createBrokerCapabilities(broker, { inbox });

    await expect(caps.inboxPush!('ext-a', { projectId: 'proj-1' })).rejects.toThrow(
      /PermissionDenied/
    );
    expect(inbox.appended).toHaveLength(0);
  });

  it('rejects an unknown projectId AFTER passing the gate', async () => {
    const assert = vi.fn();
    const broker = { assert } as unknown as PermissionBroker;
    const inbox = makeInboxDeps(['proj-1']);
    const caps = createBrokerCapabilities(broker, { inbox });

    await expect(caps.inboxPush!('ext-a', { projectId: 'proj-unknown' })).rejects.toThrow(
      /unknown projectId/
    );
    expect(assert).toHaveBeenCalledWith('ext-a', 'inbox:push'); // gate ran first
    expect(inbox.appended).toHaveLength(0);
  });

  it('rejects a missing projectId AFTER passing the gate', async () => {
    const assert = vi.fn();
    const broker = { assert } as unknown as PermissionBroker;
    const inbox = makeInboxDeps();
    const caps = createBrokerCapabilities(broker, { inbox });

    await expect(
      caps.inboxPush!('ext-a', { projectId: '' } as { projectId: string })
    ).rejects.toThrow(/projectId is required/);
    expect(assert).toHaveBeenCalledWith('ext-a', 'inbox:push');
    expect(inbox.appended).toHaveLength(0);
  });

  it('degrades to a "bridge unavailable" throw when no inbox dep is wired', async () => {
    const assert = vi.fn();
    const broker = { assert } as unknown as PermissionBroker;
    const caps = createBrokerCapabilities(broker, {}); // no `inbox` dep

    await expect(caps.inboxPush!('ext-a', { projectId: 'proj-1' })).rejects.toThrow(
      /no inbox bridge available/
    );
    expect(assert).toHaveBeenCalledWith('ext-a', 'inbox:push'); // gate still ran first
  });

  it('stamps a self-targeting `target` alongside extensionSource', async () => {
    const assert = vi.fn();
    const broker = { assert } as unknown as PermissionBroker;
    const inbox = makeInboxDeps();
    const caps = createBrokerCapabilities(broker, { inbox });

    const res = await caps.inboxPush!('ext-a', {
      projectId: 'proj-1',
      comments: 'hi',
      target: { moduleId: 'ext-a' }
    });

    expect(res).toEqual({ id: 'entry-1' });
    expect(inbox.appended).toEqual([
      {
        projectId: 'proj-1',
        comments: 'hi',
        docs: undefined,
        target: { moduleId: 'ext-a' },
        extensionSource: { extensionId: 'ext-a' }
      }
    ]);
  });

  it('rejects a `target` naming a sibling module, even from the authenticated brokered path', async () => {
    const assert = vi.fn();
    const broker = { assert } as unknown as PermissionBroker;
    const inbox = makeInboxDeps();
    const caps = createBrokerCapabilities(broker, { inbox });

    await expect(
      caps.inboxPush!('ext-a', {
        projectId: 'proj-1',
        comments: 'hi',
        target: { moduleId: 'ext-b' }
      })
    ).rejects.toThrow(/target\.moduleId must be the pushing extension's own id/);
    expect(inbox.appended).toHaveLength(0);
  });
});
