#!/usr/bin/env node
/** Every invocation owns its app snapshot, native packages and Playwright output. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCommand, REPO_ROOT } from './electron-build-workspace.mjs';

export function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== '--');
  const build = args[0] === '--build';
  return { build, playwrightArgs: build ? args.slice(1) : args };
}

export async function main(argv = process.argv.slice(2), run = runCommand) {
  const { build, playwrightArgs } = parseArgs(argv);
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  return run(process.execPath, [cli, 'test', ...playwrightArgs], {
    cwd: REPO_ROOT,
    env: { ...process.env, ZCC_E2E_BUILD: build ? '1' : '0' }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main();
}
