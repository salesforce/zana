import { expect, it, vi } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { boundarySpecs, changedLines, codeLines, coverageFailures, runVerification, mergeCoverage } from './ci-verification.mjs';

it('checks recovery through the built app whenever its UI, service or distribution changes', () => {
  for (const path of ['apps/app/src/views/settings/DevelopmentView.tsx', 'apps/server/src/plugins/plugin-recovery-runtime.ts', 'apps/server/src/plugins/plugin-service.ts', 'scripts/plugin-recovery-artifacts.mjs', 'scripts/before-pack-plugins.mjs', '.github/workflows/release.yml']) {
    expect(boundarySpecs([path])).toContain('e2e/development-recovery.spec.ts');
  }
});

it('selects required ownership boundaries, deduplicates specs and leaves docs alone', () => {
  expect(boundarySpecs(['docs/readme.md'])).toEqual([]);
  expect(boundarySpecs(['apps/server/src/services/threads/conversation-history-maintenance.ts', 'plugins/tasks/views/list/data.ts', 'apps/app/src/monacoSetup.ts', 'apps/host-daemon/src/pty.ts', 'apps/desktop/src/desktop-browser-broker.ts', 'services/mobile-relay/server.mjs', 'apps/server/src/services/inbox/inbox-store.ts', 'apps/server/src/services/execution-service.ts', 'scripts/ci-verification.mjs'])).toEqual(expect.arrayContaining([
    'e2e/smoke.spec.ts', 'e2e/thread-history-pruning.spec.ts', 'e2e/tasks-bb-parity.spec.ts', 'e2e/thread-diff-workbench.spec.ts', 'e2e/terminals.spec.ts', 'e2e/desktop-browser-broker.spec.ts', 'e2e/mobile-shell.spec.ts', 'e2e/inbox-read-persistence.spec.ts', 'e2e/job-team-launch-ui.spec.ts', 'e2e/cli-agent-job-team-run.spec.ts', 'e2e/modern-owner-job-team-run.spec.ts'
  ]));
  expect(boundarySpecs(['packages/provider-bridge-protocol/src/bridge-kit/bounded-line-reader.ts'])).toContain('e2e/provider-bridge-framing.spec.ts');
  for (const path of ['apps/desktop/src/control/control-plane.ts', 'packages/cli/src/lib/control-client.ts']) {
    expect(boundarySpecs([path])).toEqual(expect.arrayContaining(['e2e/plugin-authoring-live.spec.ts', 'e2e/job-team-launch-ui.spec.ts', 'e2e/cli-agent-job-team-run.spec.ts', 'e2e/modern-owner-job-team-run.spec.ts']));
  }
  for (const path of ['packages/plugin-build/src/build-plugin-app.ts', 'packages/plugin-build/src/build-plugin-server.ts']) {
    expect(boundarySpecs([path])).toContain('e2e/plugin-authoring-live.spec.ts');
  }
  for (const path of ['packages/plugin-build/src/prepare-plugin-runtime.ts', 'scripts/before-pack-plugins.mjs', 'apps/server/src/plugins/plugin-host-artifact.ts', 'apps/server/src/plugins/plugin-service.ts', 'packages/plugin-build/src/build-plugin-host.ts', 'plugins/provider-claude-code/server.mjs', 'apps/desktop/electron-builder.yml', '.github/workflows/release.yml']) {
    expect(boundarySpecs([path])).toContain('e2e/packaged-provider-startup.spec.ts');
  }
  for (const path of ['apps/app/src/lib/monaco-loader.ts', 'apps/app/src/components/thread/timeline/TimelineRows.tsx', 'apps/app/src/thread-store.ts']) {
    expect(boundarySpecs([path])).toContain('e2e/renderer-resource-budget.spec.ts');
  }
  expect(boundarySpecs(['apps/app/src/App.tsx'])).toEqual([...new Set(boundarySpecs(['apps/app/src/App.tsx']))].sort());
});

it('checks the built peer data boundary when large document transfer or its worker fence changes', () => {
  for (const path of [
    'plugins/design-docs/src/server/sync-store.ts',
    'plugins/design-docs/src/server/peer-protocol.ts',
    'apps/server/src/plugins/isolated-plugin-runtime.ts',
    'apps/server/src/plugins/isolated-plugin-runtime.test.ts',
    'e2e/fixtures/peer-design-docs-worker.ts'
  ]) {
    expect(boundarySpecs([path])).toContain('e2e/peer-data-boundary.spec.ts');
  }
  expect(boundarySpecs(['docs/readme.md'])).not.toContain('e2e/peer-data-boundary.spec.ts');
});

it('selects the Squad proposal specs for proposal, team and composer seams', () => {
  for (const path of [
    'apps/desktop/src/squad-proposals/service.ts',
    'apps/server/src/services/squad-proposals/squad-proposal-mcp-tools.ts',
    'apps/server/src/services/agents/team-store.ts',
    'apps/app/src/components/TeamComposer.tsx',
    'apps/app/src/components/SquadEditor.tsx',
    'apps/server/src/services/agents/register-teams-mcp-tool.ts',
    'apps/app/src/components/InboxDetail.tsx',
    'apps/app/src/components/AgentLauncher.tsx',
    'apps/app/src/components/ExecutionJobDetails.tsx',
    'apps/server/src/services/agents/modern-team-launch-tools.ts',
    'apps/desktop/src/ipc/execution-board.ts',
    'apps/server/src/services/execution/store.ts',
    'apps/server/src/services/execution/projection.ts',
    'apps/desktop/src/squad-worktree-runtime.ts',
    'apps/desktop/src/squad-session-lifecycle.ts',
    'apps/server/src/services/execution/execution-mcp-tool.ts',
    'apps/desktop/src/squad-proposals/notifier.ts'
  ]) {
    expect(boundarySpecs([path])).toEqual(expect.arrayContaining([
      'e2e/squad-proposal-flow.spec.ts', 'e2e/squad-direct-report.spec.ts', 'e2e/job-team-launch-ui.spec.ts'
    ]));
  }
  // The shared source policy selects the proposal and launch specs, not the owner report-back one.
  for (const path of ['apps/server/src/services/execution/source-policy.ts', 'apps/server/src/services/execution/source-registry.ts']) {
    expect(boundarySpecs([path])).toEqual(expect.arrayContaining(['e2e/squad-proposal-flow.spec.ts', 'e2e/job-team-launch-ui.spec.ts']));
    expect(boundarySpecs([path])).not.toContain('e2e/squad-direct-report.spec.ts');
  }
  for (const path of [
    'apps/host-daemon/src/harness/claude/hooks.ts',
    'apps/host-daemon/src/harness/claude/interaction-hooks.ts',
    'apps/server/src/services/followups/api-error-resume.ts',
    'apps/desktop/src/api-error-resume-wiring.ts',
    'apps/desktop/src/ipc/api-error-resume.ts',
    'apps/app/src/components/settings/ApiErrorResumeSection.tsx'
  ]) {
    expect(boundarySpecs([path])).toContain('e2e/api-error-resume.spec.ts');
  }
  for (const path of [
    'apps/server/src/services/execution/worker-api-error-recovery.ts',
    'apps/server/src/services/execution/service.ts',
    'apps/server/src/services/execution/store.ts',
    'apps/server/src/services/execution/projection.ts',
    'apps/desktop/src/squad-worker-restart.ts',
    'apps/desktop/src/worker-api-error-recovery-wiring.ts',
    'apps/desktop/src/api-error-resume-wiring.ts',
    'apps/host-daemon/src/harness/claude/interaction-hooks.ts',
    'apps/app/src/components/ExecutionJobDetails.tsx'
  ]) {
    expect(boundarySpecs([path])).toContain('e2e/job-team-api-error-recovery.spec.ts');
  }
  // Unrelated Squad and launcher files must not pull in the slow proposal specs.
  for (const path of [
    'docs/readme.md',
    'apps/desktop/src/triggered-squad.ts',
    'apps/app/src/components/GlobalAgentLauncher.tsx',
    'apps/app/src/lib/settings-search/entries/squads.ts',
    'apps/desktop/src/inbox-actions/squad-instruct.ts'
  ]) {
    expect(boundarySpecs([path])).not.toContain('e2e/squad-proposal-flow.spec.ts');
  }
});

it('selects the close-with-follow-up spec for the close summary seams', () => {
  for (const path of [
    'apps/server/src/services/followups/close-summary.ts',
    'apps/app/src/lib/close-idle-agents.ts',
    'packages/llm/src/claude-cli-provider.ts',
    'apps/desktop/src/main-claude-binary.ts'
  ]) {
    expect(boundarySpecs([path])).toContain('e2e/close-with-follow-up-needs-you.spec.ts');
  }
  expect(boundarySpecs(['apps/server/src/services/followups/other-service.ts'])).not.toContain('e2e/close-with-follow-up-needs-you.spec.ts');
});

it('selects the project Back, routing and Settings reveal specs for the router and split scope seams', () => {
  for (const path of [
    'apps/app/src/main.tsx',
    'apps/app/src/lib/split-layout/store.ts',
    'apps/app/src/views/thread-detail/SplitThreadArea.tsx',
    'apps/app/src/hooks/useRouteSync.ts',
    'apps/app/src/lib/app-navigate.ts',
    'apps/app/src/components/ProjectScopedNav.tsx'
  ]) {
    expect(boundarySpecs([path])).toEqual(expect.arrayContaining(['e2e/project-back-navigation.spec.ts', 'e2e/app-routing.spec.ts', 'e2e/settings-search.spec.ts']));
  }
  expect(boundarySpecs(['apps/app/src/views/thread-detail/SplitDivider.tsx'])).not.toContain('e2e/project-back-navigation.spec.ts');
});

it('selects squad-direct-report for the owner report-back seams', () => {
  for (const path of [
    'apps/server/src/services/execution/service.ts',
    'apps/server/src/services/mcp/mcp-server.ts',
    'apps/desktop/src/squad-proposals/notifier.ts',
    'apps/desktop/src/squad-proposals/report.ts'
  ]) {
    expect(boundarySpecs([path])).toContain('e2e/squad-direct-report.spec.ts');
  }
  expect(boundarySpecs(['apps/server/src/services/execution/service-helpers.ts'])).not.toContain('e2e/squad-direct-report.spec.ts');
});

it('selects the Squad source retry spec for the picker, registry and composer seams', () => {
  for (const path of [
    'apps/desktop/src/ipc/execution-source-picker.ts',
    'apps/desktop/src/ipc/execution-board.ts',
    'apps/server/src/services/execution/source-registry.ts',
    'apps/desktop/src/team-launch-support.ts',
    'apps/app/src/components/TeamComposer.tsx',
    'apps/app/src/components/team-composer-sources.ts'
  ]) {
    expect(boundarySpecs([path])).toContain('e2e/squad-source-retry.spec.ts');
  }
  expect(boundarySpecs(['docs/readme.md'])).not.toContain('e2e/squad-source-retry.spec.ts');
});

it('selects the scheduler specs for scheduler seams', () => {
  for (const path of ['apps/server/src/services/scheduler/scheduler.ts', 'apps/app/src/components/scheduler/ProblemsPanel.tsx', 'apps/app/src/views/scheduler/SchedulerView.tsx', 'packages/domain/src/schedule-health.ts', 'apps/desktop/src/ipc/scheduler.ts', 'apps/desktop/src/scheduler-resume-run.ts']) {
    expect(boundarySpecs([path])).toEqual(expect.arrayContaining(['e2e/scheduler-self-healing.spec.ts', 'e2e/scheduler-overview.spec.ts', 'e2e/scheduler-detail.spec.ts', 'e2e/scheduler-cron.spec.ts', 'e2e/scheduler-resume-latest-run.spec.ts']));
  }
  expect(boundarySpecs(['apps/app/src/components/inbox/Row.tsx'])).not.toContain('e2e/scheduler-cron.spec.ts');
});

it('runs changed Electron specs themselves and ignores helpers and removed specs', () => {
  expect(boundarySpecs(['e2e/tasks-bb-parity.spec.ts', 'e2e/tasks-bb-parity.spec.ts'])).toEqual([
    'e2e/smoke.spec.ts', 'e2e/tasks-bb-parity.spec.ts'
  ]);
  expect(boundarySpecs(['e2e/fixtures/app.ts', 'e2e/removed-regression.spec.ts'])).toEqual(['e2e/smoke.spec.ts']);
});

it('handles added, replaced, and deletion-only hunks', () => {
  const result = changedLines('+++ b/a.ts\n@@ -1,2 +1,3 @@\n+++ b/b.ts\n@@ -4 +4 @@\n+++ b/c.ts\n@@ -2,2 +1,0 @@');
  expect([...result.get('a.ts')!]).toEqual([1, 2, 3]);
  expect([...result.get('b.ts')!]).toEqual([4]); expect(result.get('c.ts')!.size).toBe(0);
  const deleted = changedLines('diff --git a/plugins/provider-acp/src/bridge/bridge.ts b/plugins/provider-acp/src/bridge/bridge.ts\n--- a/plugins/provider-acp/src/bridge/bridge.ts\n+++ /dev/null\n@@ -1,20 +0,0 @@');
  expect([...deleted.keys()]).toEqual(['plugins/provider-acp/src/bridge/bridge.ts']);
  expect(boundarySpecs([...deleted.keys()])).toContain('e2e/provider-bridge-framing.spec.ts');
  expect(boundarySpecs(['apps/host-daemon/src/harness/opencode/provider.ts'])).toEqual(expect.arrayContaining([
    'e2e/opencode-launch-boundary.spec.ts', 'e2e/job-team-launch-ui.spec.ts', 'e2e/cli-agent-job-team-run.spec.ts', 'e2e/modern-owner-job-team-run.spec.ts'
  ]));
  // The native tool policy seams always rerun the main-owned PTY regression and the probe fixture spec.
  for (const path of [
    'apps/desktop/src/runtime/native-tool-policy.ts', 'apps/server/src/plugins/native-tool-policy.ts', 'apps/host-daemon/src/harness/native-tool-relay.ts',
    'apps/host-daemon/src/harness/claude/hooks.ts', 'apps/host-daemon/src/harness/codex/provider.ts', 'apps/server/src/services/mcp/mcp-server.ts',
    'apps/server/src/utility-entry.ts', 'apps/desktop/src/runtime/runtime-supervisor.ts', 'e2e/fixtures/plugins/platform-hooks-probe/server.ts'
  ]) {
    expect(boundarySpecs([path])).toEqual(expect.arrayContaining(['e2e/native-tool-policy-pty.spec.ts', 'e2e/platform-hooks-probe-fixture.spec.ts']));
  }
});

it('checks only changed executable statements and branch arms with an 80% floor', () => {
  const file = 'scripts/ci-verification.mjs';
  const changes = new Map([[file, new Set([1])], ['docs/readme.md', new Set([1])], ['scripts/ci-verification.test.ts', new Set([1])]]);
  const loc = { start: { line: 1 }, end: { line: 1 } };
  const report = { statementMap: { a: loc, old: { start: { line: 500 }, end: { line: 500 } } }, s: { a: 1, old: 0 }, branchMap: { b: { loc } }, b: { b: [1, 1, 1, 1, 0] } };
  expect(coverageFailures(changes, { [resolve(file)]: report })).toEqual([]);
  report.s.a = 0; report.b.b = [0, 1];
  expect(coverageFailures(changes, { [resolve(file)]: report })).toHaveLength(2);
  expect(coverageFailures(changes, {})).toEqual([`${file}: missing coverage`]);
  expect(coverageFailures(new Map([[file, new Set()]]), {})).toEqual([]);
  expect(coverageFailures(new Map([['packages/domain/src/thread.ts', new Set([1])]]), {})).toEqual([]);
});

it('ignores comment-only lines without losing executable strings, JSX or malformed source', () => {
  expect([...codeLines('fixture.ts', '// comment\nexport const value = `first\n// literal content\nlast`;\n/* end */')!]).toEqual([2, 3, 4]);
  expect([...codeLines('fixture.tsx', 'export const view = <div>text</div>;')!]).toEqual([1]);
  expect(codeLines('fixture.ts', 'export const = ;')).toBeNull();
  const root = mkdtempSync(join(tmpdir(), 'zcc-comment-coverage-'));
  const dir = join(root, 'plugins/fixture'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'source.ts'), 'export function work() {\n// changed comment\nreturn 1;\n}');
  writeFileSync(join(dir, 'vitest.config.ts'), 'export default {};');
  try {
    expect(coverageFailures(new Map([['plugins/fixture/source.ts', new Set([2])], ['plugins/fixture/vitest.config.ts', new Set([1])]]), {}, root)).toEqual([]);
    expect(coverageFailures(new Map([['plugins/fixture/source.ts', new Set([3])]]), {}, root)).toEqual(['plugins/fixture/source.ts: missing coverage']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('leaves compiled plugin bundles and declared runtime assets to their sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'zcc-build-coverage-'));
  const dir = join(root, 'plugins/fixture');
  mkdirSync(join(dir, 'kit'), { recursive: true }); mkdirSync(join(dir, 'scripts'), { recursive: true }); mkdirSync(join(root, 'plugins/broken'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ zcc: { extra: { runtimeAssets: ['page.js', 'kit/', 7] } } }));
  writeFileSync(join(root, 'plugins/broken/package.json'), '{');
  const files = ['app.js', 'server.mjs', 'scripts/build-app.mjs', 'scripts/other.mjs', 'page.js', 'kit/site.js', 'kitchen.js'];
  for (const file of files) writeFileSync(join(dir, file), 'export const value = 1;');
  writeFileSync(join(root, 'plugins/broken/app.js'), 'export const value = 1;');
  writeFileSync(join(root, 'plugins/broken/source.js'), 'export const value = 1;');
  const changes = new Map([...files.map(file => [`plugins/fixture/${file}`, new Set([1])] as const), ['plugins/broken/app.js', new Set([1])], ['plugins/broken/source.js', new Set([1])]]);
  try {
    expect(coverageFailures(changes, {}, root)).toEqual([
      'plugins/fixture/scripts/build-app.mjs: missing coverage',
      'plugins/fixture/scripts/other.mjs: missing coverage',
      'plugins/fixture/kitchen.js: missing coverage',
      'plugins/broken/source.js: missing coverage'
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('runs the private production app suite only for affected paths and fails missing coverage', () => {
  const io = { execute: vi.fn().mockReturnValue('+++ b/apps/app/src/App.tsx\n@@ -1 +1 @@'), read: vi.fn().mockReturnValue('{}'), log: vi.fn(), error: vi.fn() };
  expect(runVerification([], {}, io)).toBe(0);
  expect(io.execute.mock.calls[0][1]).toContain('HEAD^');
  expect(io.execute.mock.calls[0][2]).toMatchObject({ maxBuffer: 32 * 1024 * 1024 });
  expect(io.execute.mock.calls[1][1]).toEqual(expect.arrayContaining(['test:e2e', '--', 'e2e/smoke.spec.ts']));
  io.execute.mockClear();
  expect(runVerification(['--coverage', 'coverage.json'], { CI_BASE_SHA: 'base' }, io)).toBe(1);
  expect(io.execute.mock.calls[0][1]).toEqual(expect.arrayContaining(['base', 'HEAD']));
  io.execute.mockClear();
  expect(runVerification(['--coverage', 'coverage.json'], { CI_BASE_SHA: 'base', CI_HEAD_SHA: 'pr-head' }, io)).toBe(1);
  expect(io.execute.mock.calls[0][1]).toEqual(expect.arrayContaining(['base', 'pr-head']));
  expect(io.read).toHaveBeenCalledWith('coverage.json', 'utf8');
  expect(io.error).toHaveBeenCalledWith(expect.stringContaining('missing coverage'));
  io.execute.mockReturnValue('+++ b/docs/readme.md\n@@ -1 +1 @@'); io.execute.mockClear();
  expect(runVerification([], { CI_BASE_SHA: '0000' }, io)).toBe(0);
  expect(io.execute).toHaveBeenCalledOnce();
  expect(io.log).toHaveBeenCalledWith('No Electron production boundary changed.');
  expect(runVerification(['--coverage', 'coverage.json'], {}, io)).toBe(0);
});

it('forwards a CI shard to the production app suite and rejects a malformed one', () => {
  const io = { execute: vi.fn().mockReturnValue('+++ b/apps/app/src/App.tsx\n@@ -1 +1 @@'), read: vi.fn(), log: vi.fn(), error: vi.fn() };
  expect(runVerification([], { CI_E2E_SHARD: '2/3' }, io)).toBe(0);
  expect(io.execute.mock.calls[1][1]).toEqual(expect.arrayContaining(['e2e/smoke.spec.ts', '--shard=2/3', '--pass-with-no-tests']));
  io.execute.mockClear();
  expect(runVerification([], { CI_E2E_SHARD: '0/3' }, io)).toBe(1);
  expect(io.error).toHaveBeenCalledWith('Invalid CI_E2E_SHARD: 0/3');
  expect(io.execute).toHaveBeenCalledOnce();
});

it('allows type-only files while rejecting uncovered runtime TypeScript', () => {
  const root = mkdtempSync(join(tmpdir(), 'zcc-ci-coverage-'));
  const folder = join(root, 'packages/demo/src'); mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'types.ts'), 'export interface Record { id: string }');
  writeFileSync(join(folder, 'runtime.ts'), 'export const value = 1;');
  try {
    const changes = new Map([['packages/demo/src/types.ts', new Set([1])], ['packages/demo/src/runtime.ts', new Set([1])]]);
    expect(coverageFailures(changes, {}, root)).toEqual(['packages/demo/src/runtime.ts: missing coverage']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('leaves E2E suite launchers to their selected Playwright specs', () => {
  const root = mkdtempSync(join(tmpdir(), 'zcc-ci-e2e-launcher-'));
  const path = 'scripts/run-feature-e2e.mjs';
  try {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, path), 'export const select = [\'e2e/feature.spec.ts\'];');
    expect(coverageFailures(new Map([[path, new Set([1])]]), {}, root)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('excludes Vitest setup and test harnesses while still requiring coverage for product runtime and build scripts', () => {
  const root = mkdtempSync(join(tmpdir(), 'zcc-ci-test-support-'));
  const paths = [
    'plugins/fixture/vitest.setup.ts', 'plugins/fixture/src/app/test-harness.tsx',
    'plugins/fixture/src/bridge/fake-provider-harness.ts', 'plugins/fixture/src/bridge/fake-provider.mjs',
    'plugins/fixture/src/app/runtime.tsx', 'plugins/fixture/scripts/build-app.mjs'
  ];
  try {
    for (const path of paths) {
      mkdirSync(resolve(root, path, '..'), { recursive: true });
      writeFileSync(resolve(root, path), 'export const value = 1;');
    }
    const changes = new Map(paths.map(path => [path, new Set([1])]));
    expect(coverageFailures(changes, {}, root)).toEqual([
      'plugins/fixture/src/app/runtime.tsx: missing coverage',
      'plugins/fixture/scripts/build-app.mjs: missing coverage'
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('combines complementary root and package coverage even when local ids differ', () => {
  const loc = { start: { line: 2 }, end: { line: 2 } };
  const branch = { loc };
  const first = { file: { statementMap: { a: loc }, s: { a: 1 }, branchMap: { b: branch }, b: { b: [1, 0] } } };
  const second = { file: { statementMap: { c: loc }, s: { c: 0 }, branchMap: { d: branch }, b: { d: [0, 1] } } };
  const merged = mergeCoverage([first, second]);
  expect(Object.values(merged.file.s)).toEqual([1]);
  expect(Object.values(merged.file.b)).toEqual([[1, 1]]);
  expect(mergeCoverage([])).toEqual({});
});

it('keeps the existing required CI check as an always-running gate over every job', () => {
  const workflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
  expect(workflow).toContain('name: Typecheck and test');
  expect(workflow).toContain('needs: [unit, unit-packages, coverage, e2e, connect-postgres]');
  expect(workflow).toContain('if: always()');
  expect(workflow).toContain('test "$UNIT_RESULT" = success');
  expect(workflow).toContain('test "$PACKAGES_RESULT" = success');
  expect(workflow).toContain('test "$COVERAGE_RESULT" = success');
  expect(workflow).toContain('test "$BOUNDARY_RESULT" = success');
  expect(workflow).toContain('test "$POSTGRES_RESULT" = success');
  expect(workflow).toContain('ZCC_CONNECT_TEST_DATABASE_URL: postgres://');
  expect(workflow).toContain('vitest run website/connect/postgres.test.ts website/connect/machines.postgres.test.ts');
  expect(workflow).toContain('fail-fast: false');
  expect(workflow).toContain('shard: [1, 2, 3, 4, 5]');
  expect(workflow).toContain('vitest run --shard=${{ matrix.shard }}/5 --coverage');
  expect(workflow).toContain('needs: [unit, unit-packages]');
  expect(workflow).toContain('merge-multiple: true');
  expect(workflow).toContain('coverage/root-1/coverage-final.json coverage/root-2/coverage-final.json coverage/root-3/coverage-final.json coverage/root-4/coverage-final.json coverage/root-5/coverage-final.json');
  expect(workflow).not.toContain('continue-on-error: true');
  expect(workflow).toContain('plugins/tasks/vitest.config.ts --coverage');
  expect(workflow).toContain('pnpm --dir plugins/provider-pi exec vitest run --config vitest.config.ts --coverage');
  expect(workflow).toContain('--config vitest.release-coverage.config.ts --coverage');
  expect(workflow).toContain('coverage/tasks/coverage-final.json coverage/pi/coverage-final.json coverage/release/coverage-final.json');
  expect(workflow).toContain("description: 'Optional comparison base for the full unpublished branch range'");
  expect(workflow.match(/CI_BASE_SHA: \$\{\{ inputs\.base_sha \|\| github\.event\.pull_request\.base\.sha \|\| github\.event\.before \|\| 'HEAD\^' \}\}/g)).toHaveLength(2);
});

it('includes the Squad proposal flow in the job-team E2E runner', async () => {
  vi.resetModules();
  const main = vi.fn(async () => 0);
  vi.doMock('./run-electron-e2e.mjs', () => ({ main }));
  const previousExitCode = process.exitCode;
  try {
    await import('./run-jobteam-e2e.mjs');
    expect(main).toHaveBeenCalledOnce();
    expect(main.mock.calls[0]![0]).toEqual(expect.arrayContaining(['--build', 'e2e/squad-proposal-flow.spec.ts', 'e2e/squad-direct-report.spec.ts']));
  } finally {
    process.exitCode = previousExitCode;
    vi.doUnmock('./run-electron-e2e.mjs');
  }
});
