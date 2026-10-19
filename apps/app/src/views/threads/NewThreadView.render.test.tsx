// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const composer = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
const store = vi.hoisted(() => ({ projects: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] }));

vi.mock('@/store', () => ({ useData: (selector: (s: typeof store) => unknown) => selector(store) }));
vi.mock('@/components/AuroraGrid', () => ({ AuroraGrid: () => null }));
vi.mock('@/components/HomeAgentComposer', () => ({
  HomeAgentComposer: (props: Record<string, unknown>) => { composer.props = props; return <div data-testid="composer" />; }
}));
vi.mock('@/plugins/PluginNewThreadActions', () => ({
  PluginNewThreadActions: ({ projectId }: { projectId: string | null }) => <div data-testid="actions">{String(projectId)}</div>
}));

import { NewThreadView } from './NewThreadView.js';

afterEach(() => { cleanup(); composer.props = null; });

function renderAt(url: string, element = <NewThreadView />) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/projects/:projectId/threads/new" element={element} />
        <Route path="/threads/new" element={element} />
      </Routes>
    </MemoryRouter>
  );
}

describe('NewThreadView', () => {
  it('gives the create surface its own draft scope so Home and plugin drafts stay separate', () => {
    renderAt('/threads/new');
    expect(screen.getByTestId('composer')).toBeTruthy();
    expect(composer.props).toMatchObject({ draftScope: 'new-thread', project: undefined });
  });

  it('resolves the project from the route, the query string, or an explicit prop', () => {
    renderAt('/projects/p2/threads/new');
    expect(composer.props?.project).toMatchObject({ id: 'p2' });
    expect(screen.getByTestId('actions').textContent).toBe('p2');
    cleanup();
    renderAt('/threads/new?project=p1');
    expect(composer.props?.project).toMatchObject({ id: 'p1' });
    cleanup();
    renderAt('/threads/new?project=missing');
    expect(composer.props?.project).toBeUndefined();
    expect(screen.getByTestId('actions').textContent).toBe('null');
    cleanup();
    renderAt('/threads/new', <NewThreadView project={{ id: 'explicit' } as never} />);
    expect(composer.props?.project).toMatchObject({ id: 'explicit' });
  });
});
