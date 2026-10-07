import { expect, it, vi } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { boundarySpecs, changedLines, codeLines, coverageFailures, runVerification, mergeCoverage } from './ci-verification.mjs';

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

it('runs the private production app suite only for affected paths and fails missing coverage', () => {
  const io = { execute: vi.fn().mockReturnValue('+++ b/apps/app/src/App.tsx\n@@ -1 +1 @@'), read: vi.fn().mockReturnValue('{}'), log: vi.fn(), error: vi.fn() };
  expect(runVerification([], {}, io)).toBe(0);
  expect(io.execute.mock.calls[0][1]).toContain('HEAD^');
  expect(io.execute.mock.calls[0][2]).toMatchObject({ maxBuffer: 32 * 1024 * 1024 });
  expect(io.execute.mock.calls[1][1]).toEqual(expect.arrayContaining(['test:e2e', '--', 'e2e/smoke.spec.ts']));
  expect(runVerification(['--coverage', 'coverage.json'], { CI_BASE_SHA: 'base' }, io)).toBe(1);
  expect(io.read).toHaveBeenCalledWith('coverage.json', 'utf8');
  expect(io.error).toHaveBeenCalledWith(expect.stringContaining('missing coverage'));
  io.execute.mockReturnValue('+++ b/docs/readme.md\n@@ -1 +1 @@'); io.execute.mockClear();
  expect(runVerification([], { CI_BASE_SHA: '0000' }, io)).toBe(0);
  expect(io.execute).toHaveBeenCalledOnce();
  expect(io.log).toHaveBeenCalledWith('No Electron production boundary changed.');
  expect(runVerification(['--coverage', 'coverage.json'], {}, io)).toBe(0);
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

it('keeps the existing required CI check as an always-running gate over both jobs', () => {
  const workflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
  expect(workflow).toContain('name: Typecheck and test');
  expect(workflow).toContain('needs: [unit, e2e]');
  expect(workflow).toContain('if: always()');
  expect(workflow).toContain('test "$UNIT_RESULT" = success');
  expect(workflow).toContain('test "$BOUNDARY_RESULT" = success');
  expect(workflow).not.toContain('continue-on-error: true');
  expect(workflow).toContain('plugins/tasks/vitest.config.ts --coverage');
  expect(workflow).toContain('pnpm --dir plugins/provider-pi exec vitest run --config vitest.config.ts --coverage');
  expect(workflow).toContain('--config vitest.release-coverage.config.ts --coverage');
  expect(workflow).toContain('coverage/tasks/coverage-final.json coverage/pi/coverage-final.json coverage/release/coverage-final.json');
  expect(workflow).toContain("description: 'Optional comparison base for the full unpublished branch range'");
  expect(workflow.match(/CI_BASE_SHA: \$\{\{ inputs\.base_sha \|\| github\.event\.pull_request\.base\.sha \|\| github\.event\.before \|\| 'HEAD\^' \}\}/g)).toHaveLength(2);
});
