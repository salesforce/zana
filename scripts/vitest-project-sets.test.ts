import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import config from '../vitest.config';
import { SERIAL_SOURCE_PATTERN, SERIAL_TEST_FILES, serialTestFiles } from '../vitest.serial';

it('keeps serial test files excluded from parallel collection and explicitly included in serial collection', () => {
  const projects = (config.test?.projects ?? []) as Array<{ test?: Record<string, unknown> }>;
  const parallel = projects.find((project) => project.test?.name === 'parallel')?.test;
  const serial = projects.find((project) => project.test?.name === 'serial')?.test;
  const serialFiles = serialTestFiles(process.cwd());

  expect(parallel).toBeDefined();
  expect(serial).toBeDefined();
  expect(serialFiles).toEqual([...new Set(serialFiles)].sort());
  expect(serial?.include).toEqual(serialFiles);
  expect((parallel?.exclude as string[]).slice(-serialFiles.length)).toEqual(serialFiles);
  expect(serial?.fileParallelism).toBe(false);
  expect(serial?.sequence).toEqual({ groupOrder: 1 });
  expect(parallel?.sequence).toEqual({ groupOrder: 0 });
  for (const file of SERIAL_TEST_FILES) expect(serialFiles).toContain(file);
});

it('does not serialize tests for inert git literals or worker imports', () => {
  expect(SERIAL_SOURCE_PATTERN.test("expect(command).toBe('git')")).toBe(false);
  expect(SERIAL_SOURCE_PATTERN.test("import { Worker } from 'node:worker_threads'"))
    .toBe(false);
  expect(SERIAL_TEST_FILES).toEqual(expect.arrayContaining([
    'apps/server/src/services/threads/history-query-worker.test.ts',
    'apps/server/src/services/threads/history-query-worker.failure.test.ts'
  ]));
});

const FLAKY_SERIAL_FILES = [
  'apps/server/src/plugins/isolated-plugin-runtime.test.ts',
  'services/mobile-relay/relay.test.ts',
  'apps/server/src/services/feed/project-feed.test.ts',
  'plugins/design-docs/src/server/pairing.test.ts',
  'plugins/design-docs/src/server/peer-apply-fence.test.ts',
  'plugins/provider-acp/src/bridge/acp-health.test.ts',
  'plugins/provider-acp/src/bridge/bridge.test.ts',
  'packages/host-workspace/src/worktree-start-point.test.ts',
  'apps/server/src/services/execution/__tests__/execution-store.test.ts'
];

it('REQ-4: lists every load-sensitive file from the flaky map as serial', () => {
  expect(SERIAL_TEST_FILES).toEqual(expect.arrayContaining(FLAKY_SERIAL_FILES));
  const serialFiles = serialTestFiles(process.cwd());
  for (const file of FLAKY_SERIAL_FILES) expect(serialFiles).toContain(file);
});

it('REQ-4: every SERIAL_TEST_FILES entry exists on disk', () => {
  for (const file of SERIAL_TEST_FILES) expect(existsSync(`${process.cwd()}/${file}`), file).toBe(true);
});

it('REQ-5: has no duplicates and keeps the files the map left parallel out of the serial split', () => {
  expect(new Set(SERIAL_TEST_FILES).size).toBe(SERIAL_TEST_FILES.length);
  const split = serialTestFiles(process.cwd());
  for (const file of [
    'apps/host-daemon/src/conversation-history.test.ts',
    'apps/server/src/plugins/plugin-service.hard-reload.test.ts',
    'plugins/provider-codex/src/bridge/provider-maintenance.test.ts'
  ]) {
    expect(SERIAL_TEST_FILES).not.toContain(file);
    expect(split).not.toContain(file);
  }
});
