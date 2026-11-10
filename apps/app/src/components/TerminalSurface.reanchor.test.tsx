// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  terminals: { p: [{ id: 's0', projectId: 'p', profile: 'shell' }] } as Record<string, unknown[]>,
  ui: {
    nav: 'projects', selectedProjectId: 'p', selectedTabId: { p: 's0' }, splitLayout: {}, splitTabIds: {},
    agentModal: null, agentMonitor: null, threadPanelTerminal: null
  },
  navigate: null as ((to: string) => void) | null,
  // The split workspace keeps the same layout (Terminals pane included) while
  // Settings is shown, so none of the surface's anchor targets change.
  layout: {
    root: { type: 'pane', paneId: 'pane-1', content: { kind: 'project-view', projectId: 'p', mode: 'terminals' } },
    focusedPaneId: 'pane-1'
  }
}));
vi.mock('../store.js', () => ({
  useData: (pick: (s: unknown) => unknown) => pick({ terminals: h.terminals }),
  useUi: (pick: (s: unknown) => unknown) => pick(h.ui)
}));
vi.mock('../lib/split-layout/store.js', () => ({ useSplitWorkspace: (pick: (s: unknown) => unknown) => pick({ layout: h.layout }) }));
vi.mock('./TerminalView.js', () => ({
  TerminalView: ({ session }: { session: { id: string } }) => <div data-session={session.id} />
}));

import { TerminalSurface, projectTerminalsAnchorId } from './TerminalSurface.js';

function CaptureNavigate() {
  const navigate = useNavigate();
  useEffect(() => {
    h.navigate = (to) => { void navigate(to); };
  }, [navigate]);
  return null;
}

// Stand-in for the split workspace: the Terminals pane (and its anchor) only
// exists on the project's terminals route, as in the app.
const tree = () => (
  <MemoryRouter initialEntries={['/projects/p/terminals']}>
    <CaptureNavigate />
    <Routes>
      <Route path="/projects/:projectId/terminals" element={<div key="terminals" id={projectTerminalsAnchorId('pane-1')} data-testid="anchor" />} />
      <Route path="/projects/:projectId/settings" element={<section key="settings" data-testid="settings" />} />
    </Routes>
    <TerminalSurface />
  </MemoryRouter>
);

afterEach(() => {
  cleanup();
  h.navigate = null;
});

it('re-parents the live terminals into the fresh Terminals anchor after a round trip through Settings', async () => {
  const view = render(tree());
  const sessionIn = (el: Element | null) => !!el?.querySelector('[data-session="s0"]');
  expect(sessionIn(view.getByTestId('anchor'))).toBe(true);

  await act(async () => h.navigate!('/projects/p/settings'));
  expect(view.queryByTestId('anchor')).toBeNull();

  await act(async () => h.navigate!('/projects/p/terminals'));
  const fresh = view.getByTestId('anchor');
  expect(sessionIn(fresh)).toBe(true);
  expect(fresh.isConnected).toBe(true);
});
