#!/usr/bin/env node
/**
 * Electron and Node require different native-addon ABIs. Keep the switch inside
 * supported E2E commands and always restore Node's ABI for Vitest and dev tools.
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2).filter((arg, index) => arg !== '--' || index !== 0);
const build = args[0] === '--build';
const playwrightArgs = build ? args.slice(1) : args;

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main() {
  let exitCode = 0;
  try {
    if (build) {
      exitCode = run('pnpm', ['run', 'build:legacy']);
    }
    if (exitCode === 0) exitCode = run('pnpm', ['run', 'rebuild:electron']);
    if (exitCode === 0) exitCode = run('pnpm', ['exec', 'playwright', 'test', ...playwrightArgs]);
  } finally {
    const restoreStatus = run('node', ['scripts/ensure-better-sqlite3.mjs']);
    if (restoreStatus !== 0) {
      process.stderr.write(
        `[run-electron-e2e] error: failed to restore Node ABI for better-sqlite3 (exit ${restoreStatus})\n`
      );
      exitCode = 1;
    }
  }
  return exitCode;
}

process.exitCode = main();
