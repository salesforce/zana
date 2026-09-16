/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SplitPaneBar } from './SplitPaneBar.js';
import { SplitPaneHeaderActions } from './SplitPaneHeaderActions.js';
import { PaneContextProvider, type PaneContextValue } from './PaneContext.js';

vi.mock('../../plugins/plugin-slots.js', () => {
  const panels = [{ pluginId: 'tools', id: 'tools', path: 'tools', title: 'Project tools' }];
  return { listNavPanels: () => panels, subscribePluginSlots: () => () => undefined };
});
afterEach(cleanup);

describe('SplitPaneBar', () => {
  it('shows a contributed panel title and exposes movement, restore and close', () => {
    const move = vi.fn();
    const maximize = vi.fn();
    const close = vi.fn();
    const drag = vi.fn();
    render(<SplitPaneBar
      content={{ kind: 'plugin-panel', pluginId: 'tools', panelPath: 'tools', subPath: '' }}
      isMaximized onClose={close} onMoveToSide={move} onToggleMaximize={maximize} onBeginDrag={drag}
    />);
    const title = screen.getByText('Project tools');
    fireEvent.pointerDown(title, { button: 0 });
    expect(drag).toHaveBeenCalledWith(expect.anything(), 'Project tools');
    fireEvent.pointerDown(title, { button: 2 });
    expect(drag).toHaveBeenCalledOnce();
    const nested = document.createElement('button');
    title.append(nested);
    fireEvent.pointerDown(nested, { button: 0 });
    expect(drag).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Restore pane' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close pane' }));
    expect(maximize).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Move pane', exact: true }));
    fireEvent.click(screen.getByRole('option', { name: 'Move pane above' }));
    expect(move).toHaveBeenCalledExactlyOnceWith('top');
  });
});

describe('SplitPaneHeaderActions', () => {
  const pane = (overrides: Partial<PaneContextValue> = {}): PaneContextValue => ({
    paneId: 'p1', isFocused: true, isSplitPane: true, isBoundedPane: true,
    secondaryPanelHost: null, onRequestClose: vi.fn(), isMaximized: false,
    onToggleMaximize: vi.fn(), navigateInPane: vi.fn(), onMoveToSide: vi.fn(), ...overrides
  });

  it('has no chrome outside a split or when no actions are available', () => {
    const { rerender, container } = render(<SplitPaneHeaderActions />);
    expect(container.innerHTML).toBe('');
    rerender(<PaneContextProvider value={pane({ onRequestClose: null, onToggleMaximize: null })}><SplitPaneHeaderActions /></PaneContextProvider>);
    expect(container.innerHTML).toBe('');
  });

  it('supports the same movement controls in thread-owned headers', () => {
    const value = pane();
    const outerClick = vi.fn();
    render(<div onClick={outerClick}><PaneContextProvider value={value}><SplitPaneHeaderActions /></PaneContextProvider></div>);
    fireEvent.click(screen.getByRole('button', { name: 'Maximize pane' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close pane' }));
    expect(value.onToggleMaximize).toHaveBeenCalledOnce();
    expect(value.onRequestClose).toHaveBeenCalledOnce();
    expect(outerClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Move pane', exact: true }));
    fireEvent.click(screen.getByRole('option', { name: 'Move pane right' }));
    expect(value.onMoveToSide).toHaveBeenCalledWith('right');
  });

  it('supports restore-only and close-only chrome', () => {
    const { rerender } = render(<PaneContextProvider value={pane({ onRequestClose: null, onMoveToSide: undefined, isMaximized: true })}><SplitPaneHeaderActions /></PaneContextProvider>);
    expect(screen.getByRole('button', { name: 'Restore pane' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close pane' })).toBeNull();
    rerender(<PaneContextProvider value={pane({ onToggleMaximize: null, onMoveToSide: undefined })}><SplitPaneHeaderActions /></PaneContextProvider>);
    expect(screen.queryByRole('button', { name: 'Restore pane' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close pane' })).toBeTruthy();
  });
});
