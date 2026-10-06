// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { collectPluginApp } from '@zana-ai/zcc-plugin-sdk';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { renderSlot } from '@zana-ai/zcc-plugin-sdk/testing/app';
import app from '../../../../e2e/fixtures/plugins/platform-hooks-probe/app.tsx';
import server from '../../../../e2e/fixtures/plugins/platform-hooks-probe/server.ts';

const callPluginRpc = vi.hoisted(() => vi.fn());
vi.mock('@zana-ai/zcc-plugin-sdk/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zana-ai/zcc-plugin-sdk/app')>()),
  callPluginRpc
}));

describe('Hooks Probe project menu', () => {
  it('opens the panel only on enable and labels each state correctly', async () => {
    const action = collectPluginApp('platform-hooks-probe', 1, app).projectMenuActions[0]!;
    const toProject = vi.fn();
    callPluginRpc.mockResolvedValueOnce({ enabled: false });
    await expect(action.titleForProject?.('project-1')).resolves.toBe('Enable Hooks Probe');
    callPluginRpc.mockResolvedValueOnce({ enabled: false }).mockResolvedValueOnce({ enabled: true });
    await action.run({ projectId: 'project-1', toProject });
    expect(toProject).toHaveBeenCalledWith('project-1');
    callPluginRpc.mockResolvedValueOnce({ enabled: true });
    await expect(action.titleForProject?.('project-1')).resolves.toBe('Disable Hooks Probe');
    callPluginRpc.mockResolvedValueOnce({ enabled: true }).mockResolvedValueOnce({ enabled: false });
    await action.run({ projectId: 'project-1', toProject });
    expect(toProject).toHaveBeenCalledTimes(1);
  });
});

describe('Hooks Probe dispatch panel', () => {
  it('toasts after applying policy and restores missed dispatches with Refresh', async () => {
    const panel = collectPluginApp('platform-hooks-probe', 1, app).projectTabs[0]!;
    const observed = { dispatchId: 'dispatch-1', generation: 2, decision: { action: 'wait', overrideable: true } };
    let history: typeof observed[] = [];
    const setSelection = vi.fn(async () => ({ ok: true }));
    const view = renderSlot(panel, {}, {
      context: { projectId: 'project-1' },
      rpc: {
        dispatchEventsList: () => history,
        getDispatchSelection: () => ({ kind: 'proceed' }),
        setDispatchSelection: setSelection,
        lifecycleList: () => [],
        markerGet: () => ({ count: 0, history: [] }),
        getToolPolicySelection: () => 'allow',
        toolPolicyEventsList: () => [],
        getEnabled: () => ({ enabled: true })
      }
    });
    try {
      expect(screen.getByText('Observed thread dispatches')).toBeTruthy();
      expect(screen.getByText(/New Chat's first message creates a thread/)).toBeTruthy();
      await waitFor(() => expect(screen.getByText(/No dispatches observed yet/)).toBeTruthy());
      fireEvent.change(screen.getByRole('combobox', { name: 'Dispatch decision' }), { target: { value: 'wait' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(setSelection).toHaveBeenCalledWith({ kind: 'wait', overrideable: true, reason: 'demo wait reason' }));
      expect((await screen.findByRole('status')).textContent).toContain('Dispatch policy applied: wait');
      history = [observed];
      fireEvent.click(screen.getByRole('button', { name: 'Refresh dispatches' }));
      expect(await screen.findByText('dispatch-1')).toBeTruthy();
      await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Dispatches refreshed'));
      view.emitRealtime('hooks-probe-dispatch-event', { dispatchId: 'dispatch-2', generation: 3, decision: { action: 'proceed' } });
      expect(await screen.findByText('dispatch-2')).toBeTruthy();
    } finally {
      view.lifecycle.unmount();
    }
  });

  it('shows error toast when Apply fails without claiming policy changed', async () => {
    const panel = collectPluginApp('platform-hooks-probe', 1, app).projectTabs[0]!;
    const view = renderSlot(panel, {}, {
      context: { projectId: 'project-1' },
      rpc: {
        dispatchEventsList: () => [],
        getDispatchSelection: () => ({ kind: 'proceed' }),
        setDispatchSelection: () => Promise.reject(new Error('server offline')),
        lifecycleList: () => [],
        markerGet: () => ({ count: 0, history: [] }),
        getToolPolicySelection: () => 'allow',
        toolPolicyEventsList: () => [],
        getEnabled: () => ({ enabled: true })
      }
    });
    try {
      await waitFor(() => expect(screen.getByText('Server policy: proceed')).toBeTruthy());
      fireEvent.change(screen.getByRole('combobox', { name: 'Dispatch decision' }), { target: { value: 'wait' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Could not apply dispatch policy: server offline');
      expect(screen.getByText('Server policy: proceed')).toBeTruthy();
    } finally {
      view.lifecycle.unmount();
    }
  });
});

describe('Hooks Probe tool marker', () => {
  it('confirms manual refresh even when marker count is unchanged', async () => {
    const panel = collectPluginApp('platform-hooks-probe', 1, app).projectTabs[0]!;
    const view = renderSlot(panel, {}, {
      context: { projectId: 'project-1' },
      rpc: {
        markerGet: () => ({ count: 0, history: [] }),
        dispatchEventsList: () => [],
        getDispatchSelection: () => ({ kind: 'proceed' }),
        getToolPolicySelection: () => 'allow',
        toolPolicyEventsList: () => [],
        lifecycleList: () => [],
        getEnabled: () => ({ enabled: true })
      }
    });
    try {
      await screen.findByText(/count: 0,/);
      fireEvent.click(screen.getByRole('button', { name: 'Refresh marker' }));
      expect((await screen.findByRole('status')).textContent).toBe('Tool marker refreshed');
      expect(screen.getByText(/count: 0,/)).toBeTruthy();
    } finally {
      view.lifecycle.unmount();
    }
  });

  it('shows error toast when manual marker refresh fails', async () => {
    const panel = collectPluginApp('platform-hooks-probe', 1, app).projectTabs[0]!;
    let fail = false;
    const view = renderSlot(panel, {}, {
      context: { projectId: 'project-1' },
      rpc: {
        markerGet: () => fail ? Promise.reject(new Error('read failed')) : { count: 2, history: [] },
        dispatchEventsList: () => [],
        getDispatchSelection: () => ({ kind: 'proceed' }),
        getToolPolicySelection: () => 'allow',
        toolPolicyEventsList: () => [],
        lifecycleList: () => [],
        getEnabled: () => ({ enabled: true })
      }
    });
    try {
      await screen.findByText(/count: 2,/);
      fail = true;
      fireEvent.click(screen.getByRole('button', { name: 'Refresh marker' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Could not refresh tool marker: read failed');
      expect(screen.getByText(/count: 2,/)).toBeTruthy();
    } finally {
      view.lifecycle.unmount();
    }
  });

  it('confirms policy changes and manual events refresh/clear after RPC success', async () => {
    const panel = collectPluginApp('platform-hooks-probe', 1, app).projectTabs[0]!;
    let finishPolicy!: (value: { ok: boolean }) => void;
    let events = [{ invocationId: 'inv-1', providerId: 'test', toolName: 'marker', state: 'allowed', at: 1 }];
    const view = renderSlot(panel, {}, {
      context: { projectId: 'project-1' },
      rpc: {
        markerGet: () => ({ count: 0, history: [] }),
        dispatchEventsList: () => [],
        getDispatchSelection: () => ({ kind: 'proceed' }),
        getToolPolicySelection: () => 'allow',
        setToolPolicySelection: () => new Promise((resolve) => { finishPolicy = resolve; }),
        toolPolicyEventsList: () => events,
        toolPolicyEventsClear: () => { events = []; return { ok: true }; },
        lifecycleList: () => [],
        getEnabled: () => ({ enabled: true })
      }
    });
    try {
      await screen.findByText('inv-1');
      fireEvent.change(screen.getByRole('combobox', { name: 'Tool policy' }), { target: { value: 'deny' } });
      expect((screen.getByRole('combobox', { name: 'Tool policy' }) as HTMLSelectElement).value).toBe('allow');
      finishPolicy({ ok: true });
      expect((await screen.findByRole('status')).textContent).toBe('Tool policy set to deny');
      fireEvent.click(screen.getByRole('button', { name: 'Refresh events' }));
      await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Tool policy events refreshed'));
      fireEvent.click(screen.getByRole('button', { name: 'Clear events' }));
      await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Tool policy events cleared'));
      await waitFor(() => expect(screen.queryByText('inv-1')).toBeNull());
    } finally {
      view.lifecycle.unmount();
    }
  });

  it('preserves policy when selection save fails and reports failure', async () => {
    const panel = collectPluginApp('platform-hooks-probe', 1, app).projectTabs[0]!;
    const view = renderSlot(panel, {}, {
      context: { projectId: 'project-1' },
      rpc: {
        markerGet: () => ({ count: 0, history: [] }),
        dispatchEventsList: () => [],
        getDispatchSelection: () => ({ kind: 'proceed' }),
        getToolPolicySelection: () => 'allow',
        setToolPolicySelection: () => Promise.reject(new Error('save failed')),
        toolPolicyEventsList: () => [],
        lifecycleList: () => [],
        getEnabled: () => ({ enabled: true })
      }
    });
    try {
      await waitFor(() => expect((screen.getByRole('combobox', { name: 'Tool policy' }) as HTMLSelectElement).value).toBe('allow'));
      fireEvent.change(screen.getByRole('combobox', { name: 'Tool policy' }), { target: { value: 'deny' } });
      expect((await screen.findByRole('alert')).textContent).toContain('Could not set tool policy: save failed');
      expect((screen.getByRole('combobox', { name: 'Tool policy' }) as HTMLSelectElement).value).toBe('allow');
    } finally {
      view.lifecycle.unmount();
    }
  });

  it('confirms lifecycle clear even when no rows remain', async () => {
    const panel = collectPluginApp('platform-hooks-probe', 1, app).projectTabs[0]!;
    const view = renderSlot(panel, {}, {
      context: { projectId: 'project-1' },
      rpc: {
        markerGet: () => ({ count: 0, history: [] }),
        dispatchEventsList: () => [],
        getDispatchSelection: () => ({ kind: 'proceed' }),
        getToolPolicySelection: () => 'allow',
        toolPolicyEventsList: () => [],
        lifecycleList: () => [],
        lifecycleClear: () => ({ ok: true }),
        getEnabled: () => ({ enabled: true })
      }
    });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Clear local projection' }));
      expect((await screen.findByRole('status')).textContent).toBe('Lifecycle projection cleared');
    } finally {
      view.lifecycle.unmount();
    }
  });

  it('confirms clear only after RPC succeeds and refreshes marker count', async () => {
    const panel = collectPluginApp('platform-hooks-probe', 1, app).projectTabs[0]!;
    let finishClear!: (value: { ok: boolean }) => void;
    let count = 1;
    const view = renderSlot(panel, {}, {
      context: { projectId: 'project-1' },
      rpc: {
        markerGet: () => ({ count, history: [] }),
        markerClear: () => new Promise((resolve) => { finishClear = resolve; }),
        dispatchEventsList: () => [],
        getDispatchSelection: () => ({ kind: 'proceed' }),
        getToolPolicySelection: () => 'allow',
        toolPolicyEventsList: () => [],
        lifecycleList: () => [],
        getEnabled: () => ({ enabled: true })
      }
    });
    try {
      await screen.findByText(/count: 1,/);
      fireEvent.click(screen.getByRole('button', { name: 'Clear marker' }));
      expect(screen.queryByText('Tool marker cleared')).toBeNull();
      count = 0;
      finishClear({ ok: true });
      expect((await screen.findByRole('status')).textContent).toBe('Tool marker cleared');
      await screen.findByText(/count: 0,/);
    } finally {
      view.lifecycle.unmount();
    }
  });

  it('shows failure toast without claiming marker was cleared', async () => {
    const panel = collectPluginApp('platform-hooks-probe', 1, app).projectTabs[0]!;
    const view = renderSlot(panel, {}, {
      context: { projectId: 'project-1' },
      rpc: {
        markerGet: () => ({ count: 1, history: [] }),
        markerClear: () => Promise.reject(new Error('write failed')),
        dispatchEventsList: () => [],
        getDispatchSelection: () => ({ kind: 'proceed' }),
        getToolPolicySelection: () => 'allow',
        toolPolicyEventsList: () => [],
        lifecycleList: () => [],
        getEnabled: () => ({ enabled: true })
      }
    });
    try {
      await screen.findByText(/count: 1,/);
      fireEvent.click(screen.getByRole('button', { name: 'Clear marker' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Could not clear tool marker: write failed');
      expect(screen.getByText(/count: 1,/)).toBeTruthy();
    } finally {
      view.lifecycle.unmount();
    }
  });
});

describe('Hooks Probe host RPC', () => {
  it('awaits isolated client creation and cancels an in-flight probe', async () => {
    let rejectCall!: (error: Error) => void;
    const signalReceived = vi.fn();
    const call = vi.fn((_method: string, _input: unknown, options: { signal: AbortSignal }) => {
      options.signal.addEventListener('abort', () => rejectCall(new Error('slowProbe cancelled')));
      signalReceived();
      return new Promise((_resolve, reject) => { rejectCall = reject; });
    });
    const { zcc, harness } = createFakePluginHost({ pluginId: 'platform-hooks-probe' });
    harness.sdk.stub('system.defaultHost', () => ({ id: 'host-1' }));
    zcc.host.experimental_client = (() => Promise.resolve({ call })) as never;
    await server(zcc);
    const pending = harness.callRpc('hostSlowProbe', { probeId: 'p1', delayMs: 3000 });
    await vi.waitFor(() => expect(signalReceived).toHaveBeenCalledOnce());
    await expect(harness.callRpc('hostCancelSlowProbe', { probeId: 'p1' })).resolves.toEqual({ cancelled: true });
    await expect(pending).resolves.toEqual({ cancelled: true });
  });
});
