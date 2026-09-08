import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import plugin from '../server.mjs';

async function cli(argv: string[], env?: Record<string, string>) {
  const previous = process.env.ZCC_PROJECT_ID;
  if (env?.ZCC_PROJECT_ID) process.env.ZCC_PROJECT_ID = env.ZCC_PROJECT_ID;
  else delete process.env.ZCC_PROJECT_ID;
  const { zcc, harness } = createFakePluginHost({ pluginId: 'memory' });
  await plugin(zcc);
  try {
    return await harness.runCli(argv);
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
    expect((await cli(['add', '--scope', 'project', '--name', 'x', '--summary', 's', '--details', 'd', '--reason', 'r'])).stderr).toContain(
      '--project'
    );
    expect((await cli(['add', '--scope', 'other'])).stderr).toContain('write scope must be project or global');
    expect((await cli(['update'])).stderr).toContain('update requires a memory id');
    expect((await cli(['forget'])).stderr).toContain('forget requires a memory id');
    expect((await cli(['history'])).stderr).toContain('history requires a memory id');
  });

  it('lists an empty catalog on the fake database', async () => {
    const listed = await cli(['catalog']);
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain('No memories.');
    const json = await cli(['catalog', '--json']);
    expect(JSON.parse(json.stdout)).toMatchObject({ ok: true, memories: [] });
  });

  it('saves a global memory on the fake database and rejects missing gets', async () => {
    const added = await cli([
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
    expect(added.exitCode).toBe(0);
    expect(JSON.parse(added.stdout).memory.name).toBe('pref');
    const missing = await cli(['get', 'nope']);
    expect(missing.stderr).toContain('was not found');
    expect((await cli(['history', 'nope'])).stderr).toContain('was not found');
    const searched = await cli(['search', 'nothing-matches']);
    expect(searched.stdout).toContain('No matches.');
  });
});
