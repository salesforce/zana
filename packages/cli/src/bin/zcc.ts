#!/usr/bin/env node

/**
 * Thin entrypoint for the zcc CLI. Calls runCli, prints results, and sets
 * process.exitCode. Never calls process.exit mid-logic — that discipline
 * makes runCli testable with golden files.
 */

import { runCli } from '../lib/run-cli.js';

async function main() {
  const result = await runCli(process.argv);

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  process.exitCode = result.exitCode;
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exitCode = 1;
});
