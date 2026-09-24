import { describe, expect, it, vi } from 'vitest';
import { beginProjectDrag, PROJECT_DRAG_MIME, projectFromDrag } from './project-drag.js';

describe('project drag payload', () => {
  it('carries identity and a readable fallback, allowing both mention copies and rail moves', () => {
    const setData = vi.fn();
    const transfer = { setData, effectAllowed: 'none' } as unknown as DataTransfer;
    beginProjectDrag(transfer, { id: 'project-1', name: 'My project' });
    expect(setData.mock.calls).toEqual([
      [PROJECT_DRAG_MIME, 'project-1'], ['text/plain', '@My project']
    ]);
    expect(transfer.effectAllowed).toBe('copyMove');
  });

  it('resolves current project data rather than trusting names or paths from a drag', () => {
    const project = { id: 'project-1', name: 'Renamed project', path: '/work/project' };
    const getData = vi.fn(() => project.id);
    expect(projectFromDrag({ getData }, [project])).toBe(project);
    expect(getData).toHaveBeenCalledWith(PROJECT_DRAG_MIME);
  });

  it.each(['', 'deleted-project', '{"id":"project-1","path":"/untrusted"}'])(
    'ignores unknown or malformed identity %j', (id) => {
      expect(projectFromDrag({ getData: () => id }, [{ id: 'project-1' }])).toBeUndefined();
    }
  );
});
