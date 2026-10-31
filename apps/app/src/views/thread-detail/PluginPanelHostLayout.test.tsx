// @vitest-environment jsdom

import { useEffect, useLayoutEffect } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const desktop = vi.hoisted(() => ({
  api: null as object | null,
  compact: false
}));
const emptyActions = vi.hoisted(() => [] as never[]);
const pageActions = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('../../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => desktop.compact }));
vi.mock('../../lib/desktop-browser.js', () => ({
  getDesktopBrowserApi: () => desktop.api
}));
vi.mock('../../lib/product-client.js', () => ({
  product: { fs: { walkFiles: async () => [] } }
}));
vi.mock('../../store.js', () => ({
  useData: (selector: (s: { projects: unknown[] }) => unknown) => selector({ projects: [] })
}));
vi.mock('../../plugins/plugin-slots.js', () => ({
  subscribePluginSlots: () => () => undefined,
  listThreadPanelActions: () => pageActions,
  listNewThreadPanelActions: () => emptyActions
}));
vi.mock('../../components/thread/secondary-panel/PanelAgentTab.js', () => ({
  PanelAgentTab: ({ threadId, draft, draftProjectId, projectId, pluginPanel, onCreated, onOpenConversation }: {
    threadId?: string;
    draft?: string;
    draftProjectId?: string;
    projectId?: string;
    pluginPanel?: { pluginId: string; panel: string; view?: string };
    onCreated: (threadId: string) => void;
    onOpenConversation?: (conversation: { id: string; title: string | null; updatedAt: number }) => void;
  }) => (
    threadId
      ? <div data-testid="agent-chat">{threadId}</div>
      : (
        <>
          <button
            type="button"
            data-testid="agent-composer"
            data-binding={`${pluginPanel?.pluginId}/${pluginPanel?.panel}/${pluginPanel?.view ?? '-'}`}
            data-draft={draft ?? ''}
            data-draft-project={draftProjectId ?? ''}
            data-project={projectId ?? ''}
            onClick={() => onCreated('t-new')}
          >Send</button>
          <button type="button" data-testid="agent-reopen-old" onClick={() => onOpenConversation?.({ id: 'old', title: 'Old chat', updatedAt: 1 })}>old</button>
          <button type="button" data-testid="agent-reopen-new" onClick={() => onOpenConversation?.({ id: 't-new', title: null, updatedAt: 1 })}>new</button>
        </>
      )
  )
}));
vi.mock('../../components/thread/secondary-panel/ThreadPluginTab.js', () => ({
  ThreadPluginTab: ({ moduleId, actionId, params, layout, surface, projectId, tabId, page }: {
    moduleId: string;
    actionId?: string;
    params?: unknown;
    layout?: string;
    surface?: string;
    projectId: string | null;
    tabId?: string;
    page?: { pluginId: string; page: string };
  }) => (
    <div
      data-testid="plugin-tool"
      data-tool={`${moduleId}/${actionId}`}
      data-params={JSON.stringify(params ?? null)}
      data-layout={layout ?? ''}
      data-surface={surface ?? ''}
      data-project={projectId ?? ''}
      data-tab={tabId ?? ''}
      data-page={page ? `${page.pluginId}/${page.page}` : ''}
    />
  )
}));
vi.mock('../../lib/app-surface.js', () => ({
  hasDesktopBridge: () => desktop.api !== null,
  getAppSurface: () => 'desktop'
}));

import { pluginPanelOwnerId, PluginPanelHostLayout } from './PluginPanelHostLayout.js';
import { parsePanelAgentTarget, requestPluginPanelAgent } from '../../plugins/plugin-panel-agent.js';
import { requestPluginPanelScope, requestPluginPanelTool, usePluginPagePanel, usePluginPagePanelOpen } from '../../plugins/plugin-page-panel.js';
import { addClosableTab, loadSecondaryPanelState, persistSecondaryPanelState } from '../../components/thread/secondary-panel/threadSecondaryPanelState.js';

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  desktop.compact = false;
  vi.unstubAllGlobals();
  localStorage.clear();
  pageActions.length = 0;
});

const desktopApi = () => ({
  attach: vi.fn(),
  detach: vi.fn(),
  navigate: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  reload: vi.fn(),
  stop: vi.fn(),
  setBounds: vi.fn(),
  setVisible: vi.fn(),
  onState: () => () => undefined,
  onOpenTab: () => () => undefined
});

describe('pluginPanelOwnerId', () => {
  it('namespaces the secondary-panel owner by plugin and path', () => {
    expect(pluginPanelOwnerId('docs', 'panel')).toBe('plugin-panel:docs:panel');
  });
});

const tabLabels = () => screen.getAllByRole('button', { name: /^Close / }).map((row) => row.getAttribute('aria-label'));

describe('PluginPanelHostLayout', () => {
  it('keeps the shared panel available without the native browser', () => {
    desktop.api = null;
    const view = render(
      <PluginPanelHostLayout pluginId="docs" panelPath="panel">
        <div>slot:docs</div>
      </PluginPanelHostLayout>
    );
    expect(view.getByText('slot:docs')).toBeTruthy();
    expect(view.getByTestId('plugin-panel-host-layout')).toBeTruthy();
    fireEvent.click(screen.getByTestId('plugin-panel-secondary-show'));
    expect(screen.getByTestId('thread-new-tab-page')).toBeTruthy();
    expect(screen.queryByTestId('thread-new-tab-browser')).toBeNull();
    fireEvent.click(screen.getByTestId('thread-new-tab-agent'));
    expect(screen.getByTestId('agent-composer')).toBeTruthy();
    view.unmount();
  });

  it('tells the page whether its side panel is showing', () => {
    function Probe() {
      return <output data-testid="panel-open">{String(usePluginPagePanelOpen())}</output>;
    }
    const view = render(
      <PluginPanelHostLayout pluginId="docs" panelPath="panel">
        <Probe />
      </PluginPanelHostLayout>
    );
    expect(screen.getByTestId('panel-open').textContent).toBe('false');
    fireEvent.click(screen.getByTestId('plugin-panel-secondary-show'));
    expect(screen.getByTestId('panel-open').textContent).toBe('true');
    fireEvent.click(screen.getByTestId('thread-secondary-hide'));
    expect(screen.getByTestId('panel-open').textContent).toBe('false');
    view.unmount();
  });

  it('opens a Browser tab from the host launcher when the desktop browser exists', () => {
    desktop.api = {
      attach: vi.fn(),
      detach: vi.fn(),
      navigate: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      stop: vi.fn(),
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      onState: () => () => undefined,
      onOpenTab: () => () => undefined
    };
    const view = render(
      <PluginPanelHostLayout pluginId="docs" panelPath="panel">
        <div>slot:docs</div>
      </PluginPanelHostLayout>
    );
    fireEvent.click(screen.getByTestId('plugin-panel-secondary-show'));
    fireEvent.click(screen.getByTestId('thread-secondary-new-tab'));
    fireEvent.click(screen.getByTestId('thread-new-tab-browser'));
    expect(screen.getByTestId('thread-browser-tab')).toBeTruthy();
    view.unmount();
    desktop.api = null;
  });

  it('opens an agent composer from the launcher and returns to its conversation', () => {
    desktop.api = desktopApi();
    const view = render(
      <PluginPanelHostLayout pluginId="pr-monitor" panelPath="panel">
        <div>slot:pr</div>
      </PluginPanelHostLayout>
    );
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    expect(screen.getByTestId('agent-composer').getAttribute('data-binding')).toBe('pr-monitor/panel/-');
    fireEvent.click(screen.getByTestId('agent-composer'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('t-new');
    fireEvent.click(screen.getByTestId('thread-secondary-hide'));
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('t-new');
    view.unmount();
    desktop.api = null;
  });

  it('binds the agent to the page\'s current view', () => {
    desktop.api = desktopApi();
    const view = render(
      <PluginPanelHostLayout pluginId="pr-monitor" panelPath="panel" subPath="pr/acme/app/12">
        <div>slot:pr</div>
      </PluginPanelHostLayout>
    );
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    expect(screen.getByTestId('agent-composer').getAttribute('data-binding')).toBe('pr-monitor/panel/pr/acme/app/12');
    view.unmount();
    desktop.api = null;
  });

  it('reopens a recent conversation in the composer tab, or focuses the tab that has it', () => {
    desktop.api = desktopApi();
    const view = render(
      <PluginPanelHostLayout pluginId="pr-monitor" panelPath="panel">
        <div>slot:pr</div>
      </PluginPanelHostLayout>
    );
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    fireEvent.click(screen.getByTestId('agent-composer'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('t-new');
    // A second, blank composer tab.
    fireEvent.click(screen.getByTestId('thread-secondary-new-tab'));
    fireEvent.click(screen.getByTestId('thread-new-tab-agent'));
    fireEvent.click(screen.getByTestId('agent-reopen-new'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('t-new');
    expect(tabLabels()).toEqual(['Close Agent', 'Close Agent']);
    // Back on the blank composer, an older conversation takes over that tab.
    fireEvent.click(screen.getAllByTitle('Agent')[1]!);
    fireEvent.click(screen.getByTestId('agent-reopen-old'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('old');
    expect(tabLabels()).toEqual(['Close Agent', 'Close Old chat']);
    view.unmount();
    desktop.api = null;
  });

  it('starts a new agent from the New Tab page', () => {
    desktop.api = desktopApi();
    const view = render(
      <PluginPanelHostLayout pluginId="gus" panelPath="panel">
        <div>slot:gus</div>
      </PluginPanelHostLayout>
    );
    fireEvent.click(screen.getByTestId('plugin-panel-secondary-show'));
    fireEvent.click(screen.getByTestId('thread-secondary-new-tab'));
    fireEvent.click(screen.getByTestId('thread-new-tab-agent'));
    expect(screen.getByTestId('agent-composer')).toBeTruthy();
    view.unmount();
    desktop.api = null;
  });
  it('shows a conversation the page asks for, focusing its tab when already open', () => {
    desktop.api = desktopApi();
    const view = render(
      <PluginPanelHostLayout pluginId="design-docs" panelPath="design-docs" subPath="dd_1">
        <div>slot:docs</div>
      </PluginPanelHostLayout>
    );
    const tabLabels = () => screen.getAllByRole('button', { name: /^Close / }).map((button) => button.getAttribute('aria-label'));
    // Another plugin's request is not this page's.
    expect(requestPluginPanelAgent({ pluginId: 'gus', threadId: 't-1' })).toBe(false);
    expect(screen.queryByTestId('agent-chat')).toBeNull();

    let shown = false;
    act(() => {
      shown = requestPluginPanelAgent({ pluginId: 'design-docs', threadId: 't-1', title: 'Review · Doc' });
    });
    expect(shown).toBe(true);
    expect(screen.getByTestId('agent-chat').textContent).toBe('t-1');
    act(() => {
      requestPluginPanelAgent({ pluginId: 'design-docs', threadId: 't-2' });
    });
    expect(screen.getByTestId('agent-chat').textContent).toBe('t-2');
    act(() => {
      requestPluginPanelAgent({ pluginId: 'design-docs', threadId: 't-1' });
    });
    expect(screen.getByTestId('agent-chat').textContent).toBe('t-1');
    expect(tabLabels()).toEqual(['Close Review · Doc', 'Close Agent']);

    view.unmount();
    // Unmounted, nothing answers.
    expect(requestPluginPanelAgent({ pluginId: 'design-docs', threadId: 't-3' })).toBe(false);
    desktop.api = null;
  });

  it('refuses an empty thread id', () => {
    expect(requestPluginPanelAgent({ pluginId: 'design-docs', threadId: '' })).toBe(false);
  });

  it('prefills one blank composer with the draft a page asks for, then starts its thread on send', () => {
    desktop.api = desktopApi();
    const view = render(
      <PluginPanelHostLayout pluginId="design-docs" panelPath="design-docs" subPath="dd_1">
        <div>slot:docs</div>
      </PluginPanelHostLayout>
    );
    let shown = false;
    act(() => {
      shown = requestPluginPanelAgent({ pluginId: 'design-docs', draft: { prompt: 'Review dd_1', projectId: 'p1' }, title: 'Doc' });
    });
    expect(shown).toBe(true);
    const composer = () => screen.getByTestId('agent-composer');
    expect(composer().getAttribute('data-draft')).toBe('Review dd_1');
    expect(composer().getAttribute('data-draft-project')).toBe('p1');
    // A second request re-seeds the same blank composer instead of stacking tabs.
    act(() => {
      requestPluginPanelAgent({ pluginId: 'design-docs', draft: { prompt: 'Fill the gaps' } });
    });
    expect(composer().getAttribute('data-draft')).toBe('Fill the gaps');
    expect(composer().getAttribute('data-draft-project')).toBe('');
    expect(tabLabels()).toEqual(['Close Agent']);

    fireEvent.click(composer());
    expect(screen.getByTestId('agent-chat').textContent).toBe('t-new');
    // The started conversation keeps its tab; the next draft gets a fresh composer.
    act(() => {
      requestPluginPanelAgent({ pluginId: 'design-docs', draft: { prompt: 'Another' }, title: 'Doc' });
    });
    expect(composer().getAttribute('data-draft')).toBe('Another');
    expect(tabLabels()).toEqual(['Close Agent', 'Close Doc']);
    view.unmount();
    desktop.api = null;
  });

  it('keeps the same launchers and a separate panel per project', () => {
    desktop.api = desktopApi();
    const mount = (scopeId: string) => render(
      <PluginPanelHostLayout pluginId="design-docs" panelPath="design-docs" scopeId={scopeId}>
        <div>slot:docs</div>
      </PluginPanelHostLayout>
    );
    let view = mount('p1');
    expect(screen.getByTestId('plugin-panel-secondary-show')).toBeTruthy();
    expect(screen.getByTestId('plugin-panel-agent-show')).toBeTruthy();
    act(() => {
      requestPluginPanelAgent({ pluginId: 'design-docs', draft: { prompt: 'Review dd_1' }, title: 'Doc' });
    });
    expect(screen.getByTestId('agent-composer').getAttribute('data-binding')).toBe('design-docs/design-docs/-');
    // A page without routes names the view in the draft; it wins over the page route.
    act(() => {
      requestPluginPanelAgent({ pluginId: 'design-docs', draft: { prompt: 'Review dd_2', view: ' dd_2 ' }, title: 'Doc' });
    });
    expect(screen.getByTestId('agent-composer').getAttribute('data-binding')).toBe('design-docs/design-docs/dd_2');
    fireEvent.click(screen.getByTestId('agent-composer'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('t-new');
    view.unmount();
    // Another project's tab starts without that panel.
    view = mount('p2');
    expect(screen.queryByTestId('agent-composer')).toBeNull();
    view.unmount();
    desktop.api = null;
  });

  it('opens the page\'s own tools from the page and from the New Tab page', () => {
    desktop.api = desktopApi();
    pageActions.push(
      { pluginId: 'salesforce', id: 'studio-graph', title: 'Graph view', scopes: ['plugin-page'], pages: ['salesforce'], layout: 'flush' },
      { pluginId: 'salesforce', id: 'studio-test', title: 'Test', scopes: ['plugin-page'] },
      { pluginId: 'salesforce', id: 'thread-only', title: 'Thread tool' },
      { pluginId: 'gus', id: 'gus-tool', title: 'Gus tool', scopes: ['plugin-page'] }
    );
    function Page() {
      return <div data-testid="page-panel">{JSON.stringify(usePluginPagePanel())}</div>;
    }
    const view = render(
      <PluginPanelHostLayout pluginId="salesforce" panelPath="salesforce" scopeId="p1">
        <Page />
      </PluginPanelHostLayout>
    );
    expect(JSON.parse(screen.getByTestId('page-panel').textContent!)).toEqual({ pluginId: 'salesforce', page: 'salesforce' });
    expect(requestPluginPanelTool('salesforce', { actionId: 'thread-only' })).toBe(false);
    expect(requestPluginPanelTool('gus', { actionId: 'gus-tool' })).toBe(false);
    expect(screen.queryByTestId('plugin-tool')).toBeNull();

    let shown = false;
    act(() => {
      shown = requestPluginPanelTool('salesforce', { actionId: 'studio-graph', params: { node: 'n1' } });
    });
    expect(shown).toBe(true);
    const tool = () => screen.getByTestId('plugin-tool');
    expect(tool().dataset).toMatchObject({ tool: 'salesforce/studio-graph', params: '{"node":"n1"}', layout: 'flush', surface: 'plugin-page', project: 'p1' });
    // Asking again focuses the same tab with the new params.
    act(() => {
      requestPluginPanelTool('salesforce', { actionId: 'studio-graph', params: { node: 'n2' } });
    });
    expect(tabLabels()).toEqual(['Close Graph view']);
    expect(tool().dataset.params).toBe('{"node":"n2"}');

    // The New Tab page lists only this page's tools.
    fireEvent.click(screen.getByTestId('thread-secondary-new-tab'));
    expect(screen.getByTestId('thread-new-tab-plugin-salesforce-studio-test')).toBeTruthy();
    expect(screen.queryByTestId('thread-new-tab-plugin-salesforce-thread-only')).toBeNull();
    expect(screen.queryByTestId('thread-new-tab-plugin-gus-gus-tool')).toBeNull();
    fireEvent.click(screen.getByTestId('thread-new-tab-plugin-salesforce-studio-test'));
    expect(tool().dataset.tool).toBe('salesforce/studio-test');
    expect(tabLabels()).toEqual(['Close Graph view', 'Close Test']);

    // Closing the shown tab shows the last one left (this panel has no Info pin to fall back to).
    fireEvent.click(screen.getByRole('button', { name: 'Close Test' }));
    expect(tabLabels()).toEqual(['Close Graph view']);
    expect(tool().dataset.tool).toBe('salesforce/studio-graph');
    expect(tool().dataset.tab).toMatch(/\S/);

    view.unmount();
    expect(requestPluginPanelTool('salesforce', { actionId: 'studio-graph' })).toBe(false);
    desktop.api = null;
  });

  it('keeps a separate saved panel for the page in its own window', () => {
    desktop.api = desktopApi();
    pageActions.push({ pluginId: 'salesforce', id: 'studio-graph', title: 'Graph view', scopes: ['plugin-page'] });
    const mount = (separateWindow: boolean) => render(
      <PluginPanelHostLayout pluginId="salesforce" panelPath="salesforce" scopeId="p1" separateWindow={separateWindow}>
        <div>slot</div>
      </PluginPanelHostLayout>
    );
    let view = mount(false);
    act(() => { requestPluginPanelTool('salesforce', { actionId: 'studio-graph' }); });
    expect(screen.getByTestId('plugin-tool').dataset.tool).toBe('salesforce/studio-graph');
    view.unmount();
    // The detached window starts without the main window's tabs, and what it does stays out of the main window's panel.
    view = mount(true);
    expect(screen.queryByTestId('plugin-tool')).toBeNull();
    act(() => { requestPluginPanelAgent({ pluginId: 'salesforce', threadId: 't-window' }); });
    expect(tabLabels()).toEqual(['Close Agent']);
    view.unmount();
    view = mount(false);
    expect(tabLabels()).toEqual(['Close Graph view']);
    view.unmount();
    desktop.api = null;
  });

  it('passes its page to a stored tool tab so the tab can check it opens here', () => {
    desktop.api = desktopApi();
    const owner = pluginPanelOwnerId('salesforce', 'salesforce@p1');
    persistSecondaryPanelState(owner, addClosableTab(loadSecondaryPanelState(owner), { kind: 'plugin', title: 'Graph', moduleId: 'salesforce', actionId: 'studio-graph', params: null }));
    const view = render(
      <PluginPanelHostLayout pluginId="salesforce" panelPath="salesforce" scopeId="p1">
        <div>slot</div>
      </PluginPanelHostLayout>
    );
    expect(screen.getByTestId('plugin-tool').dataset).toMatchObject({ surface: 'plugin-page', page: 'salesforce/salesforce' });
    view.unmount();
    desktop.api = null;
  });

  it('answers only its own page in split panes', () => {
    desktop.api = desktopApi();
    pageActions.push({ pluginId: 'salesforce', id: 'studio-graph', title: 'Graph view', scopes: ['plugin-page'] });
    const asks: Record<string, () => void> = {};
    function Page({ name }: { name: string }) {
      const sidePanel = usePluginPagePanel() ?? undefined;
      asks[name] = () => {
        requestPluginPanelTool('salesforce', { actionId: 'studio-graph' }, sidePanel);
        requestPluginPanelAgent({ pluginId: 'salesforce', threadId: `t-${name}` }, sidePanel);
      };
      return null;
    }
    const view = render(<>
      <div data-testid="pane-a"><PluginPanelHostLayout pluginId="salesforce" panelPath="salesforce" scopeId="pa"><Page name="a" /></PluginPanelHostLayout></div>
      <div data-testid="pane-b"><PluginPanelHostLayout pluginId="salesforce" panelPath="salesforce" scopeId="pb"><Page name="b" /></PluginPanelHostLayout></div>
    </>);
    act(() => asks.b());
    const paneA = screen.getByTestId('pane-a');
    const paneB = screen.getByTestId('pane-b');
    expect(paneA.querySelector('[data-testid="agent-chat"], [data-testid="plugin-tool"]')).toBeNull();
    expect(paneB.querySelector('[data-testid="agent-chat"]')?.textContent).toBe('t-b');
    expect(within(paneB).getAllByRole('button', { name: /^Close / }).map((button) => button.getAttribute('aria-label'))).toEqual(['Close Graph view', 'Close Agent']);
    view.unmount();
    desktop.api = null;
  });

  it('gives a browserless page a shared panel for tools and agents', () => {
    desktop.api = null;
    function Page() {
      return <div data-testid="page-panel">{String(usePluginPagePanel()?.pluginId)}</div>;
    }
    render(<PluginPanelHostLayout pluginId="salesforce" panelPath="salesforce"><Page /></PluginPanelHostLayout>);
    expect(screen.getByTestId('page-panel').textContent).toBe('salesforce');
    pageActions.push({ pluginId: 'salesforce', id: 'studio-graph', title: 'Graph', scopes: ['plugin-page'] });
    act(() => { expect(requestPluginPanelTool('salesforce', { actionId: 'studio-graph' })).toBe(true); });
    expect(screen.getByTestId('plugin-tool').dataset.tool).toBe('salesforce/studio-graph');
    act(() => { expect(requestPluginPanelAgent({ pluginId: 'salesforce', threadId: 'browserless' })).toBe(true); });
    expect(screen.getByTestId('agent-chat').textContent).toBe('browserless');
  });

  it('maximizes and restores the shared host, and resets maximization on hide', () => {
    desktop.api = null;
    render(<PluginPanelHostLayout pluginId="docs" panelPath="panel"><div>page</div></PluginPanelHostLayout>);
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    const host = screen.getByTestId('plugin-panel-host-layout');
    fireEvent.click(screen.getByTestId('thread-secondary-maximize'));
    expect(host.classList.contains('is-secondary-maximized')).toBe(true);
    fireEvent.click(screen.getByTestId('thread-secondary-maximize'));
    expect(host.classList.contains('is-secondary-maximized')).toBe(false);
    fireEvent.click(screen.getByTestId('thread-secondary-maximize'));
    fireEvent.click(screen.getByTestId('thread-secondary-hide'));
    expect(host.classList.contains('is-secondary-maximized')).toBe(false);
    expect(screen.getByRole('toolbar', { name: 'Side panel' })).toBeTruthy();
  });

  it('shows the New Tab picker after closing the final tab', () => {
    desktop.api = null;
    render(<PluginPanelHostLayout pluginId="docs" panelPath="panel"><div>page</div></PluginPanelHostLayout>);
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    fireEvent.click(screen.getByRole('button', { name: 'Close Agent' }));
    expect(screen.getByTestId('thread-new-tab-page')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close New Tab' }));
    expect(screen.getByTestId('thread-new-tab-page')).toBeTruthy();
  });

  it('uses the shared compact navigation and returns to the page on close', () => {
    desktop.api = null;
    desktop.compact = true;
    render(<PluginPanelHostLayout pluginId="docs" panelPath="panel"><div>page</div></PluginPanelHostLayout>);
    expect(screen.getByTestId('plugin-panel-host-layout').classList.contains('is-compact')).toBe(true);
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    expect(screen.getByTestId('thread-secondary-panel').dataset.mobilePanel).toBe('true');
    expect(screen.getByTestId('agent-composer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(screen.queryByTestId('thread-secondary-panel')).toBeNull();
    expect(screen.getByTestId('plugin-panel-secondary-show')).toBeTruthy();
  });

  it('restores each project when its scope changes in place without copying tabs', () => {
    desktop.api = null;
    const page = (scopeId: string) => <PluginPanelHostLayout pluginId="docs" panelPath="panel" scopeId={scopeId}><div>{scopeId}</div></PluginPanelHostLayout>;
    const view = render(page('p1'));
    act(() => { requestPluginPanelAgent({ pluginId: 'docs', threadId: 'project-one' }); });
    view.rerender(page('p2'));
    expect(screen.queryByTestId('agent-chat')).toBeNull();
    act(() => { requestPluginPanelAgent({ pluginId: 'docs', threadId: 'project-two' }); });
    view.rerender(page('p1'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('project-one');
    view.rerender(page('p2'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('project-two');
  });


  it('switches resource panels without remounting the editor or copying tools and assistant selection', () => {
    pageActions.push({ pluginId: 'salesforce', id: 'studio-graph', title: 'Graph', scopes: ['plugin-page'] });
    const mounted = vi.fn();
    const unmounted = vi.fn();
    let select!: (id: string | null) => void;
    function Editor() {
      const page = usePluginPagePanel()!;
      useEffect(() => { mounted(); return () => { unmounted(); }; }, []);
      select = id => { requestPluginPanelScope('salesforce', id ? { id, view: id } : null, page); };
      return <input aria-label="Script text" defaultValue="unsaved source" />;
    }
    render(<PluginPanelHostLayout pluginId="salesforce" panelPath="salesforce" scopeId="project"><Editor /></PluginPanelHostLayout>);
    act(() => select('agents/a.agent'));
    expect(screen.getByTestId('plugin-panel-host-layout').dataset.panelResource).toBe('agents/a.agent');
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    expect(screen.getByTestId('agent-composer').dataset).toMatchObject({ binding: 'salesforce/salesforce/agents/a.agent', project: 'project' });
    act(() => requestPluginPanelAgent({ pluginId: 'salesforce', threadId: 'thread-a' }));
    fireEvent.click(screen.getByTestId('thread-secondary-maximize'));
    act(() => select('agents/b.agent'));
    expect(screen.queryByTestId('agent-chat')).toBeNull();
    expect(screen.getByTestId('plugin-panel-host-layout').classList.contains('is-secondary-maximized')).toBe(false);
    act(() => requestPluginPanelTool('salesforce', { actionId: 'studio-graph', params: { path: 'agents/b.agent' } }));
    expect(screen.getByTestId('plugin-tool').dataset.project).toBe('project');
    act(() => select('agents/a.agent'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('thread-a');
    expect(screen.getByTestId('plugin-panel-host-layout').classList.contains('is-secondary-maximized')).toBe(true);
    act(() => select('agents/b.agent'));
    expect(screen.getByTestId('plugin-tool').dataset.params).toBe('{"path":"agents/b.agent"}');
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Script text') as HTMLInputElement).value).toBe('unsaved source');
    act(() => select(null));
    expect(screen.getByTestId('plugin-panel-host-layout').dataset.panelResource).toBe('');
    expect(screen.queryByTestId('plugin-tool')).toBeNull();
    expect(screen.getByTestId('plugin-panel-agent-show')).toBeTruthy();
  });

  it('routes commands sent in the same update as a scope switch to the new resource', () => {
    pageActions.push({ pluginId: 'salesforce', id: 'studio-graph', title: 'Graph', scopes: ['plugin-page'] });
    let select!: (id: string) => void;
    let openFor!: (id: string) => void;
    function Editor() {
      const page = usePluginPagePanel()!;
      select = id => { requestPluginPanelScope('salesforce', { id, view: id }, page); };
      openFor = id => {
        select(id);
        expect(requestPluginPanelTool('salesforce', { actionId: 'studio-graph', params: { path: id } }, page)).toBe(true);
        expect(requestPluginPanelAgent({ pluginId: 'salesforce', threadId: `thread-${id}` }, page)).toBe(true);
      };
      return null;
    }
    render(<PluginPanelHostLayout pluginId="salesforce" panelPath="salesforce" scopeId="p"><Editor /></PluginPanelHostLayout>);
    act(() => openFor('a'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('thread-a');
    act(() => openFor('b'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('thread-b');
    act(() => select('a'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('thread-a');
    expect(tabLabels()).toEqual(['Close Graph', 'Close Agent']);
    act(() => select('b'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('thread-b');
    expect(tabLabels()).toEqual(['Close Graph', 'Close Agent']);
  });

  it('restores independent widths and binds id-only resources to their own assistant view', () => {
    for (const [id, widthPx] of [['a', 420], ['b', 600]] as const) {
      const owner = pluginPanelOwnerId('salesforce', JSON.stringify(['salesforce', 'p', id]));
      persistSecondaryPanelState(owner, { ...loadSecondaryPanelState(owner), widthPx });
    }
    let select!: (id: string) => void;
    function Editor() {
      const page = usePluginPagePanel()!;
      select = id => { requestPluginPanelScope('salesforce', { id }, page); };
      return null;
    }
    render(<PluginPanelHostLayout pluginId="salesforce" panelPath="salesforce" scopeId="p"><Editor /></PluginPanelHostLayout>);
    act(() => select('a'));
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    expect(screen.getByTestId('agent-composer').dataset.binding).toBe('salesforce/salesforce/a');
    expect(screen.getByTestId('plugin-panel-host-layout').style.getPropertyValue('--thread-secondary-width')).toBe('560px');
    act(() => select('b'));
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    expect(screen.getByTestId('agent-composer').dataset.binding).toBe('salesforce/salesforce/b');
    expect(screen.getByTestId('plugin-panel-host-layout').style.getPropertyValue('--thread-secondary-width')).toBe('600px');
    act(() => select('a'));
    expect(screen.getByTestId('plugin-panel-host-layout').style.getPropertyValue('--thread-secondary-width')).toBe('560px');
  });

  it('keeps a long generic resource identity without sending an oversized assistant view', () => {
    render(<PluginPanelHostLayout pluginId="salesforce" panelPath="salesforce" scopeId="p" resourceId={'x'.repeat(501)} separateWindow><div /></PluginPanelHostLayout>);
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    expect(screen.getByTestId('agent-composer').dataset.binding).toBe('salesforce/salesforce/-');
  });

  it('receives an initial resource selection from the editor layout effect before host subscription', () => {
    function Editor() {
      const page = usePluginPagePanel()!;
      useLayoutEffect(() => { requestPluginPanelScope('salesforce', { id: 'a', view: 'a' }, page); }, [page]);
      return null;
    }
    render(<PluginPanelHostLayout pluginId="salesforce" panelPath="salesforce" scopeId="p"><Editor /></PluginPanelHostLayout>);
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    expect(screen.getByTestId('agent-composer').dataset.binding).toBe('salesforce/salesforce/a');
  });

  it('restores a resource workspace when moved into its own window and keeps other resources separate', () => {
    const ui = (resourceId: string, separateWindow: boolean) => <PluginPanelHostLayout pluginId="salesforce" panelPath="salesforce" scopeId="project" resourceId={resourceId} separateWindow={separateWindow}><div>editor</div></PluginPanelHostLayout>;
    let view = render(ui('agents/a.agent', false));
    act(() => requestPluginPanelAgent({ pluginId: 'salesforce', threadId: 'thread-a' }));
    view.unmount();
    view = render(ui('agents/a.agent', true));
    expect(screen.getByTestId('agent-chat').textContent).toBe('thread-a');
    view.unmount();
    view = render(ui('agents/b.agent', true));
    expect(screen.queryByTestId('agent-chat')).toBeNull();
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    expect(screen.getByTestId('agent-composer').dataset.binding).toBe('salesforce/salesforce/agents/b.agent');
    view.unmount();
    view = render(ui('agents/a.agent', false));
    expect(screen.getByTestId('agent-chat').textContent).toBe('thread-a');
  });

  it('does not let a different selection retarget the assistant of a dedicated resource window', () => {
    function Editor() {
      const page = usePluginPagePanel()!;
      useEffect(() => { requestPluginPanelScope('salesforce', { id: 'other', view: 'other' }, page); }, [page]);
      return null;
    }
    render(<PluginPanelHostLayout pluginId="salesforce" panelPath="salesforce" scopeId="p" resourceId="locked" separateWindow><Editor /></PluginPanelHostLayout>);
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    expect(screen.getByTestId('agent-composer').dataset.binding).toBe('salesforce/salesforce/locked');
  });
  it('refuses an empty or oversized draft', () => {
    expect(requestPluginPanelAgent({ pluginId: 'design-docs', draft: { prompt: '   ' } })).toBe(false);
    expect(requestPluginPanelAgent({ pluginId: 'design-docs', draft: { prompt: 'x'.repeat(20_001) } })).toBe(false);
    expect(requestPluginPanelAgent({ pluginId: 'design-docs', draft: 'text' })).toBe(false);
  });

  it('keeps a draft but drops a view it cannot record', () => {
    expect(parsePanelAgentTarget({ draft: { prompt: 'p', view: 'v'.repeat(501) } })).toEqual({ draft: 'p' });
    expect(parsePanelAgentTarget({ draft: { prompt: 'p', view: 42 } })).toEqual({ draft: 'p' });
    expect(parsePanelAgentTarget({ draft: { prompt: 'p', view: '  ' } })).toEqual({ draft: 'p' });
    expect(parsePanelAgentTarget({ draft: { prompt: 'p', view: 'dd_1/a.md' } })).toEqual({ draft: 'p', view: 'dd_1/a.md' });
  });
});
