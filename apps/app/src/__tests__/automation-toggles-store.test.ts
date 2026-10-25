import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useData, _resetMinimapSyncForTesting } from '../store.js';

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

// Settings persists these flags before notifying the renderer store.
describe('afcode harness setting mirror', () => {
  it('updates picker availability without writing configuration a second time', () => {
    useData.getState().setHarnessAfcodeEnabled(true);
    expect(useData.getState().harnessAfcodeEnabled).toBe(true);
    useData.getState().setHarnessAfcodeEnabled(false);
    expect(useData.getState().harnessAfcodeEnabled).toBe(false);
    expect(configSet).not.toHaveBeenCalled();
  });
});

describe('useData.updateExplorerMinimap', () => {
  beforeEach(() => {
    const initial = { ...useData.getState().explorerMinimap, enabled: true, width: 'default', side: 'right' };
    _resetMinimapSyncForTesting(initial);
    useData.getState().setExplorerMinimap(initial);
  });

  it('merges the patch into the current prefs and persists only the patch', () => {
    useData.getState().updateExplorerMinimap({ explorerMinimapSide: 'left' });
    expect(useData.getState().explorerMinimap).toMatchObject({ enabled: true, width: 'default', side: 'left' });
    expect(configSet).toHaveBeenCalledWith({ explorerMinimapSide: 'left' });
  });

  it('rolls back to the previous prefs when the persist fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    configSet.mockRejectedValueOnce(new Error('boom'));
    useData.getState().updateExplorerMinimap({ explorerMinimapEnabled: false });
    expect(useData.getState().explorerMinimap.enabled).toBe(false);
    await vi.waitFor(() => expect(useData.getState().explorerMinimap.enabled).toBe(true));
  });

  it('rolls back all fields when a full patch fails to persist', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    configSet.mockRejectedValueOnce(new Error('boom'));
    useData.getState().updateExplorerMinimap({
      explorerMinimapEnabled: false,
      explorerMinimapWidth: 'wide',
      explorerMinimapRenderCharacters: false,
      explorerMinimapVerticalSize: 'fill',
      explorerMinimapSlider: 'always',
      explorerMinimapSide: 'left',
    });
    expect(useData.getState().explorerMinimap).toMatchObject({
      enabled: false,
      width: 'wide',
      renderCharacters: false,
      verticalSize: 'fill',
      slider: 'always',
      side: 'left',
    });
    await vi.waitFor(() => expect(useData.getState().explorerMinimap).toMatchObject({
      enabled: true,
      width: 'default',
      renderCharacters: true,
      verticalSize: 'proportional',
      slider: 'mouseover',
      side: 'right',
    }));
  });

  it('rolls back only fields matching the failed patch without overwriting subsequent changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectFirst!: (err: Error) => void;
    configSet.mockReturnValueOnce(new Promise((_, reject) => { rejectFirst = reject; }));
    configSet.mockResolvedValueOnce(undefined);

    useData.getState().updateExplorerMinimap({ explorerMinimapSide: 'left' });
    expect(useData.getState().explorerMinimap.side).toBe('left');

    useData.getState().updateExplorerMinimap({ explorerMinimapWidth: 'narrow' });
    expect(useData.getState().explorerMinimap.width).toBe('narrow');

    rejectFirst(new Error('persist failed'));
    await vi.waitFor(() => expect(useData.getState().explorerMinimap.side).toBe('right'));

    expect(useData.getState().explorerMinimap.width).toBe('narrow');
  });
  it('does not overwrite newer preferences when an earlier write on the same field rejects late', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectFirst!: (err: Error) => void;
    let resolveSecond!: () => void;
    configSet.mockReturnValueOnce(new Promise((_, reject) => { rejectFirst = reject; }));
    configSet.mockReturnValueOnce(new Promise((resolve) => { resolveSecond = () => resolve({}); }));

    useData.getState().updateExplorerMinimap({ explorerMinimapWidth: 'narrow' });
    expect(useData.getState().explorerMinimap.width).toBe('narrow');

    useData.getState().updateExplorerMinimap({ explorerMinimapWidth: 'wide' });
    expect(useData.getState().explorerMinimap.width).toBe('wide');

    resolveSecond();
    rejectFirst(new Error('first write failed'));

    // Wait microtasks / macrotasks to let promises settle
    await new Promise((r) => setTimeout(r, 50));
    expect(useData.getState().explorerMinimap.width).toBe('wide');
  });
});

describe('useData.setExplorerFileIconTheme', () => {
  it('updates the live mirror used by every file-icon site', () => {
    useData.getState().setExplorerFileIconTheme('none');
    expect(useData.getState().explorerFileIconTheme).toBe('none');
    useData.getState().setExplorerFileIconTheme('seti');
    expect(useData.getState().explorerFileIconTheme).toBe('seti');
  });
});
