import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scheduler } = vi.hoisted(() => ({ scheduler: { get: vi.fn(), runNow: vi.fn(), queryRuns: vi.fn(), retryRuns: vi.fn(), dismissRuns: vi.fn() } }));

vi.hoisted(() => { process.env.ZCC_SERVER_URL = 'http://127.0.0.1:9'; });
vi.mock('@zana-ai/zcc-server/services/scheduler/scheduler', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zana-ai/zcc-server/services/scheduler/scheduler')>()),
  SchedulerManager: class { get = scheduler.get; runNow = scheduler.runNow; queryRuns = scheduler.queryRuns; retryRuns = scheduler.retryRuns; dismissRuns = scheduler.dismissRuns; on() {} }
}));
vi.mock('@zana-ai/zcc-host-daemon/pty', () => ({
  PtyManager: class { setMcpBaseUrl() {} setProjectRoots() {} setRulesResolver() {} },
  isClaudeProfile: () => false
}));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: { listProjects: () => [], getConfig: () => ({}), getProjectSettings: () => ({}) },
  scratchWorkspaceRoot: () => '/tmp/scratch-root',
  worktreeRoot: () => '/tmp/zcc-worktrees',
  worktreeTargetDir: () => '/tmp/zcc-worktrees/target'
}));
vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: { on: () => {}, whenReady: () => new Promise(() => {}), getPath: () => '/tmp', setName: () => {}, requestSingleInstanceLock: () => true, quit: () => {} },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  ipcMain: { handle: () => {}, on: () => {} }, dialog: {}, shell: {}, screen: {},
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({}) }, powerMonitor: { on: () => {} }
}));
vi.mock('../updater.js', () => ({ createUpdater: () => ({}) }));
vi.mock('../test-tap.js', () => ({ record: () => {}, recordLog: () => {}, isEnabled: () => false, enable: () => {}, drain: () => ({ entries: [], cursor: 0 }), snapshot: () => ({ entries: [] }), reset: () => {} }));

const { scheduleAgentApi, scheduleControlApi } = await import('../host.js');
const ref = { scheduleId: 's', runId: 'r' };

beforeEach(() => vi.clearAllMocks());

describe('schedule run APIs', () => {
  it('requires Scheduler review before a Team schedule can run', () => {
    scheduler.get.mockReturnValue({ kind: 'team' });
    expect(() => scheduleAgentApi.runNow('team-schedule')).toThrow('Review launch settings in Scheduler before running this Team schedule');
    expect(scheduler.runNow).not.toHaveBeenCalled();

    scheduler.get.mockReturnValue({ kind: 'agent' });
    scheduleAgentApi.runNow('agent-schedule');
    expect(scheduler.runNow).toHaveBeenCalledWith('agent-schedule');
  });

  it('forwards the agent API to the manager', async () => {
    scheduler.queryRuns.mockResolvedValue({ rows: [], total: 0, truncated: false });
    scheduler.retryRuns.mockResolvedValue([]);
    scheduler.dismissRuns.mockResolvedValue(1);
    await scheduleAgentApi.queryRuns({ state: 'all' });
    await scheduleAgentApi.retryRuns([ref]);
    await scheduleAgentApi.dismissRuns([ref]);
    expect(scheduler.queryRuns).toHaveBeenCalledWith({ state: 'all' });
    expect(scheduler.retryRuns).toHaveBeenCalledWith([ref]);
    expect(scheduler.dismissRuns).toHaveBeenCalledWith([ref]);
  });

  it('wraps control results in Result', async () => {
    scheduler.queryRuns.mockResolvedValue({ rows: [], total: 0, truncated: false });
    scheduler.retryRuns.mockResolvedValue([]);
    scheduler.dismissRuns.mockResolvedValue(3);
    expect(await scheduleControlApi.queryScheduleRuns!({})).toEqual({ ok: true, value: { rows: [], total: 0, truncated: false } });
    expect(await scheduleControlApi.retryScheduleRuns!([ref])).toEqual({ ok: true, value: [] });
    expect(await scheduleControlApi.dismissScheduleRuns!([ref])).toEqual({ ok: true, value: 3 });
  });

  it('strips report text from query results on both the agent and control APIs', async () => {
    const result = { rows: [{ scheduleId: 's', run: { id: 'r', report: 'long markdown' } }], total: 1, truncated: false };
    scheduler.queryRuns.mockResolvedValue(structuredClone(result));
    const agent = await scheduleAgentApi.queryRuns({});
    expect(JSON.stringify(agent)).not.toContain('long markdown');
    const control = await scheduleControlApi.queryScheduleRuns!({});
    expect(JSON.stringify(control)).not.toContain('long markdown');
    expect(control).toMatchObject({ ok: true, value: { total: 1 } });
  });

  it('maps manager failures to coded errors', async () => {
    scheduler.queryRuns.mockRejectedValue(new Error('q'));
    scheduler.retryRuns.mockRejectedValue(new Error('r'));
    scheduler.dismissRuns.mockRejectedValue(new Error('d'));
    expect(await scheduleControlApi.queryScheduleRuns!({})).toMatchObject({ ok: false, code: 'QUERY_FAILED' });
    expect(await scheduleControlApi.retryScheduleRuns!([ref])).toMatchObject({ ok: false, code: 'RETRY_FAILED' });
    expect(await scheduleControlApi.dismissScheduleRuns!([ref])).toMatchObject({ ok: false, code: 'DISMISS_FAILED' });
  });
});
