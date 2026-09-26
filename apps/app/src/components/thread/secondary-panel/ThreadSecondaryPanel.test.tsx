// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadSecondaryPanel } from './ThreadSecondaryPanel.js';
import { emptySecondaryPanelState, openNewTab, openSecondaryPanel, selectPinnedView } from './threadSecondaryPanelState.js';

const layout = vi.hoisted(() => ({ compact: false }));
vi.mock('../../../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => layout.compact }));

const noop = () => undefined;

afterEach(() => {
  cleanup();
  layout.compact = false;
  vi.restoreAllMocks();
});

describe('ThreadSecondaryPanel chrome', () => {
  it.each([false, true])('reveals the active tab and keeps panel actions reachable (compact=%s)', (compact) => {
    layout.compact = compact;
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const handlers = {
      onSelectInfo: vi.fn(), onSelectDiff: vi.fn(), onSelectPlan: vi.fn(),
      onNewTab: vi.fn(), onCloseTab: vi.fn(), onActivateTab: vi.fn(),
      onToggleMaximized: vi.fn(), onHide: vi.fn(), onResize: vi.fn()
    };
    const state = {
      ...openSecondaryPanel(emptySecondaryPanelState()),
      activeId: 'first',
      tabs: [
        { id: 'first', kind: 'new-tab' as const, title: 'supabase-adapter.ts' },
        { id: 'last', kind: 'new-tab' as const, title: 'native-build-configuration.ts' }
      ]
    };
    const view = render(<ThreadSecondaryPanel state={state} showDiffPin showPlanPin {...handlers}>body</ThreadSecondaryPanel>);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(scroll.mock.instances[0]).toBe(view.getByText('supabase-adapter.ts').parentElement);
    for (const [label, handler] of [
      ['Show info', handlers.onSelectInfo], ['Show workspace diff', handlers.onSelectDiff],
      ['Show plan', handlers.onSelectPlan], ['New tab', handlers.onNewTab],
      ['Maximize panel', handlers.onToggleMaximized], [compact ? 'Close panel' : 'Hide right panel', handlers.onHide]
    ] as const) {
      const button = view.getByRole('button', { name: label });
      expect(button.closest('.thread-secondary-tabs')).toBeNull();
      fireEvent.click(button);
      expect(handler).toHaveBeenCalledOnce();
    }
    fireEvent.click(view.getByRole('button', { name: 'native-build-configuration.ts', exact: true }));
    expect(handlers.onActivateTab).toHaveBeenCalledWith('last');
    view.rerender(<ThreadSecondaryPanel state={{ ...state, activeId: 'last' }} {...handlers}>body</ThreadSecondaryPanel>);
    expect(scroll.mock.instances.at(-1)).toBe(view.getByText('native-build-configuration.ts').parentElement);
    fireEvent.click(view.getByRole('button', { name: 'Close native-build-configuration.ts' }));
    expect(handlers.onCloseTab).toHaveBeenCalledWith('last');
    scroll.mockClear();
    view.rerender(<ThreadSecondaryPanel state={selectPinnedView(state, 'info')} {...handlers}>body</ThreadSecondaryPanel>);
    expect(scroll).not.toHaveBeenCalled();

    vi.spyOn(view.container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 600));
    fireEvent.mouseDown(view.getByRole('separator', { name: 'Resize right panel' }));
    expect(document.body.classList.contains('resizing-col')).toBe(true);
    fireEvent.mouseMove(window, { clientX: 600 });
    expect(handlers.onResize).toHaveBeenCalledWith(400, 1000);
    fireEvent.mouseUp(window);
    expect(document.body.classList.contains('resizing-col')).toBe(false);
    fireEvent.mouseMove(window, { clientX: 500 });
    expect(handlers.onResize).toHaveBeenCalledOnce();
  });

  it('renders Info, New Tab, maximize, and hide controls', () => {
    const html = renderToStaticMarkup(
      <ThreadSecondaryPanel
        state={openSecondaryPanel(emptySecondaryPanelState())}
        showDiffPin
        onSelectInfo={noop}
        onSelectDiff={noop}
        onNewTab={noop}
        onCloseTab={noop}
        onActivateTab={noop}
        onToggleMaximized={noop}
        onHide={noop}
        onResize={noop}
      >
        <div>body</div>
      </ThreadSecondaryPanel>
    );
    expect(html).toContain('data-testid="thread-secondary-panel"');
    expect(html).toContain('data-testid="thread-info-pin"');
    expect(html).toContain('data-testid="thread-diff-pin"');
    expect(html).not.toContain('data-testid="thread-plan-pin"');
    expect(html).toContain('data-testid="thread-secondary-new-tab"');
    expect(html).toContain('data-testid="thread-secondary-hide"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('renders the Plan pin when asked', () => {
    const html = renderToStaticMarkup(
      <ThreadSecondaryPanel
        state={selectPinnedView(emptySecondaryPanelState(), 'plan')}
        showPlanPin
        onSelectInfo={noop}
        onSelectDiff={noop}
        onSelectPlan={noop}
        onNewTab={noop}
        onCloseTab={noop}
        onActivateTab={noop}
        onToggleMaximized={noop}
        onHide={noop}
        onResize={noop}
      >
        <div>body</div>
      </ThreadSecondaryPanel>
    );
    expect(html).toContain('data-testid="thread-plan-pin"');
    expect(html).toContain('aria-label="Show plan"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('renders a footer slot for inspector actions', () => {
    const html = renderToStaticMarkup(
      <ThreadSecondaryPanel
        state={openSecondaryPanel(emptySecondaryPanelState())}
        footer={<button type="button">Delete</button>}
        onSelectInfo={noop}
        onSelectDiff={noop}
        onNewTab={noop}
        onCloseTab={noop}
        onActivateTab={noop}
        onToggleMaximized={noop}
        onHide={noop}
        onResize={noop}
      >
        <div>body</div>
      </ThreadSecondaryPanel>
    );
    expect(html).toContain('data-testid="thread-secondary-footer"');
    expect(html).toContain('Delete');
  });

  it('hides inspector actions while Diff is showing', () => {
    const html = renderToStaticMarkup(
      <ThreadSecondaryPanel
        state={selectPinnedView(emptySecondaryPanelState(), 'diff')}
        showDiffPin
        footer={<button type="button">Delete</button>}
        onSelectInfo={noop}
        onSelectDiff={noop}
        onNewTab={noop}
        onCloseTab={noop}
        onActivateTab={noop}
        onToggleMaximized={noop}
        onHide={noop}
        onResize={noop}
      >
        <div>diff</div>
      </ThreadSecondaryPanel>
    );
    expect(html).not.toContain('data-testid="thread-secondary-footer"');
    expect(html).not.toContain('Delete');
  });

  it('renders closable New Tab pills', () => {
    const html = renderToStaticMarkup(
      <ThreadSecondaryPanel
        state={openNewTab(selectPinnedView(emptySecondaryPanelState(), 'info'))}
        onSelectInfo={noop}
        onSelectDiff={noop}
        onNewTab={noop}
        onCloseTab={noop}
        onActivateTab={noop}
        onToggleMaximized={noop}
        onHide={noop}
        onResize={noop}
      >
        body
      </ThreadSecondaryPanel>
    );
    expect(html).toContain('New Tab');
    expect(html).toContain('Close New Tab');
  });

  it('shows the restore control when maximized', () => {
    const html = renderToStaticMarkup(
      <ThreadSecondaryPanel
        state={{ ...openSecondaryPanel(emptySecondaryPanelState()), isMaximized: true }}
        onSelectInfo={noop}
        onSelectDiff={noop}
        onNewTab={noop}
        onCloseTab={noop}
        onActivateTab={noop}
        onToggleMaximized={noop}
        onHide={noop}
        onResize={noop}
      >
        body
      </ThreadSecondaryPanel>
    );
    expect(html).toContain('Restore conversation');
    expect(html).toContain('is-maximized');
  });
});
