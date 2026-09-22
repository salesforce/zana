import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MARKETPLACE_MAX_BYTES = 1_048_576;
export const MARKETPLACE_FETCH_TIMEOUT_MS = 15_000;

export async function defaultSpawnNpm(
  args: string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  mkdirSync(cwd, { recursive: true });
  return run('npm', args, cwd);
}

export async function defaultCloneGit(
  url: string,
  dest: string,
  spec: string
): Promise<{ commit: string }> {
  mkdirSync(dirname(dest), { recursive: true });
  const cloneArgs = ['clone', '--depth', '1'];
  if (spec && spec !== 'HEAD' && !spec.startsWith('semver:')) {
    cloneArgs.push('--branch', spec.replace(/^ref:/, ''));
  }
  cloneArgs.push(url, dest);
  const cloned = await run('git', cloneArgs, dirname(dest));
  if (cloned.code !== 0) throw new Error(cloned.stderr || `git clone failed for ${url}`);
  const head = await run('git', ['-C', dest, 'rev-parse', 'HEAD'], dest);
  if (head.code !== 0) throw new Error(head.stderr || 'git rev-parse failed');
  return { commit: head.stdout.trim() };
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

function run(
  command: string,
  args: string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      resolve({ code: 1, stdout: '', stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
  });
}
