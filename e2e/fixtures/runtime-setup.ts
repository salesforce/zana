import type { FullConfig } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareElectronRuntime } from '../../scripts/electron-build-workspace.mjs';
import { pruneCompletedRuns } from '../../scripts/e2e-artifacts.mjs';

/** Applies to direct Playwright invocation too, so forgetting a wrapper cannot flip SQLite. */
export default async function setup(config: FullConfig) {
  const runtime = await prepareElectronRuntime({ build: process.env.ZCC_E2E_BUILD === '1' });
  process.env.ZCC_E2E_APP_ROOT = runtime.root;
  console.log(`[e2e] isolated app: ${runtime.root}`);
  console.log(`[e2e] results: ${config.projects[0].outputDir}`);
  return async () => {
    runtime.dispose();
    delete process.env.ZCC_E2E_APP_ROOT;
    for (const project of config.projects) {
      mkdirSync(project.outputDir, { recursive: true });
      writeFileSync(join(project.outputDir, '.zcc-complete'), '');
    }
    pruneCompletedRuns();
  };
}
