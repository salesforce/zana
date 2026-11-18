// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const layout = vi.hoisted(() => ({ compact: false }));
vi.mock('../../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => layout.compact }));
vi.mock('../../lib/product-client.js', () => ({ product: {} }));
vi.mock('../../store.js', () => ({ useData: vi.fn(), useUi: vi.fn() }));
vi.mock('../../components/thread/secondary-panel/PanelAgentTab.js', () => ({
  PanelAgentTab: ({ projectId, threadId, draftSessionKey, onCreated }: {
    projectId: string; threadId?: string; draftSessionKey: string; onCreated: (id: string) => void;
  }) => <button data-testid="agent" data-project={projectId} data-session={draftSessionKey} onClick={() => onCreated('conversation-1')}>{threadId ?? 'Draft'}</button>
}));

import { ExplorerPanelLayout } from './ExplorerPanelLayout.js';
import { addClosableTab, emptySecondaryPanelState, persistSecondaryPanel } from '../../components/thread/secondary-panel/threadSecondaryPanelState.js';

afterEach(() => { cleanup(); localStorage.clear(); layout.compact = false; });
const ui = (projectId = 'p1') => <ExplorerPanelLayout projectId={projectId}><p>Project files</p></ExplorerPanelLayout>;
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Ask an agent' }));
const hide = () => fireEvent.click(screen.getByTestId('thread-secondary-hide'));

describe('ExplorerPanelLayout', () => {
  it('matches the two-button rail and restores the selected tab through the panel toggle', () => {
    render(ui());
    expect(screen.getAllByRole('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Show right panel' }));
    fireEvent.click(screen.getByTestId('agent'));
    fireEvent.click(screen.getByTestId('thread-secondary-new-tab'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Agent', exact: true })[0]);
    hide();
    fireEvent.click(screen.getByRole('button', { name: 'Show right panel' }));
    expect(screen.getByTestId('agent').textContent).toBe('conversation-1');
    hide(); open();
    expect(screen.getByTestId('agent').textContent).toBe('Draft');
  });

  it('opens a project-scoped agent without needing a browser or a plugin', () => {
    render(ui());
    expect(screen.getByText('Project files')).toBeTruthy();
    expect(screen.queryByTestId('agent')).toBeNull();
    open();
    expect(screen.getByTestId('agent').dataset.project).toBe('p1');
    expect(screen.queryByRole('toolbar', { name: 'Side panel' })).toBeNull();
    expect(screen.queryByTestId('thread-info-pin')).toBeNull();
    fireEvent.click(screen.getByTestId('agent'));
    expect(screen.getByTestId('agent').textContent).toBe('conversation-1');
    expect(screen.getByText('Project files')).toBeTruthy();
  });

  it('reopens the latest tab and retains each tab draft identity through hide and navigation', () => {
    const view = render(ui());
    open();
    const first = screen.getByTestId('agent').dataset.session;
    // The shared panel reuses an unsent draft; a started chat gets a new tab.
    fireEvent.click(screen.getByTestId('agent'));
    fireEvent.click(screen.getByTestId('thread-secondary-new-tab'));
    const second = screen.getByTestId('agent').dataset.session;
    expect(second).not.toBe(first);
    hide(); open();
    expect(screen.getByTestId('agent').dataset.session).toBe(second);
    expect(screen.getAllByRole('button', { name: 'Close Agent', exact: true })).toHaveLength(2);
    view.unmount();
    render(ui());
    expect(screen.getByTestId('agent').dataset.session).toBe(second);
  });

  it('isolates projects and restores their conversations when switching back', () => {
    const view = render(ui()); open();
    fireEvent.click(screen.getByTestId('agent'));
    const first = screen.getByTestId('agent').dataset.session;
    view.rerender(ui('p2'));
    expect(screen.queryByTestId('agent')).toBeNull();
    open();
    expect(screen.getByTestId('agent').dataset.project).toBe('p2');
    expect(screen.getByTestId('agent').dataset.session).not.toBe(first);
    expect(screen.getByTestId('agent').textContent).toBe('Draft');
    view.rerender(ui());
    expect(screen.getByTestId('agent').textContent).toBe('conversation-1');
    expect(screen.getByTestId('agent').dataset.session).toBe(first);
  });

  it('returns to the rail after closing the last agent', async () => {
    render(ui()); open();
    fireEvent.click(screen.getByRole('button', { name: 'Close Agent', exact: true }));
    await waitFor(() => expect(screen.queryByTestId('thread-secondary-panel')).toBeNull());
    open();
    expect(screen.getByTestId('agent').textContent).toBe('Draft');
  });

  it('uses the shared maximize/restore controls and compact presentation', () => {
    layout.compact = true;
    render(ui()); open();
    const host = screen.getByTestId('explorer-panel-layout');
    expect(host.classList.contains('is-compact')).toBe(true);
    expect(host.classList.contains('is-secondary-open')).toBe(true);
    hide();
    expect(host.classList.contains('is-secondary-open')).toBe(false);
  });

  it('maximizes and restores without remounting the Explorer', () => {
    render(ui()); open();
    const files = screen.getByText('Project files');
    const host = screen.getByTestId('explorer-panel-layout');
    expect(host.style.getPropertyValue('--thread-secondary-width')).toBe('600px');
    fireEvent.click(screen.getByTestId('thread-secondary-maximize'));
    expect(host.classList.contains('is-secondary-maximized')).toBe(true);
    fireEvent.click(screen.getByTestId('thread-secondary-maximize'));
    expect(host.classList.contains('is-secondary-maximized')).toBe(false);
    expect(screen.getByText('Project files')).toBe(files);
  });

  it('recovers an inactive selection to the remaining conversation and closes an empty restored panel', () => {
    const owner = 'project-explorer:p1';
    const withAgent = addClosableTab(emptySecondaryPanelState(), { kind: 'agent', title: 'Agent', threadId: 'restored' });
    persistSecondaryPanel(owner, { ...withAgent, activeId: 'info', isOpen: true });
    const view = render(ui());
    expect(screen.getByTestId('agent').textContent).toBe('restored');
    view.unmount();
    persistSecondaryPanel(owner, { ...emptySecondaryPanelState(), isOpen: true });
    render(ui());
    expect(screen.getByRole('button', { name: 'Ask an agent' })).toBeTruthy();
  });
});
