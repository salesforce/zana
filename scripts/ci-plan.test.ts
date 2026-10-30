import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { planVerification, previewAffected, runPlan } from './ci-plan.mjs';
import { boundarySpecs } from './ci-boundaries.mjs';
import { runVerification } from './ci-verification.mjs';

it('keeps cross-platform preview checks for native, path, render and distribution changes', () => {
  for (const path of [
    'apps/desktop/src/preload.ts', 'apps/host-daemon/src/remote-fs.ts', 'apps/server/src/http/product-api.ts',
    'apps/server/src/services/threads/thread-preview-resolution.ts', 'apps/server/src/plugins/builtin-registry.ts',
    'apps/server/src/utility-entry.ts', 'apps/server/src/services/projects/store.ts', 'packages/domain/src/product.ts',
    'apps/app/src/App.tsx', 'apps/app/src/styles/global.css', 'apps/app/src/lib/markdown-links.ts',
    'apps/app/src/components/thread/secondary-panel/FilePreview.tsx', 'apps/app/src/views/thread-detail/ThreadDetail.tsx',
    'e2e/fixtures/app.ts', 'e2e/thread-file-preview-ambiguity.spec.ts', 'scripts/ci-plan.mjs', 'scripts/build-electron.mjs',
    'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'electron.vite.config.ts', 'playwright.config.ts', '.github/workflows/ci.yml',
    '.github/actions/electron-cache/action.yml',
  ]) expect(previewAffected([path]), path).toBe(true);
  for (const path of ['docs/help.md', 'website/app/page.tsx', 'plugins/tasks/views/list.tsx', 'apps/server/src/services/inbox/store.ts']) {
    expect(previewAffected([path]), path).toBe(false);
  }
  expect(previewAffected([])).toBe(false);
  expect(planVerification([], true).preview).toBe(true);
});

it('plans only populated Electron shards with no install and agrees with actual execution', () => {
  expect(planVerification(['docs/help.md'])).toEqual({ preview: false, e2e: false, e2e_matrix: [1] });
  expect(planVerification(['scripts/ci-verification.mjs']).e2e_matrix).toEqual([1]);
  const paths = ['apps/app/src/App.tsx', 'apps/desktop/src/control/control-plane.ts'];
  const plan = planVerification(paths);
  const ran: string[] = [];
  for (const index of plan.e2e_matrix) {
    const execute = vi.fn().mockReturnValue(paths.map(path => `+++ b/${path}\n@@ -1 +1 @@`).join('\n'));
    expect(runVerification([], { CI_E2E_SHARD: `${index}/3` }, { execute, log: vi.fn(), error: vi.fn() })).toBe(0);
    ran.push(...execute.mock.calls[1][1].slice(2));
  }
  expect(ran.sort()).toEqual(boundarySpecs(paths));
  expect(new Set(ran).size).toBe(ran.length);
  const execute = vi.fn().mockReturnValue('+++ b/scripts/ci-verification.mjs\n@@ -1 +1 @@');
  expect(runVerification([], { CI_E2E_SHARD: '3/3' }, { execute, log: vi.fn(), error: vi.fn() })).toBe(0);
  expect(execute).toHaveBeenCalledOnce();
  execute.mockClear();
  expect(runVerification([], { CI_E2E_PREBUILT: '1' }, { execute, log: vi.fn(), error: vi.fn() })).toBe(0);
  expect(execute.mock.calls[1][1]).toEqual(['test:e2e:only', '--', 'e2e/smoke.spec.ts']);
});

it('writes explicit outputs, handles initial push bases and propagates planning failures', () => {
  const io = { execute: vi.fn().mockReturnValue('docs/help.md\0'), append: vi.fn(), log: vi.fn() };
  expect(runPlan({ GITHUB_OUTPUT: '/outputs' }, io).preview).toBe(false);
  expect(io.execute.mock.calls[0][1]).toContain('HEAD^');
  expect(io.append).toHaveBeenCalledWith('/outputs', 'preview=false\n');
  expect(io.append).toHaveBeenCalledWith('/outputs', 'e2e_matrix=[1]\n');
  runPlan({ CI_BASE_SHA: '0000', CI_FORCE_PREVIEW: 'true' }, io);
  expect(io.append).toHaveBeenCalledWith(undefined, 'preview=true\n');
  runPlan({ CI_BASE_SHA: 'base' }, io);
  expect(io.execute.mock.calls.at(-1)![1]).toContain('base');
  io.execute.mockImplementation(() => { throw new Error('bad base'); });
  expect(() => runPlan({}, io)).toThrow('bad base');
});

it('gates selective jobs on successful planning and keeps all required checks load-bearing', () => {
  const workflow = load(readFileSync('.github/workflows/ci.yml', 'utf8')) as any;
  expect(workflow.jobs.plan.steps.some((step: any) => step.run?.includes('install'))).toBe(false);
  expect(workflow.jobs.e2e.needs).toEqual(['plan', 'e2e-build']);
  expect(workflow.jobs.e2e.if).toBe("needs.plan.outputs.e2e == 'true'");
  expect(workflow.jobs['preview-cross-platform'].if).toBe("needs.plan.outputs.preview == 'true'");
  expect(workflow.jobs.verify.needs).toContain('plan');
  expect(workflow.jobs.verify.steps[0].run).toContain('test "$PLAN_RESULT" = success');
  const cache = load(readFileSync('.github/actions/electron-cache/action.yml', 'utf8')) as any;
  const { path, key } = cache.runs.steps[0].with;
  expect(path).toContain('node_modules/.cache/zcc-native-abi');
  expect(path).not.toContain('node_modules/better-sqlite3');
  for (const token of ['runner.os', 'runner.arch', 'node22', 'pnpm-lock.yaml', 'native-binding.mjs']) expect(key).toContain(token);
  for (const job of [workflow.jobs['e2e-build'], workflow.jobs.e2e, workflow.jobs['preview-cross-platform']]) {
    expect(job.steps.some((step: any) => step.uses === './.github/actions/electron-cache')).toBe(true);
  }
  const builder = workflow.jobs['e2e-build'];
  expect(builder.if).toBe(workflow.jobs.e2e.if);
  // Re-run-all replaces the same-run artifact; re-run-failed consumers can
  // still download it when the successful build job was not re-run.
  expect(builder.steps.find((step: any) => step.uses === 'actions/upload-artifact@v7').with.overwrite).toBe(true);
  const archive = builder.steps.find((step: any) => step.name?.startsWith('Archive')).run;
  for (const path of ['out', 'plugins', 'resources', 'packages/cli/dist', 'packages/plugin-sdk/dist', 'apps/host-daemon/dist']) expect(archive).toContain(path);
  expect(archive).toContain("--exclude='plugins/*/node_modules'");
  // The bundled npm runtime needs its nested node_modules (graceful-fs etc.).
  expect(archive).not.toContain("--exclude='*/node_modules'");
  const download = workflow.jobs.e2e.steps.find((step: any) => step.uses === 'actions/download-artifact@v7');
  expect(download.with.name).toBe('electron-e2e-build');
  expect(download.with['run-id']).toBeUndefined(); // Same run and merge commit only.
  expect(workflow.jobs.e2e.steps.find((step: any) => step.env?.CI_E2E_PREBUILT).env.CI_E2E_PREBUILT).toBe('1');
});

it('accepts only planned skips and rejects failed, cancelled or missing required results', () => {
  const workflow = load(readFileSync('.github/workflows/ci.yml', 'utf8')) as any;
  const script = workflow.jobs.verify.steps[0].run;
  const green = { PLAN_RESULT: 'success', UNIT_RESULT: 'success', PACKAGES_RESULT: 'success', COVERAGE_RESULT: 'success',
    BUILD_RESULT: 'success', BOUNDARY_RESULT: 'success', PREVIEW_MATRIX_RESULT: 'success', POSTGRES_RESULT: 'success', E2E_REQUIRED: 'true', PREVIEW_REQUIRED: 'true' };
  const run = (overrides = {}) => spawnSync('bash', ['-e', '-c', script], { env: { ...process.env, ...green, ...overrides } }).status;
  expect(run()).toBe(0);
  expect(run({ E2E_REQUIRED: 'false', PREVIEW_REQUIRED: 'false', BUILD_RESULT: 'skipped', BOUNDARY_RESULT: 'skipped', PREVIEW_MATRIX_RESULT: 'skipped' })).toBe(0);
  for (const key of ['PLAN_RESULT', 'UNIT_RESULT', 'PACKAGES_RESULT', 'COVERAGE_RESULT', 'BUILD_RESULT', 'BOUNDARY_RESULT', 'PREVIEW_MATRIX_RESULT', 'POSTGRES_RESULT']) {
    for (const result of ['failure', 'cancelled', 'skipped', '']) expect(run({ [key]: result }), `${key}=${result}`).not.toBe(0);
  }
  expect(run({ PREVIEW_REQUIRED: '', PREVIEW_MATRIX_RESULT: 'skipped' })).not.toBe(0);
  expect(run({ E2E_REQUIRED: '', BOUNDARY_RESULT: 'skipped' })).not.toBe(0);
});
