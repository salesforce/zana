import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnCommand } from './pre-push-verification.mjs';

/** Keep tracked and new guards visible without shell substitution or a separate file finder. */
export function guardTestFiles(root) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
  });
  return [...new Set(files.split('\0').filter(path => /guard\.test\.ts$/u.test(path) && existsSync(join(root, path))))].sort();
}

export function verifyFast({ root = process.cwd(), run = spawnCommand } = {}) {
  const checks = [['run', 'typecheck'], ['exec', 'vitest', 'run', '--changed', 'origin/main']];
  for (const args of checks) {
    const result = run('pnpm', args, { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) return result.status ?? 1;
  }
  const guards = guardTestFiles(root);
  if (!guards.length) return 0;
  const result = run('pnpm', ['exec', 'vitest', 'run', ...guards], { cwd: root, stdio: 'inherit' });
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = verifyFast();
