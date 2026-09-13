import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import plugin from '../server.mjs';
import { createMemorySqlite } from './test-db.js';

async function loadPlugin() {
  const { zcc, harness } = createFakePluginHost({
    pluginId: 'memory',
    database: createMemorySqlite()
  });
  await plugin(zcc);
  return harness;
}

async function cli(argv, context, env) {
  const previous = process.env.ZCC_PROJECT_ID;
  if (env?.ZCC_PROJECT_ID) process.env.ZCC_PROJECT_ID = env.ZCC_PROJECT_ID;
  else delete process.env.ZCC_PROJECT_ID;
  const harness = await loadPlugin();
  try {
    return await harness.runCli(argv, context);
  } finally {
    if (previous === undefined) delete process.env.ZCC_PROJECT_ID;
    else process.env.ZCC_PROJECT_ID = previous;
  }
}

describe('memory CLI', () => {
  it('prints usage for help and unknown commands', async () => {
    expect((await cli(['--help'])).stdout).toContain('zcc memory add');
    expect((await cli(['--help'])).stdout).toContain('zcc memory history');
    const unknown = await cli(['explode']);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain('unknown subcommand');
  });

  it('requires query, id, and project scope inputs', async () => {
    expect((await cli(['search'])).stderr).toContain('search requires a query');
    expect((await cli(['get'])).stderr).toContain('get requires an id');
    expect(
      (
        await cli([
          'add',
          '--scope',
          'project',
          '--name',
          'x',
          '--summary',
          's',
          '--details',
          'd',
          '--reason',
          'r'
        ])
      ).stderr
    ).toContain('--project');
    expect((await cli(['add', '--scope', 'other'])).stderr).toContain('write scope must be project or global');
    expect((await cli(['update'])).stderr).toContain('update requires a memory id');
    expect((await cli(['forget'])).stderr).toContain('forget requires a memory id');
    expect((await cli(['history'])).stderr).toContain('history requires a memory id');
  });

  it('lists an empty catalog on a real sqlite database', async () => {
    const listed = await cli(['catalog']);
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain('No memories.');
    const json = await cli(['catalog', '--json']);
    expect(JSON.parse(json.stdout)).toMatchObject({ ok: true, memories: [] });
  });

  it('saves a global memory and rejects missing gets', async () => {
    const harness = await loadPlugin();
    const added = await harness.runCli([
      'add',
      '--scope',
      'global',
      '--name',
      'pref',
      '--summary',
      'Prefer focused tests',
      '--details',
      'Run the plugin vitest files before claiming done',
      '--reason',
      'verified in this thread',
      '--json'
    ]);
    expect(added.exitCode, added.stderr).toBe(0);
    expect(JSON.parse(added.stdout).memory.name).toBe('pref');
    const missing = await harness.runCli(['get', 'nope']);
    expect(missing.stderr).toContain('was not found');
    expect((await harness.runCli(['history', 'nope'])).stderr).toContain('was not found');
    const searched = await harness.runCli(['search', 'nothing-matches']);
    expect(searched.stdout).toContain('No matches.');
    const emptyUpdate = await harness.runCli([
      'update',
      'mem_x',
      '--expected-version',
      '1',
      '--reason',
      'noop'
    ]);
    expect(emptyUpdate.stderr).toContain('at least one field');
    const got = await harness.runCli(['get', 'pref']);
    expect(got.exitCode, got.stderr).toBe(0);
    expect(got.stdout).toContain('Run the plugin vitest files');
    expect(got.stdout).toContain('Source thread:');
    const listed = await harness.runCli(['catalog']);
    expect(listed.stdout).toContain('pref');
    const searchedText = await harness.runCli(['search', 'focused tests']);
    expect(searchedText.stdout).toContain('pref');
    const historyText = await harness.runCli(['history', JSON.parse(added.stdout).memory.id]);
    expect(historyText.stdout).toMatch(/^v1 create/);
  });
});
