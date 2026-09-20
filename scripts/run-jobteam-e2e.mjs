#!/usr/bin/env node
import { main } from './run-electron-e2e.mjs';

process.exitCode = await main([
  '--build',
  'e2e/job-team-launch-ui.spec.ts',
  'e2e/job-team-failed-dag.spec.ts',
  'e2e/cli-agent-job-team-run.spec.ts',
  'e2e/modern-owner-job-team-run.spec.ts',
  ...process.argv.slice(2)
]);
