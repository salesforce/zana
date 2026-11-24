#!/usr/bin/env node
import { main } from './run-electron-e2e.mjs';

// Register every new Job Team spec HERE (one list serves both `test:e2e:jobteam` and `:only`);
// a spec missing from this list is silently skipped by the gate.
const JOBTEAM_SPECS = [
  'e2e/job-team-launch-ui.spec.ts',
  'e2e/job-team-failed-dag.spec.ts',
  'e2e/cli-agent-job-team-run.spec.ts',
  'e2e/modern-owner-job-team-run.spec.ts',
  'e2e/squad-proposal-flow.spec.ts',
  'e2e/squad-direct-report.spec.ts',
  'e2e/job-team-stuck-worker-reclaim.spec.ts',
  'e2e/job-team-kickoff-churn.spec.ts',
  'e2e/job-team-stopped-worker-recovery.spec.ts',
  'e2e/job-team-peer-handoff.spec.ts',
  'e2e/job-team-wedge-recovery.spec.ts',
  'e2e/job-team-streaming-worker-no-reclaim.spec.ts',
  'e2e/job-team-flow-activity-indicator.spec.ts',
  'e2e/squad-routing-control.spec.ts',
  'e2e/job-team-cli-plan-input.spec.ts',
  'e2e/job-team-failed-slots.spec.ts',
  'e2e/job-team-launch-complete-fault.spec.ts',
  'e2e/job-team-worker-exit.spec.ts',
  'e2e/job-team-worker-respawn.spec.ts',
  'e2e/squad-checkpoints-resplit.spec.ts',
  'e2e/claimed-worker-restart.spec.ts',
  'e2e/job-team-worker-restart.spec.ts',
  'e2e/job-team-run-limits.spec.ts',
  'e2e/job-team-no-turn-warning.spec.ts',
  'e2e/squad-settings-surfaces.spec.ts'
];

// `--only` snapshots an already-built app instead of building (the `:only` package script).
const cliArgs = process.argv.slice(2);
const only = cliArgs[0] === '--only';
/* c8 ignore next -- package script only selects Playwright specs; E2E validates execution. */
process.exitCode = await main([
  ...(only ? [] : ['--build']),
  ...JOBTEAM_SPECS,
  ...(only ? cliArgs.slice(1) : cliArgs)
]);
