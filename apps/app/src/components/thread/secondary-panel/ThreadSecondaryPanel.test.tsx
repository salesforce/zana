// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  it('moves dock tabs with accessible controls and supports collapse, drag and resize', () => {
    const onMove = vi.fn(), onHeight = vi.fn(), onDragStart = vi.fn(), onDragEnd = vi.fn(), onDrop = vi.fn(), onDragOver = vi.fn(), onToggleCollapsed = vi.fn();
    const state = { ...openSecondaryPanel(emptySecondaryPanelState()), activeId: 'terminal', tabs: [{ id: 'terminal', title: 'Shell', kind: 'terminal' as const, sessionId: 'pty' }] };
    const handlers = { onSelectInfo: noop, onSelectDiff: noop, onNewTab: noop, onCloseTab: noop, onActivateTab: noop, onToggleMaximized: noop, onHide: noop, onResize: noop };
    const dock = { side: 'bottom' as const, onMove, onHeight, onDragStart, onDragEnd, onDrop, onDragOver, onToggleCollapsed, heightPx: 240, collapsed: false, dragging: true };
    const view = render(<ThreadSecondaryPanel state={state} dock={dock} showInfoPin={false} {...handlers}>live tool</ThreadSecondaryPanel>);
    fireEvent.click(view.getByRole('button', { name: 'Bottom panel actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move Shell to right panel' })); expect(onMove).toHaveBeenCalledWith('terminal');
    fireEvent.click(view.getByLabelText('Hide bottom panel')); expect(onToggleCollapsed).toHaveBeenCalledOnce();
    const tab = view.getByText('Shell').closest('.thread-secondary-tab')!;
    fireEvent.dragStart(tab); fireEvent.dragEnd(tab); expect(onDragStart).toHaveBeenCalled(); expect(onDragEnd).toHaveBeenCalledOnce();
    fireEvent.dragOver(view.getByTestId('thread-bottom-panel')); fireEvent.drop(view.getByTestId('thread-bottom-panel')); expect(onDragOver).toHaveBeenCalledOnce(); expect(onDrop).toHaveBeenCalledOnce();
    const resize = view.getByRole('separator');
    fireEvent.keyDown(resize, { key: 'ArrowUp' }); fireEvent.keyDown(resize, { key: 'ArrowDown' }); fireEvent.keyDown(resize, { key: 'Enter' });
    expect(onHeight.mock.calls).toEqual([[256], [224]]);
    Object.assign(resize, { setPointerCapture: vi.fn() });
    fireEvent.pointerDown(resize, { button: 0, pointerId: 1, clientY: 400 });
    (resize as HTMLElement).onpointermove?.(new PointerEvent('pointermove', { clientY: 380 }));
    expect(onHeight).toHaveBeenLastCalledWith(260);
    (resize as HTMLElement).onpointerup?.(new PointerEvent('pointerup')); expect((resize as HTMLElement).onpointermove).toBeNull();
    view.rerender(<ThreadSecondaryPanel state={state} dock={{ ...dock, collapsed: true }} {...handlers}>live tool</ThreadSecondaryPanel>);
    expect(view.queryByText('live tool')).toBeNull(); expect(view.getByLabelText('Expand bottom panel')).toBeTruthy();
    view.rerender(<ThreadSecondaryPanel state={state} dock={{ ...dock, side: 'right' }} {...handlers}>live tool</ThreadSecondaryPanel>);
    fireEvent.click(view.getByRole('button', { name: 'Right panel actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move Shell to bottom panel' })); expect(onMove).toHaveBeenCalledTimes(2);
  });
  it('shares one tab row between pinned views and tools, retaining the full launcher', () => {
    const onAddTool = vi.fn(), onNewTab = vi.fn(), onSelectInfo = vi.fn(), onSelectDiff = vi.fn(), onSelectPlan = vi.fn();
    const handlers = { onSelectInfo, onSelectDiff, onSelectPlan, onNewTab, onAddTool, onCloseTab: noop, onActivateTab: noop, onToggleMaximized: noop, onHide: noop, onResize: noop };
    const dock = { side: 'right' as const, onMove: vi.fn(), onDragStart: noop, onDragEnd: noop, onDrop: noop, onDragOver: noop };
    const state = openSecondaryPanel(emptySecondaryPanelState());
    const view = render(<ThreadSecondaryPanel state={state} dock={dock} showDiffPin showPlanPin {...handlers}>body</ThreadSecondaryPanel>);
    const tabs = view.getByRole('toolbar', { name: 'Panel tabs' });
    expect(tabs.querySelectorAll('.thread-secondary-tab')).toHaveLength(3);
    expect(view.container.querySelector('.thread-secondary-context')).toBeNull();
    expect(view.getByText('Info').closest('.thread-secondary-tab')?.classList.contains('is-active')).toBe(true);
    expect(tabs.querySelector('.thread-secondary-tab-close')).toBeNull();
    fireEvent.click(view.getByText('Info')); fireEvent.click(view.getByText('Changes')); fireEvent.click(view.getByText('Plan'));
    expect(onSelectInfo).toHaveBeenCalledOnce(); expect(onSelectDiff).toHaveBeenCalledOnce(); expect(onSelectPlan).toHaveBeenCalledOnce();
    const add = view.getByRole('button', { name: 'Add tool to right panel' });
    expect(add.previousElementSibling?.className).toBe('thread-secondary-tabs');
    for (const [label, kind] of [['Terminal', 'terminal'], ['Browser', 'browser'], ['Files', 'explorer']] as const) {
      fireEvent.click(add); fireEvent.click(screen.getByRole('menuitem', { name: label }));
      expect(onAddTool).toHaveBeenLastCalledWith(kind); expect(document.activeElement).toBe(add);
    }
    fireEvent.click(add); fireEvent.click(screen.getByRole('menuitem', { name: 'More tools…' })); expect(onNewTab).toHaveBeenCalledOnce();
    view.rerender(<ThreadSecondaryPanel state={state} dock={dock} canAddBrowser={false} {...handlers}>body</ThreadSecondaryPanel>);
    fireEvent.click(add); expect(screen.queryByRole('menuitem', { name: 'Browser' })).toBeNull();
    fireEvent.click(add); expect(screen.queryByRole('menu')).toBeNull();
  });
  it('opens inactive tab actions with the keyboard or context menu without changing selection', () => {
    const onCloseTab = vi.fn(), onMove = vi.fn(), onHide = vi.fn(), onToggleMaximized = vi.fn(), onActivateTab = vi.fn();
    const handlers = { onSelectInfo: noop, onSelectDiff: noop, onNewTab: noop, onCloseTab, onActivateTab, onToggleMaximized, onHide, onResize: noop };
    const dock = { side: 'right' as const, onMove, onDragStart: noop, onDragEnd: noop, onDrop: noop, onDragOver: noop };
    const state = { ...openSecondaryPanel(emptySecondaryPanelState()), tabs: [{ id: 't', kind: 'terminal' as const, title: 'Shell', sessionId: 'pty' }] };
    const view = render(<ThreadSecondaryPanel state={state} dock={dock} {...handlers}>body</ThreadSecondaryPanel>);
    const tab = view.getByRole('button', { name: 'Shell', exact: true });
    fireEvent.keyDown(tab, { key: 'F10', shiftKey: true });
    expect(screen.getByText('Stops this terminal session')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Close Shell/ })); expect(onCloseTab).toHaveBeenCalledWith('t');
    fireEvent.contextMenu(tab); fireEvent.click(screen.getByRole('menuitem', { name: 'Move Shell to bottom panel' })); expect(onMove).toHaveBeenCalledWith('t');
    fireEvent.keyDown(tab, { key: 'ContextMenu' }); fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(tab); expect(onActivateTab).not.toHaveBeenCalled();
    const actions = view.getByRole('button', { name: 'Right panel actions' });
    fireEvent.click(actions); expect(screen.getByRole('menuitem', { name: 'Move Info to bottom panel' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Close/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Maximize panel' })); expect(onToggleMaximized).toHaveBeenCalledOnce();
    fireEvent.click(actions); fireEvent.click(screen.getByRole('menuitem', { name: /Hide right panel/ })); expect(onHide).toHaveBeenCalledOnce();
    fireEvent.click(actions); fireEvent.click(actions); expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Add tool to right panel' }));
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  });
  it('moves pinned tabs without close actions and navigates the shared row with the keyboard', () => {
    const onSelectInfo = vi.fn(), onSelectDiff = vi.fn(), onSelectPlan = vi.fn(), onActivateTab = vi.fn(), onMove = vi.fn();
    const dock = { side: 'right' as const, onMove, onDragStart: vi.fn(), onDragEnd: vi.fn(), onDrop: noop, onDragOver: noop };
    const handlers = { onSelectInfo, onSelectDiff, onSelectPlan, onActivateTab, onNewTab: noop, onCloseTab: vi.fn(), onToggleMaximized: noop, onHide: noop, onResize: noop };
    const state = { ...openSecondaryPanel(emptySecondaryPanelState()), tabs: [{ id: 'shell', kind: 'terminal' as const, title: 'Shell', sessionId: 'pty' }] };
    const view = render(<ThreadSecondaryPanel state={state} dock={dock} showDiffPin showPlanPin {...handlers}>body</ThreadSecondaryPanel>);
    const info = view.getByRole('button', { name: 'Show info' }), diff = view.getByRole('button', { name: 'Show workspace diff' });
    const plan = view.getByRole('button', { name: 'Show plan' }), shell = view.getByRole('button', { name: 'Shell', exact: true });
    for (const button of [info, diff, plan, shell]) expect(button.closest('.thread-secondary-tabs')).toBeTruthy();
    fireEvent.keyDown(info, { key: 'ArrowRight' }); expect(onSelectDiff).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(diff);
    fireEvent.keyDown(diff, { key: 'ArrowRight' }); expect(onSelectPlan).toHaveBeenCalledOnce();
    fireEvent.keyDown(plan, { key: 'ArrowRight' }); expect(onActivateTab).toHaveBeenLastCalledWith('shell');
    fireEvent.keyDown(shell, { key: 'ArrowRight' }); expect(document.activeElement).toBe(info);
    fireEvent.keyDown(info, { key: 'ArrowLeft' }); expect(document.activeElement).toBe(shell);
    fireEvent.keyDown(shell, { key: 'Home' }); expect(document.activeElement).toBe(info);
    fireEvent.keyDown(info, { key: 'End' }); expect(document.activeElement).toBe(shell);
    const calls = onActivateTab.mock.calls.length;
    fireEvent.keyDown(shell, { key: 'ArrowLeft', metaKey: true }); fireEvent.keyDown(shell, { key: 'Enter' });
    fireEvent.keyDown(view.getByRole('button', { name: 'Close Shell' }), { key: 'ArrowLeft' });
    expect(onActivateTab).toHaveBeenCalledTimes(calls);
    fireEvent.dragStart(info.parentElement!); fireEvent.dragEnd(info.parentElement!);
    expect(dock.onDragStart).toHaveBeenCalledWith(expect.anything(), 'info'); expect(dock.onDragEnd).toHaveBeenCalledOnce();
    fireEvent.keyDown(info, { key: 'F10', shiftKey: true });
    expect(screen.queryByRole('menuitem', { name: /Close/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move Info to bottom panel' })); expect(onMove).toHaveBeenCalledWith('info');
    view.rerender(<ThreadSecondaryPanel state={{ ...state, activeId: 'diff' }} dock={dock} showDiffPin showPlanPin {...handlers}>body</ThreadSecondaryPanel>);
    expect(diff.getAttribute('aria-pressed')).toBe('true'); expect(info.getAttribute('aria-pressed')).toBe('false'); expect(shell.getAttribute('aria-pressed')).toBe('false');
    expect(view.container.querySelectorAll('.thread-secondary-tab.is-active')).toHaveLength(1);
    fireEvent.click(view.getByRole('button', { name: 'Right panel actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move Changes to bottom panel' })); expect(onMove).toHaveBeenLastCalledWith('diff');
  });
  it('reveals the desktop active tab and keeps panel actions reachable', () => {
    const compact = false;
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
    fireEvent.mouseMove(window, { clientX: 600, buttons: 1 });
    expect(handlers.onResize).toHaveBeenCalledWith(400, 1000);
    fireEvent.mouseUp(window);
    expect(document.body.classList.contains('resizing-col')).toBe(false);
    fireEvent.mouseMove(window, { clientX: 500, buttons: 1 });
    expect(handlers.onResize).toHaveBeenCalledOnce();

    // Released over an embedded frame: the next buttonless move ends the drag.
    fireEvent.mouseDown(view.getByRole('separator', { name: 'Resize right panel' }));
    fireEvent.mouseMove(window, { clientX: 500, buttons: 0 });
    expect(document.body.classList.contains('resizing-col')).toBe(false);
    fireEvent.mouseMove(window, { clientX: 450, buttons: 1 });
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
        footer={<button type="button">Archive</button>}
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
    expect(html).toContain('Archive');
  });

  it('hides inspector actions while Diff is showing', () => {
    const html = renderToStaticMarkup(
      <ThreadSecondaryPanel
        state={selectPinnedView(emptySecondaryPanelState(), 'diff')}
        showDiffPin
        footer={<button type="button">Archive</button>}
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
    expect(html).not.toContain('Archive');
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
