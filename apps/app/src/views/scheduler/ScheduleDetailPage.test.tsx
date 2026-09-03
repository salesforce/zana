/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';

const tasks: ScheduledTask[] = [];
let loading = false;

const h = vi.hoisted(() => ({
  panel: {
    isOpen: true,
    isMaximized: false,
    widthPx: 352,
    activeId: 'info',
    tabs: [] as Array<{
      id: string;
      kind: string;
      title: string;
      path?: string;
      moduleId?: string;
      automationTargetId?: string | null;
    }>,
    version: 1 as const
  },
  pane: null as null | {
    isSplitPane: boolean;
    isFocused: boolean;
    isMaximized: boolean;
    secondaryPanelHost?: unknown;
    onToggleMaximize?: () => void;
    onRequestClose?: () => void;
  },
  navigate: vi.fn(),
  locationState: null as unknown,
  deleteResult: { ok: true, message: undefined as string | undefined },
  pushToast: vi.fn(),
  panelApi: {
    open: vi.fn(),
    close: vi.fn(),
    selectPin: vi.fn(),
    openNewTab: vi.fn(),
    closeTab: vi.fn(),
    activateTab: vi.fn(),
    toggleMaximized: vi.fn(),
    setWidth: vi.fn(),
    addTab: vi.fn(),
    patchTab: vi.fn()
  },
  hostedRegistration: null as null | {
    onToggle: () => void;
  }
}));

vi.mock('../../store.js', () => ({
  useScheduler: (selector: (s: { tasks: ScheduledTask[]; loading: boolean }) => unknown) =>
    selector({ tasks, loading }),
  useUi: { getState: () => ({ pushToast: h.pushToast }) }
}));

vi.mock('../../lib/product-client.js', () => ({
  product: {
    scheduler: {
      delete: () => Promise.resolve(h.deleteResult)
    }
  }
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/schedules/sched-1', state: h.locationState }),
  useNavigate: () => h.navigate
}));

vi.mock('../thread-detail/PaneContext.js', () => ({
  useOptionalPaneContext: () => h.pane,
  usePaneSecondaryPanelRegistration: (value: { onToggle: () => void } | null) => {
    h.hostedRegistration = value;
  }
}));

vi.mock('../../components/thread/secondary-panel/useThreadSecondaryPanel.js', () => ({
  useSecondaryPanel: () => ({
    state: h.panel,
    ...h.panelApi
  })
}));

vi.mock('../../lib/desktop-browser.js', () => ({
  getDesktopBrowserApi: () => ({
    stopAutomation: vi.fn(),
    onOpenTab: () => () => undefined
  })
}));

vi.mock('../../components/thread/secondary-panel/useInAppBrowserPanel.js', () => ({
  useInAppBrowserPanel: () => undefined
}));

vi.mock('../../components/scheduler/ScheduleEditor.js', () => ({
  ScheduleEditor: ({ onSaved }: { onSaved?: (id: string) => void }) => (
    <div data-testid="schedule-editor">
      <button type="button" onClick={() => onSaved?.('created-1')}>
        Saved
      </button>
    </div>
  )
}));

vi.mock('../../components/scheduler/ScheduleInfoPanel.js', () => ({
  ScheduleInfoPanel: ({
    onDuplicate,
    onAskDelete
  }: {
    onDuplicate?: () => void;
    onAskDelete?: () => void;
  }) => (
    <div data-testid="schedule-info-panel">
      {onDuplicate ? (
        <button type="button" onClick={onDuplicate}>
          Duplicate
        </button>
      ) : null}
      {onAskDelete ? (
        <button type="button" onClick={onAskDelete}>
          Delete
        </button>
      ) : null}
    </div>
  )
}));

vi.mock('../../components/scheduler/DeleteConfirmModal.js', () => ({
  DeleteConfirmModal: ({
    onConfirm,
    onCancel
  }: {
    onConfirm: () => void;
    onCancel: () => void;
  }) => (
    <div data-testid="delete-confirm">
      <button type="button" onClick={() => void onConfirm()}>
        Confirm delete
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}));

vi.mock('../../components/thread/secondary-panel/ThreadSecondaryPanel.js', () => ({
  ThreadSecondaryPanel: ({
    children,
    onSelectInfo,
    onSelectDiff,
    onNewTab,
    onCloseTab,
    onActivateTab,
    onToggleMaximized,
    onHide,
    onResize
  }: {
    children?: ReactNode;
    onSelectInfo: () => void;
    onSelectDiff: () => void;
    onNewTab: () => void;
    onCloseTab: (id: string) => void;
    onActivateTab: (id: string) => void;
    onToggleMaximized: () => void;
    onHide: () => void;
    onResize: (n: number) => void;
  }) => {
    onSelectInfo();
    onSelectDiff();
    onNewTab();
    onCloseTab('x');
    onActivateTab('x');
    onToggleMaximized();
    onHide();
    onResize(400);
    return <aside>{children}</aside>;
  }
}));

vi.mock('../../components/thread/secondary-panel/BrowserTabDeck.js', () => ({
  BrowserTabDeck: ({
    onUpdate,
    onStopAutomation
  }: {
    onUpdate: (args: { tabId: string; url: string; title?: string }) => void;
    onStopAutomation: (id: string) => void;
  }) => {
    onUpdate({ tabId: 'tab-6', url: 'https://example.com', title: '' });
    onUpdate({ tabId: 'tab-6', url: 'https://example.com', title: 'Example' });
    onStopAutomation('auto-1');
    return <div data-testid="browser-deck" />;
  }
}));

vi.mock('../../components/thread/secondary-panel/ThreadNewTabPage.js', () => ({
  ThreadNewTabPage: ({
    onOpenFile,
    onOpenBrowser,
    onOpenExplorer,
    onOpenPlugin
  }: {
    onOpenFile: (path: string, title: string) => void;
    onOpenBrowser: () => void;
    onOpenExplorer: () => void;
    onOpenPlugin: (moduleId: string, title: string) => void;
  }) => {
    onOpenFile('/tmp/a.md', 'a.md');
    onOpenBrowser();
    onOpenExplorer();
    onOpenPlugin('docs', 'Docs');
    return <div data-testid="new-tab-page" />;
  }
}));

vi.mock('../../components/thread/secondary-panel/ThreadFilePreviewTab.js', () => ({
  ThreadFilePreviewTab: ({ storage }: { storage?: boolean }) => (
    <div data-testid={storage ? 'storage-preview' : 'file-preview'} />
  )
}));

vi.mock('../../components/thread/secondary-panel/ThreadPluginTab.js', () => ({
  ThreadPluginTab: ({ threadId }: { threadId?: string }) => (
    <div data-testid="plugin-tab" data-thread-id={threadId ?? ''} />
  )
}));

vi.mock('../../components/thread/secondary-panel/ThreadExplorerTab.js', () => ({
  ThreadExplorerTab: () => <div data-testid="explorer-tab" />
}));

import { ScheduleDetailPage } from './ScheduleDetailPage.js';

const sample = {
  id: 'sched-1',
  name: 'Morning digest',
  enabled: true,
  projectId: 'p1',
  profile: 'claude',
  schedule: { every: '1h' },
  overlap: 'skip',
  history: { retain: 10 },
  status: { runCount: 0, runs: [] },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
} as ScheduledTask;

describe('ScheduleDetailPage', () => {
  afterEach(() => {
    cleanup();
    tasks.length = 0;
    loading = false;
    h.panel.isOpen = true;
    h.panel.isMaximized = false;
    h.panel.activeId = 'info';
    h.panel.tabs = [];
    h.pane = null;
    h.locationState = null;
    h.deleteResult = { ok: true, message: undefined };
    h.hostedRegistration = null;
    h.navigate.mockReset();
    h.pushToast.mockReset();
    for (const fn of Object.values(h.panelApi)) fn.mockReset();
  });

  it('shows an empty state when the schedule is gone', () => {
    const html = renderToStaticMarkup(
      <ScheduleDetailPage projectId={null} scheduleId="missing" />
    );
    expect(html).toContain('data-testid="schedule-missing"');
    expect(html).toContain('This schedule is no longer available.');
    expect(html).not.toContain('data-testid="schedule-detail"');
  });

  it('renders the editor workbench when the schedule exists', () => {
    tasks.push(sample);
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    expect(screen.getByTestId('schedule-detail')).toBeTruthy();
    expect(screen.getByTestId('schedule-editor')).toBeTruthy();
    expect(screen.getByTestId('schedule-info-panel')).toBeTruthy();
    expect(screen.getByText('Morning digest')).toBeTruthy();
  });

  it('renders the create page when no schedule id is routed', () => {
    render(<ScheduleDetailPage projectId={null} scheduleId={null} />);
    expect(screen.getByTestId('schedule-detail')).toBeTruthy();
    expect(screen.getByText('New schedule')).toBeTruthy();
  });

  it('titles a template-seeded create page', () => {
    h.locationState = { seed: { kind: 'template', template: { name: 'Standup' } } };
    render(<ScheduleDetailPage projectId={null} scheduleId={null} />);
    expect(screen.getByText('New schedule · Standup')).toBeTruthy();
  });

  it('duplicates into the new-schedule route', () => {
    tasks.push(sample);
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(h.navigate).toHaveBeenCalledWith('/schedules/new', {
      state: { seed: { kind: 'duplicate', source: sample } }
    });
  });

  it('deletes the schedule and returns to the catalogue', async () => {
    tasks.push(sample);
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByTestId('delete-confirm')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/scheduler'));
  });

  it('toasts when delete fails', async () => {
    h.deleteResult = { ok: false, message: 'in use' };
    tasks.push(sample);
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await vi.waitFor(() =>
      expect(h.pushToast).toHaveBeenCalledWith('Delete failed: in use', 'error')
    );
  });

  it('replaces the URL after the first save on the create page', () => {
    render(<ScheduleDetailPage projectId={null} scheduleId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
    expect(h.navigate).toHaveBeenCalledWith('/schedules/created-1', { replace: true });
  });

  it('reopens the secondary panel from the header', () => {
    tasks.push(sample);
    h.panel.isOpen = false;
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    fireEvent.click(screen.getByTestId('thread-secondary-show'));
    expect(h.panelApi.open).toHaveBeenCalled();
  });

  it('registers a hosted secondary panel and toggles it', () => {
    tasks.push(sample);
    h.pane = {
      isSplitPane: true,
      isFocused: true,
      isMaximized: false,
      secondaryPanelHost: true
    };
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    expect(h.hostedRegistration).not.toBeNull();
    h.hostedRegistration?.onToggle();
    expect(h.panelApi.close).toHaveBeenCalled();
    h.panel.isOpen = false;
    h.hostedRegistration?.onToggle();
    expect(h.panelApi.open).toHaveBeenCalled();
  });

  it('shows split-pane chrome and closable tab bodies', () => {
    tasks.push(sample);
    const onToggleMaximize = vi.fn();
    const onRequestClose = vi.fn();
    h.pane = {
      isSplitPane: true,
      isFocused: true,
      isMaximized: false,
      onToggleMaximize,
      onRequestClose
    };
    h.panel.activeId = 'tab-1';
    h.panel.tabs = [{ id: 'tab-1', kind: 'new-tab', title: 'New' }];
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    fireEvent.click(screen.getByTestId('split-pane-maximize'));
    expect(onToggleMaximize).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('split-pane-close'));
    expect(onRequestClose).toHaveBeenCalled();
    expect(screen.getByTestId('new-tab-page')).toBeTruthy();

    cleanup();
    h.panel.activeId = 'tab-2';
    h.panel.tabs = [{ id: 'tab-2', kind: 'file-preview', title: 'File', path: '/tmp/a.md' }];
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    expect(screen.getByTestId('file-preview')).toBeTruthy();

    cleanup();
    h.panel.activeId = 'tab-3';
    h.panel.tabs = [{ id: 'tab-3', kind: 'storage-preview', title: 'Store', path: 's3://x' }];
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    expect(screen.getByTestId('storage-preview')).toBeTruthy();

    cleanup();
    h.panel.activeId = 'tab-4';
    h.panel.tabs = [{ id: 'tab-4', kind: 'plugin', title: 'Plugin', moduleId: 'docs' }];
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    expect(screen.getByTestId('plugin-tab')).toBeTruthy();
    expect(screen.getByTestId('plugin-tab').getAttribute('data-thread-id')).toBe('sched-1');

    cleanup();
    h.panel.activeId = 'tab-5';
    h.panel.tabs = [{ id: 'tab-5', kind: 'explorer', title: 'Explorer' }];
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    expect(screen.getByTestId('explorer-tab')).toBeTruthy();

    cleanup();
    h.panel.activeId = 'tab-6';
    h.panel.tabs = [{ id: 'tab-6', kind: 'browser', title: 'Browser', automationTargetId: 'auto-1' }];
    render(<ScheduleDetailPage projectId={null} scheduleId="sched-1" />);
    expect(screen.getByTestId('browser-deck')).toBeTruthy();
  });
});
