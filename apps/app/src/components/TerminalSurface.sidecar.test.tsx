// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ kind: 'modal' as 'modal' | 'page' | 'monitor' | 'none' }));
vi.mock('../store.js', () => ({
  useData: (pick: (s: unknown) => unknown) => pick({ terminals: { p: [{ id: 'primary', projectId: 'p', profile: 'claude' }, { id: 'shell', projectId: 'p', profile: 'shell' }] } }),
  useUi: (pick: (s: unknown) => unknown) => pick({ nav: 'projects', selectedProjectId: 'p', selectedTabId: {}, splitLayout: {}, splitTabIds: {}, threadPanelTerminal: null,
    agentModal: h.kind === 'modal' ? { sessionId: 'primary', projectId: 'p' } : null,
    agentMonitor: h.kind === 'monitor' ? { sessionId: 'primary', projectId: 'p' } : null })
}));
vi.mock('../lib/split-layout/store.js', () => ({ useSplitWorkspace: (pick: (s: unknown) => unknown) => pick({ layout: null }) }));
vi.mock('../lib/split-layout/agentSessionPortal.js', () => ({
  pickAgentSessionPortalTarget: () => h.kind === 'page' ? { sessionId: 'primary', projectId: 'p' } : null,
  pickProjectTerminalsPortalTarget: () => null, agentSessionAnchorId: () => 'page-anchor', projectTerminalsAnchorId: () => ''
}));
vi.mock('./TerminalView.js', () => ({ TerminalView: ({ session }: { session: { id: string } }) => <div data-session={session.id} /> }));
import { TerminalSurface, AGENT_MODAL_TERMINAL_ANCHOR_ID, AGENT_MONITOR_TERMINAL_ANCHOR_ID, PROJECTS_TERMINAL_ANCHOR_ID } from './TerminalSurface.js';
import { registerTerminalDock } from '../lib/terminal-dock-targets.js';
afterEach(cleanup);
it.each(['modal', 'page', 'monitor', 'none'] as const)('keeps a sidecar live while the %s owns the primary agent', kind => {
  h.kind = kind;
  const primaryDock = document.createElement('div'); const shellDock = document.createElement('div');
  document.body.append(primaryDock, shellDock);
  const releasePrimary = registerTerminalDock('primary', primaryDock); const releaseShell = registerTerminalDock('shell', shellDock);
  try {
    const primaryAnchor = kind === 'modal' ? AGENT_MODAL_TERMINAL_ANCHOR_ID : kind === 'monitor' ? AGENT_MONITOR_TERMINAL_ANCHOR_ID : kind === 'page' ? 'page-anchor' : PROJECTS_TERMINAL_ANCHOR_ID;
    const view = render(<MemoryRouter><div id={primaryAnchor} data-testid="primary-anchor" /><TerminalSurface /></MemoryRouter>);
    expect(shellDock.querySelector('[data-session="shell"]')).toBeTruthy();
    const host = kind === 'none' ? primaryDock : view.getByTestId('primary-anchor');
    expect(host.querySelector('[data-session="primary"]')).toBeTruthy();
    if (kind !== 'none') expect(primaryDock.querySelector('[data-session="primary"]')).toBeNull();
  } finally { releasePrimary(); releaseShell(); primaryDock.remove(); shellDock.remove(); }
});
