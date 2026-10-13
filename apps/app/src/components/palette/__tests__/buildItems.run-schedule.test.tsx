import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Project, ScheduledTask } from '@zana-ai/zcc-domain/product';

const runNow = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/product-client.js', () => ({ product: { scheduler: { runNow: (...a: unknown[]) => runNow(...a) } } }));
vi.mock('../../../modules/ModulePanelHost', () => ({ getHost: (id: string) => ({ moduleId: id, toast: () => {} }) }));
vi.mock('../../../store', () => ({ useUi: { getState: vi.fn(() => ({})) }, visibleTerminals: (l: unknown[] | undefined) => l ?? [] }));
vi.mock('../../thread/pickers/model-refresh.js', () => ({ refreshModelsWithToast: vi.fn() }));

import { buildPaletteItems, type PaletteBuildContext } from '../buildItems.js';

const noop = () => {};
const project = { id: 'p1', name: 'proj', path: '/tmp/p1' } as Project;
const sched = (runs: Array<Record<string, unknown>> = []) => ({
  id: 's1', name: 'Nightly', enabled: true, projectId: 'p1', profile: 'claude', schedule: { every: '1h' },
  status: { runCount: 0, runs }
}) as unknown as ScheduledTask;

function runAction() {
  const pushToast = vi.fn();
  const onClose = vi.fn();
  const ctx = {
    projects: [project], terminals: { p1: [] }, selectedProject: project, selectedProjectTabs: [], activeTab: undefined,
    scheduledTasks: [sched()], personas: [], modules: [], overviewOpen: false,
    whenCtx: { activeNav: 'projects', hasActiveProject: true, hasActiveTab: false, tabCount: 0, activeTabStatus: null,
      activeTabProfile: null, projectView: 'terminals', platform: 'darwin', panelFocused: false, scopedWindow: false },
    onClose, launch: noop, launchPersona: noop, addProject: async () => null, setNav: noop, selectProject: noop, selectTab: noop,
    setProjectView: noop, setSettingsTab: noop, setExtensionsTab: noop, setOverviewOpen: noop, setPinned: noop,
    restartTerminal: async () => null, closeTerminal: async () => null, reopenLastClosed: async () => null,
    restoreLastDetached: async () => null, pushToast
  } as unknown as PaletteBuildContext;
  const item = buildPaletteItems(ctx).find((i) => i.key === 'action:run-schedule:s1')!;
  item.run();
  return { pushToast, onClose };
}

beforeEach(() => runNow.mockReset());

describe('palette run-schedule action', () => {
  it('toasts the transport failure message', async () => {
    runNow.mockResolvedValue({ ok: false, message: 'denied' });
    const { pushToast, onClose } = runAction();
    expect(onClose).toHaveBeenCalled();
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalledWith('denied', 'error'));
  });

  it('falls back to a generic message when none is given', async () => {
    runNow.mockResolvedValue({ ok: false });
    const { pushToast } = runAction();
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalledWith('Failed to run Nightly', 'error'));
  });

  it('toasts the recorded cause when the launch was refused', async () => {
    runNow.mockResolvedValue({ ok: true, value: sched([{ at: 'x', result: 'error', message: 'no capacity' }]) });
    const { pushToast } = runAction();
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalledWith('Run failed: no capacity', 'error'));
  });

  it('stays quiet on success and swallows a rejected call', async () => {
    runNow.mockResolvedValueOnce({ ok: true, value: sched([{ at: 'x', result: 'success' }]) });
    const ok = runAction();
    await new Promise((r) => setTimeout(r, 0));
    expect(ok.pushToast).not.toHaveBeenCalled();
    runNow.mockRejectedValueOnce(new Error('ipc'));
    const bad = runAction();
    await new Promise((r) => setTimeout(r, 0));
    expect(bad.pushToast).not.toHaveBeenCalled();
  });
});
