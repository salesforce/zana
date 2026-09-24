import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.doUnmock('../lib/control-client.js'); vi.unstubAllEnvs(); vi.resetModules(); });
describe('plugin-owned command options', () => {
  it('keeps core help from dispatching a mutation', async () => {
    const control = vi.fn();
    vi.doMock('../lib/control-client.js', () => ({ isAppRunning: () => true, callControlPlane: control }));
    const { runCli } = await import('../lib/run-cli.js');
    expect((await runCli(['node', 'zcc', 'thread', 'stop', '--help'])).exitCode).toBe(0);
    expect(control).not.toHaveBeenCalled();
  });
  it.each([['--help'], ['list', '--json']])('forwards %j and prints the plugin payload directly', async (...argv) => {
    vi.resetModules();
    const stdout = argv.includes('--json') ? '{"tasks":[]}' : 'Usage: zcc tasks <command>';
    const control = vi.fn(async ({ op }: { op: string }) => op === 'plugin.contributions'
      ? { ok: true, value: [{ pluginId: 'tasks', name: 'tasks' }] }
      : { ok: true, value: { exitCode: 0, stdout, stderr: '' } });
    vi.doMock('../lib/control-client.js', () => ({ isAppRunning: () => true, callControlPlane: control }));
    vi.stubEnv('ZCC_PROJECT_ID', 'registered-project');
    vi.stubEnv('ZCC_THREAD_ID', undefined);
    vi.stubEnv('ZCC_SESSION_ID', 'inherited-cli-session');
    vi.stubEnv('BB_THREAD_ID', 'actual-modern-thread');
    const { runCli } = await import('../lib/run-cli.js');
    const result = await runCli(['node', 'zcc', 'tasks', ...argv], { dataDir: '/tmp/zcc-cli-contract' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(stdout);
    expect(control).toHaveBeenCalledWith(expect.objectContaining({ op: 'plugin.cli', args: expect.objectContaining({ argv, projectId: 'registered-project', threadId: 'actual-modern-thread' }) }));
  });
});
