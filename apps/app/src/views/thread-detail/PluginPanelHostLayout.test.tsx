// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const desktop = vi.hoisted(() => ({
  api: null as object | null
}));
const emptyActions = vi.hoisted(() => [] as never[]);

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
  listThreadPanelActions: () => emptyActions,
  listNewThreadPanelActions: () => emptyActions
}));
vi.mock('../../components/thread/secondary-panel/PanelAgentTab.js', () => ({
  PanelAgentTab: ({ threadId, pluginPanel, onCreated }: {
    threadId?: string;
    pluginPanel?: { pluginId: string; panel: string };
    onCreated: (threadId: string) => void;
  }) => (
    threadId
      ? <div data-testid="agent-chat">{threadId}</div>
      : (
        <button
          type="button"
          data-testid="agent-composer"
          data-binding={`${pluginPanel?.pluginId}/${pluginPanel?.panel}`}
          onClick={() => onCreated('t-new')}
        >Send</button>
      )
  )
}));
vi.mock('../../lib/app-surface.js', () => ({
  hasDesktopBridge: () => desktop.api !== null,
  getAppSurface: () => 'desktop'
}));

import { pluginPanelBrowserOwnerId, PluginPanelHostLayout } from './PluginPanelHostLayout.js';

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
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

describe('pluginPanelBrowserOwnerId', () => {
  it('namespaces the secondary-panel owner by plugin and path', () => {
    expect(pluginPanelBrowserOwnerId('docs', 'panel')).toBe('plugin-panel:docs:panel');
  });
});

describe('PluginPanelHostLayout', () => {
  it('renders children without a host panel when the desktop browser is unavailable', () => {
    desktop.api = null;
    const view = render(
      <PluginPanelHostLayout pluginId="docs" panelPath="panel">
        <div>slot:docs</div>
      </PluginPanelHostLayout>
    );
    expect(view.getByText('slot:docs')).toBeTruthy();
    expect(view.queryByTestId('plugin-panel-host-layout')).toBeNull();
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
    expect(screen.getByTestId('agent-composer').getAttribute('data-binding')).toBe('pr-monitor/panel');
    fireEvent.click(screen.getByTestId('agent-composer'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('t-new');
    fireEvent.click(screen.getByTestId('thread-secondary-hide'));
    fireEvent.click(screen.getByTestId('plugin-panel-agent-show'));
    expect(screen.getByTestId('agent-chat').textContent).toBe('t-new');
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
});
