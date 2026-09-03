import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useData } from '../store.js';

/**
 * Switches that own the AppConfig round-trip from a surface outside Settings
 * (sidebar automation + the Agents board Scheduled-column toggle). Unlike the
 * pure-local Settings mirrors, these write AppConfig themselves.
 * These pin that contract: optimistic flip → persist → roll back on failure.
 */

// store setters call window.cc.config.set at RUNTIME (not module load), and the
// test env is node (no jsdom), so provide a minimal window stub per test.
const configSet = vi.fn((_patch: Record<string, unknown>): Promise<unknown> => Promise.resolve({}));
beforeEach(() => {
  configSet.mockReset();
  configSet.mockResolvedValue({});
  (globalThis as { window?: unknown }).window = {
    cc: { config: { set: configSet } }
  };
  useData.setState({
    autoCloseIdleEnabled: false,
    overseerMode: 'off',
    includeScheduledAgentsInAgentView: true
  });
});

describe('useData.setAutoCloseIdleEnabled', () => {
  it('optimistically flips and persists to AppConfig', async () => {
    await useData.getState().setAutoCloseIdleEnabled(true);
    expect(useData.getState().autoCloseIdleEnabled).toBe(true);
    expect(configSet).toHaveBeenCalledWith({ autoCloseIdleEnabled: true });
  });

  it('rolls back the flip when the persist fails', async () => {
    configSet.mockRejectedValueOnce(new Error('boom'));
    await useData.getState().setAutoCloseIdleEnabled(true);
    expect(useData.getState().autoCloseIdleEnabled).toBe(false);
  });
});

describe('useData.setOverseerMode', () => {
  it('flips on → persists mode "on"', async () => {
    await useData.getState().setOverseerMode('on');
    expect(useData.getState().overseerMode).toBe('on');
    expect(configSet).toHaveBeenCalledWith({ overseerMode: 'on' });
  });

  it('flips off → persists mode "off"', async () => {
    useData.setState({ overseerMode: 'on' });
    await useData.getState().setOverseerMode('off');
    expect(useData.getState().overseerMode).toBe('off');
    expect(configSet).toHaveBeenCalledWith({ overseerMode: 'off' });
  });

  it('rolls back to the previous mode when the persist fails', async () => {
    useData.setState({ overseerMode: 'dryRun' });
    configSet.mockRejectedValueOnce(new Error('boom'));
    await useData.getState().setOverseerMode('on');
    expect(useData.getState().overseerMode).toBe('dryRun');
  });
});

describe('useData.setIncludeScheduledAgentsInAgentView', () => {
  it('optimistically flips and persists to AppConfig', async () => {
    await useData.getState().setIncludeScheduledAgentsInAgentView(false);
    expect(useData.getState().includeScheduledAgentsInAgentView).toBe(false);
    expect(configSet).toHaveBeenCalledWith({ includeScheduledAgentsInAgentView: false });
  });

  it('rolls back the flip when the persist fails', async () => {
    configSet.mockRejectedValueOnce(new Error('boom'));
    await useData.getState().setIncludeScheduledAgentsInAgentView(false);
    expect(useData.getState().includeScheduledAgentsInAgentView).toBe(true);
  });
});
