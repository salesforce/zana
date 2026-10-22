import { runPluginSourceCommand as run } from './plugin-source-command.js';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolveBundledNpmCli } from '@zana-ai/zcc-plugin-build';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const MARKETPLACE_MAX_BYTES = 1_048_576;
export const MARKETPLACE_FETCH_TIMEOUT_MS = 15_000;

export async function defaultSpawnNpm(
  args: string[],
  cwd: string,
  signal?: AbortSignal
): Promise<{ code: number; stdout: string; stderr: string }> {
  mkdirSync(cwd, { recursive: true });
  // A failed online check must not silently fall back to stale npm metadata.
  const cache = args[0] === 'view' ? mkdtempSync(join(tmpdir(), 'zcc-plugin-npm-check-')) : undefined;
  try {
    return await run(process.execPath, [resolveBundledNpmCli(), ...args,
      '--fetch-retries=0', '--fetch-timeout=15000', ...(cache ? ['--cache', cache] : [])
    ], cwd, { env: { ELECTRON_RUN_AS_NODE: '1' }, timeoutMs: 120_000, signal });
  } finally { if (cache) rmSync(cache, { recursive: true, force: true }); }
}

export async function defaultCloneGit(
  url: string,
  dest: string,
  spec: string,
  signal?: AbortSignal
): Promise<{ commit: string; refKind: 'branch' | 'tag' | 'commit' }> {
  mkdirSync(dirname(dest), { recursive: true });
  if (spec.startsWith('commit:') || /^[a-f0-9]{7,40}$/i.test(spec)) {
    const commit = spec.replace(/^commit:/, '');
    if (!/^[a-f0-9]{7,40}$/i.test(commit)) throw new Error('Invalid Git commit');
    for (const args of [['init', dest], ['-C', dest, 'fetch', '--depth', '1', '--', url, commit], ['-C', dest, 'checkout', '--detach', 'FETCH_HEAD']]) {
      const result = await run('git', args, dirname(dest), { signal });
      if (result.code !== 0) throw new Error('Git could not materialize the selected commit');
    }
  } else {
    if (spec.startsWith('semver:')) throw new Error('Git ranges must be resolved before cloning');
    const cloneArgs = ['clone', '--depth', '1'];
    if (spec && spec !== 'HEAD') cloneArgs.push('--branch', spec.replace(/^ref:/, ''));
    cloneArgs.push('--', url, dest);
    const cloned = await run('git', cloneArgs, dirname(dest), { signal });
    if (cloned.code !== 0) throw new Error('Git clone failed');
  }
  const head = await run('git', ['-C', dest, 'rev-parse', 'HEAD'], dest, { signal });
  if (head.code !== 0) throw new Error('Git rev-parse failed');
  const branch = await run('git', ['-C', dest, 'symbolic-ref', '--quiet', 'HEAD'], dest, { signal });
  return { commit: head.stdout.trim(), refKind: spec.startsWith('commit:') || /^[a-f0-9]{7,40}$/i.test(spec) ? 'commit' : branch.code === 0 ? 'branch' : 'tag' };
}

export async function defaultFetchJson(url: string): Promise<unknown> {
  if (!url.startsWith('https://')) throw new Error('marketplace URL must be https');
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('marketplace request timed out'));
  }, MARKETPLACE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'error', signal: controller.signal });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`marketplace fetch failed: ${res.status}`);
    }
    if (!res.body) throw new Error('marketplace response is empty');
    const reader = res.body.getReader();
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MARKETPLACE_MAX_BYTES) {
          throw new Error(`marketplace index exceeds ${MARKETPLACE_MAX_BYTES} bytes`);
        }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}
