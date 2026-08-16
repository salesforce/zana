import { afterEach, describe, expect, it, vi } from 'vitest';

const configSet = vi.fn().mockImplementation((patch) => Promise.resolve(patch));
vi.stubGlobal('window', { setTimeout, clearTimeout, cc: { config: { set: configSet } } });

const { useUi } = await import('../store');

describe('project canvas state', () => {
  afterEach(() => {
    vi.clearAllMocks();
    useUi.setState({ projectCanvas: null });
  });

  it('persists explicit project-bound blocks', async () => {
    useUi.getState().setProjectCanvas({
      template: 'columns-2',
      blocks: [
        { id: 'a', projectId: 'project-a', view: 'agents' },
        { id: 'b', projectId: 'project-b', view: 'explorer' }
      ]
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(configSet).toHaveBeenLastCalledWith(expect.objectContaining({
      projectCanvas: {
        template: 'columns-2',
        blocks: [
          { id: 'a', projectId: 'project-a', view: 'agents' },
          { id: 'b', projectId: 'project-b', view: 'explorer' }
        ]
      }
    }));
  });

  it('persists a cleared canvas explicitly', async () => {
    useUi.getState().setProjectCanvas(null);

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(configSet).toHaveBeenLastCalledWith({ projectCanvas: null });
  });
});
