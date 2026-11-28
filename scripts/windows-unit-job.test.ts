import { existsSync, readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { expect, it } from 'vitest';

const LIST_PATH = 'scripts/windows-unit-tests.txt';

function readWorkflow(): any {
  return load(readFileSync('.github/workflows/ci.yml', 'utf8'));
}

function listedFiles(): string[] {
  return readFileSync(LIST_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

it('runs the allow-listed unit tests on a Windows runner after the plan job', () => {
  const job = readWorkflow().jobs['unit-windows'];
  expect(job['runs-on']).toBe('windows-2025');
  expect(job.needs).toBe('plan');
  const run = job.steps.find((step: any) => step.name === 'Windows unit tests (allow-listed files)');
  expect(run.shell).toBe('bash');
  expect(run.run).toContain(LIST_PATH);
  expect(run.run).toContain('vitest run');
});

it('keeps the Windows unit job informational until it is promoted', () => {
  const workflow = readWorkflow();
  expect(workflow.jobs.verify.needs).not.toContain('unit-windows');
  expect(JSON.stringify(workflow.jobs.verify)).not.toContain('UNIT_WINDOWS');
});

it('lists only existing, unique, repo-relative test files', () => {
  const files = listedFiles();
  expect(files.length).toBeGreaterThan(0);
  expect(new Set(files).size).toBe(files.length);
  for (const file of files) {
    expect(file, file).toMatch(/^[\w./-]+\.test\.(ts|tsx|mjs)$/);
    expect(existsSync(file), `${file} must exist`).toBe(true);
  }
});
