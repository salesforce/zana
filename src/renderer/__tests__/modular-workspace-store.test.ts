import { afterEach, describe, expect, it, vi } from 'vitest';

const configSet = vi.fn().mockImplementation((patch) => Promise.resolve(patch));

vi.stubGlobal('window', {
  setTimeout,
  clearTimeout,
  cc: {
    config: { set: configSet }
  }
});

const { useUi } = await import('../store');

describe('modular workspace layout state', () => {
  afterEach(() => {
    vi.clearAllMocks();
    useUi.setState({ workspaceMode: {}, workspaceLayout: {} });
  });

  it('stores a bounded second view and persists it with the active project view', async () => {
    useUi.getState().setWorkspaceMode('project-a', 'terminals');
    useUi.getState().setWorkspaceLayout('project-a', {
      secondaryView: 'agents',
      direction: 'horizontal',
      ratio: 0.5
    });

    expect(useUi.getState().workspaceLayout['project-a']).toEqual({
      secondaryView: 'agents',
      direction: 'horizontal',
      ratio: 0.5
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(configSet).toHaveBeenCalledWith(expect.objectContaining({
      workspaceModes: { 'project-a': 'terminals' },
      workspaceLayouts: {
        'project-a': { secondaryView: 'agents', direction: 'horizontal', ratio: 0.5 }
      }
    }));
  });

  it('removes the second block without changing the active view', async () => {
    useUi.setState({
      workspaceMode: { 'project-a': 'explorer' },
      workspaceLayout: {
        'project-a': { secondaryView: 'agents', direction: 'vertical', ratio: 0.5 }
      }
    });

    useUi.getState().clearWorkspaceLayout('project-a');

    expect(useUi.getState().workspaceMode['project-a']).toBe('explorer');
    expect(useUi.getState().workspaceLayout['project-a']).toBeUndefined();
  });
});
