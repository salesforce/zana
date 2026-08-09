import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DENIED_BUILTINS,
  isDeniedBuiltin,
  denylistLoaderHookUrl,
  installChildBuiltinGuard
} from '../host-child-guard.js';

describe('host-child-guard — denylist predicate', () => {
  it('denies bare and node:-prefixed forms of each denied builtin', () => {
    for (const b of DENIED_BUILTINS) {
      expect(isDeniedBuiltin(b)).toBe(true);
      expect(isDeniedBuiltin(`node:${b}`)).toBe(true);
    }
  });

  it('the headline escape builtins are all on the list', () => {
    for (const b of ['child_process', 'fs', 'fs/promises', 'net', 'dgram', 'http', 'https', 'vm', 'worker_threads']) {
      expect(isDeniedBuiltin(b)).toBe(true);
    }
  });

  it('allows inert helper builtins and rejects non-strings', () => {
    expect(isDeniedBuiltin('node:url')).toBe(false);
    expect(isDeniedBuiltin('path')).toBe(false);
    expect(isDeniedBuiltin('os')).toBe(false);
    expect(isDeniedBuiltin(undefined)).toBe(false);
    expect(isDeniedBuiltin(42)).toBe(false);
  });

  it('denies node:module to untrusted code (removes the live-Module foothold)', () => {
    // The bootstrap imports node:module BEFORE registering the hook, so this only
    // affects the untrusted graph — it cannot grab Module._cache / createRequire.
    expect(isDeniedBuiltin('module')).toBe(true);
    expect(isDeniedBuiltin('node:module')).toBe(true);
  });

  it('emits a registerable data: URL loader hook', () => {
    const url = denylistLoaderHookUrl();
    expect(url.startsWith('data:text/javascript,')).toBe(true);
    // The denied list is inlined into the hook source.
    expect(decodeURIComponent(url)).toContain('child_process');
    expect(decodeURIComponent(url)).toContain('export async function resolve');
  });
});

describe('host-child-guard — installChildBuiltinGuard (CJS + process.binding)', () => {
  it('installChildBuiltinGuard blocks CJS require of a denied builtin (in-process)', async () => {
    // Calling the guard mutates this worker's Module._load + process.binding.
    // It is idempotent and we restore process.binding after.
    const origBinding = (process as unknown as { binding?: unknown }).binding;
    installChildBuiltinGuard();
    try {
      const { createRequire } = await import('node:module');
      const req = createRequire(import.meta.url);
      expect(() => req('child_process')).toThrow(/ExtensionDenied/);
      expect(() => req('fs')).toThrow(/ExtensionDenied/);
      // A non-denied builtin still loads.
      expect(() => req('node:path')).not.toThrow();
      // process.binding is neutered.
      expect(() =>
        (process as unknown as { binding: (n: string) => unknown }).binding('spawn_sync')
      ).toThrow(/ExtensionDenied/);
    } finally {
      (process as unknown as { binding?: unknown }).binding = origBinding;
    }
  });
});

/**
 * End-to-end: register the loader hook in a REAL child node process and confirm a
 * dynamic `import('node:child_process')` from "extension" code throws, while an
 * import of an allowed builtin + the broker-style ctx path works. This exercises
 * the actual `module.register(data:URL)` mechanism, not a re-implementation.
 */
describe('host-child-guard — ESM loader hook (real child process)', () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('blocks dynamic import of node:child_process from untrusted code; allows node:os', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cc-guard-'));
    const hookUrl = denylistLoaderHookUrl();
    // A boot script that registers the hook then imports two "extensions".
    const boot = `
import module from 'node:module';
module.register(${JSON.stringify(hookUrl)});
async function tryImport(spec) {
  try { await import(spec); return 'ALLOWED'; }
  catch (e) { return 'BLOCKED:' + (e && e.message ? e.message : String(e)); }
}
const cp = await tryImport('node:child_process');
const fs = await tryImport('fs');
const os = await tryImport('node:os');
process.stdout.write(JSON.stringify({ cp, fs, os }));
`;
    const bootPath = join(dir, 'boot.mjs');
    await writeFile(bootPath, boot, 'utf-8');
    const out = spawnSync(process.execPath, [bootPath], { encoding: 'utf-8' });
    expect(out.status).toBe(0);
    const result = JSON.parse(out.stdout) as { cp: string; fs: string; os: string };
    expect(result.cp).toMatch(/^BLOCKED:.*ExtensionDenied/);
    expect(result.fs).toMatch(/^BLOCKED:.*ExtensionDenied/);
    expect(result.os).toBe('ALLOWED');
  });
});
