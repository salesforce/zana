// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BasicPanelChrome, basicPanelActiveSupported, basicPanelTabSupported } from './BasicPanelChrome.js';
import { emptySecondaryPanelState, type ThreadSecondaryPanelState } from './threadSecondaryPanelState.js';

afterEach(cleanup);

describe('Basic preview policy', () => {
  it.each(['file-preview', 'storage-preview', 'browser', 'plugin'])('supports contextual %s previews', kind => {
    expect(basicPanelTabSupported(kind)).toBe(true);
  });
  it.each(['terminal', 'explorer', 'inbox', 'agent', 'new-tab', 'unknown'])('keeps %s in Advanced', kind => {
    expect(basicPanelTabSupported(kind)).toBe(false);
  });
  it('allows files and plan pins but requires Advanced for changes or missing tabs', () => {
    const state = emptySecondaryPanelState();
    expect(basicPanelActiveSupported(state)).toBe(true);
    expect(basicPanelActiveSupported({ ...state, activeId: 'plan' })).toBe(true);
    expect(basicPanelActiveSupported({ ...state, activeId: 'diff' })).toBe(false);
    expect(basicPanelActiveSupported({ ...state, activeId: 'missing' })).toBe(false);
    expect(basicPanelActiveSupported({ ...state, activeId: 'doc', tabs: [{ id: 'doc', kind: 'file-preview', title: 'Report' }] })).toBe(true);
  });
});

function fixture(state: ThreadSecondaryPanelState, showInfo = true, showPlan = true) {
  const callbacks = { onSelectInfo: vi.fn(), onSelectPlan: vi.fn(), onActivateTab: vi.fn(), onCloseTab: vi.fn(), onToggleMaximized: vi.fn(), onHide: vi.fn() };
  return { ...render(<BasicPanelChrome state={state} showInfo={showInfo} showPlan={showPlan} {...callbacks} />), callbacks };
}

describe('Basic preview tabs', () => {
  it('exposes results, maximize and hide without advanced launchers or closing hidden terminal tabs', () => {
    const state: ThreadSecondaryPanelState = { ...emptySecondaryPanelState(), activeId: 'report', tabs: [
      { id: 'report', kind: 'file-preview', title: 'Weekly update' }, { id: 'shell', kind: 'terminal', title: 'Shell' }
    ] };
    const { callbacks } = fixture(state);
    expect(screen.queryByRole('button', { name: 'Shell' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close Shell' })).toBeNull();
    expect(screen.queryByRole('button', { name: /New tab|Add tool|Panel actions|Changes/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Weekly update', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Weekly update' }));
    fireEvent.click(screen.getByRole('button', { name: 'Maximize panel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide right panel' }));
    expect(callbacks.onSelectInfo).toHaveBeenCalledOnce();expect(callbacks.onSelectPlan).toHaveBeenCalledOnce();
    expect(callbacks.onActivateTab).toHaveBeenCalledWith('report');expect(callbacks.onCloseTab).toHaveBeenCalledWith('report');
    expect(callbacks.onToggleMaximized).toHaveBeenCalledOnce();expect(callbacks.onHide).toHaveBeenCalledOnce();
    expect(state.tabs).toHaveLength(2);
  });
  it('navigates visible tabs with the keyboard and ignores modified or close-button events', () => {
    const { callbacks } = fixture({ ...emptySecondaryPanelState(), activeId: 'doc', tabs: [{ id: 'doc', kind: 'browser', title: 'Preview' }] });
    const files = screen.getByRole('button', { name: 'Files' });
    const plan = screen.getByRole('button', { name: 'Plan' });
    const preview = screen.getByRole('button', { name: 'Preview', exact: true });
    fireEvent.keyDown(files, { key: 'ArrowRight' });expect(document.activeElement).toBe(plan);
    fireEvent.keyDown(plan, { key: 'End' });expect(document.activeElement).toBe(preview);
    fireEvent.keyDown(preview, { key: 'ArrowRight' });expect(document.activeElement).toBe(files);
    fireEvent.keyDown(files, { key: 'ArrowLeft' });expect(document.activeElement).toBe(preview);
    fireEvent.keyDown(preview, { key: 'Home' });expect(document.activeElement).toBe(files);
    const calls = callbacks.onActivateTab.mock.calls.length;
    fireEvent.keyDown(preview, { key: 'ArrowLeft', metaKey: true });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close Preview' }), { key: 'ArrowLeft' });
    fireEvent.keyDown(preview, { key: 'Enter' });
    expect(callbacks.onActivateTab).toHaveBeenCalledTimes(calls);
  });
  it('offers one clear return action in a narrow result and preserves the open tab', () => {
    const state = { ...emptySecondaryPanelState(), activeId: 'doc', tabs: [{ id: 'doc', kind: 'file-preview' as const, title: 'Release plan' }] };
    const onHide = vi.fn();
    render(<BasicPanelChrome state={state} compact showInfo={false} showPlan={false}
      onSelectInfo={vi.fn()} onActivateTab={vi.fn()} onCloseTab={vi.fn()} onToggleMaximized={vi.fn()} onHide={onHide} />);
    const back = screen.getByRole('button', { name: 'Back to chat' });
    expect(document.activeElement).toBe(back);
    fireEvent.click(back);
    expect(onHide).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Maximize panel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide right panel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Release plan', exact: true }).getAttribute('aria-pressed')).toBe('true');
    expect(state.tabs).toHaveLength(1);
  });
  it('omits absent pins and labels a maximized result with a return action', () => {
    fixture({ ...emptySecondaryPanelState(), isMaximized: true }, false, false);
    expect(screen.queryByRole('button', { name: 'Files' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Restore conversation' })).toBeTruthy();
  });
});
