import { beforeEach, describe, expect, it, vi } from 'vitest';
const control = vi.hoisted(() => ({ isAppRunning: vi.fn(() => true), callControlPlane: vi.fn() }));
vi.mock('./control-client.js', () => control);
import { runPluginCommand } from './plugin-commands.js';

beforeEach(() => { vi.clearAllMocks(); control.isAppRunning.mockReturnValue(true); });
describe('manual plugin update commands', () => {
  it('sends update-all to the live product authority with a source-operation timeout', async () => {
    const value = { updated: ['sample'], failed: [] }; control.callControlPlane.mockResolvedValue({ ok: true, value });
    const result = await runPluginCommand('/data', 'update', ['--all'], true);
    expect(control.callControlPlane).toHaveBeenCalledWith({ dataDir: '/data', op: 'plugin.update', args: { all: true }, timeoutMs: 300_000 });
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout!)).toEqual(value);
  });
  it('preserves partial successes while returning nonzero when a source or activation fails', async () => {
    const value = { updated: ['sample'], failed: [{ id: 'other', message: 'source offline' }] };
    control.callControlPlane.mockResolvedValue({ ok: true, value });
    for (const json of [true, false]) {
      const result = await runPluginCommand('/data', 'update', ['--all'], json);
      expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout!)).toEqual(value);
    }
  });
  it('routes individual updates and surfaces host failures', async () => {
    control.callControlPlane.mockResolvedValue({ ok: true, value: { id: 'sample' } });
    expect((await runPluginCommand('/data', 'update', ['sample'], false)).exitCode).toBe(0);
    expect(control.callControlPlane).toHaveBeenCalledWith(expect.objectContaining({ args: { id: 'sample' } }));
    control.callControlPlane.mockResolvedValue({ ok: false, message: 'Host offline' });
    expect((await runPluginCommand('/data', 'update', ['--all'], true)).stderr).toContain('Host offline');
    control.isAppRunning.mockReturnValue(false);
    expect((await runPluginCommand('/data', 'update', ['--all'], true)).stderr).toContain('APP_NOT_RUNNING');
  });
});
