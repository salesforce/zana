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
