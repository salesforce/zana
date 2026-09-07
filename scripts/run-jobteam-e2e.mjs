#!/usr/bin/env node
/**
 * Cross-platform runner for `test:e2e:jobteam`. The old package.json script
 * used POSIX-only shell (`;`, `$?`, `exit $code`) so it never restored the
 * Node ABI on a Windows npm shell. This does the same build -> rebuild ->
 * test -> always-restore-ABI sequence via child_process, so the finally step
 * runs on every platform and on any failure (including a thrown error).
 */
import { spawnSync } from 'node:child_process';

const JOBTEAM_SPECS = [
  'e2e/job-team-launch-ui.spec.ts',
  'e2e/cli-agent-job-team-run.spec.ts',
  'e2e/modern-owner-job-team-run.spec.ts'
];

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main() {
  let exitCode = 1;
  try {
    exitCode = run('pnpm', ['run', 'build:legacy']);
    if (exitCode !== 0) return exitCode;

    exitCode = run('pnpm', ['run', 'rebuild:electron']);
    if (exitCode !== 0) return exitCode;

    exitCode = run('pnpm', ['exec', 'playwright', 'test', ...JOBTEAM_SPECS]);
    return exitCode;
  } finally {
    const restoreStatus = run('node', ['scripts/ensure-better-sqlite3.mjs']);
    if (restoreStatus !== 0) {
      process.stderr.write(
        `[run-jobteam-e2e] warning: failed to restore Node ABI for better-sqlite3 (exit ${restoreStatus})\n`
      );
    }
  }
}

process.exitCode = main();
