/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { PluginProjectTabRegistration } from '@zana-ai/zcc-plugin-sdk/app';

const h = vi.hoisted(() => ({
  desktop: true,
  open: [] as Array<{ pluginId: string; tabId: string; projectId: string }>,
  openWindow: vi.fn(async () => true),
  closeWindow: vi.fn(async () => true)
}));
vi.mock('@/lib/app-surface', () => ({ hasDesktopBridge: () => h.desktop }));
vi.mock('@/plugins/PluginSlotBoundary', () => ({ PluginSlotBoundary: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/plugins/plugin-view-windows', async (importOriginal) => ({
  isPluginViewOpen: (await importOriginal<typeof import('@/plugins/plugin-view-windows')>()).isPluginViewOpen,
  usePluginViewWindows: () => h.open,
  openPluginViewWindow: h.openWindow,
  closePluginViewWindow: h.closeWindow
}));

import { DetachedPluginTab, OpenInWindowButton, usePluginTabDetached, withOpenInWindow } from './DetachablePluginTab.js';

const target = { pluginId: 'salesforce', tabId: 'studio', projectId: 'p-1' };
const tab = (extra: Partial<PluginProjectTabRegistration> = {}) =>
  ({ id: 'studio', pluginId: 'salesforce', generation: 1, label: 'Studio', detachable: true, component: () => null, ...extra }) as PluginProjectTabRegistration;

beforeEach(() => {
  h.desktop = true;
  h.open = [];
  h.openWindow.mockClear();
  h.closeWindow.mockClear();
});
afterEach(cleanup);

describe('usePluginTabDetached', () => {
  it('is true only for a detachable tab whose window is open', () => {
    h.open = [target];
    expect(renderHook(() => usePluginTabDetached(tab(), 'p-1')).result.current).toBe(true);
    expect(renderHook(() => usePluginTabDetached(tab(), 'p-2')).result.current).toBe(false);
    expect(renderHook(() => usePluginTabDetached(tab({ detachable: undefined }), 'p-1')).result.current).toBe(false);
    expect(renderHook(() => usePluginTabDetached(undefined, 'p-1')).result.current).toBe(false);
  });
});

describe('OpenInWindowButton', () => {
  it('opens the tab in its own window', () => {
    render(<OpenInWindowButton tab={tab()} projectId="p-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Studio in a new window' }));
    expect(h.openWindow).toHaveBeenCalledWith(target);
  });

  it('is hidden for tabs that did not opt in, and outside the desktop app', () => {
    const { container, rerender } = render(<OpenInWindowButton tab={tab({ detachable: undefined })} projectId="p-1" />);
    expect(container.innerHTML).toBe('');
    h.desktop = false;
    rerender(<OpenInWindowButton tab={tab()} projectId="p-1" />);
    expect(container.innerHTML).toBe('');
  });
});

describe('withOpenInWindow', () => {
  const actions = <button>Close pane</button>;

  it('puts the window button before the host actions', () => {
    render(<div role="toolbar">{withOpenInWindow(tab(), 'p-1', actions)}</div>);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
      'Open Studio in a new window',
      'Close pane'
    ]);
  });

  it('returns the host actions alone when the tab cannot detach', () => {
    expect(withOpenInWindow(tab({ detachable: false }), 'p-1', actions)).toBe(actions);
    h.desktop = false;
    expect(withOpenInWindow(tab(), 'p-1', actions)).toBe(actions);
  });
});

describe('DetachedPluginTab', () => {
  it('offers to focus the window or bring the tab back', () => {
    render(<DetachedPluginTab tab={tab()} projectId="p-1" />);
    expect(screen.getByText('Studio is open in its own window')).toBeTruthy();
    fireEvent.click(screen.getByTestId('plugin-tab-detached-focus'));
    expect(h.openWindow).toHaveBeenCalledWith(target);
    fireEvent.click(screen.getByTestId('plugin-tab-detached-bring-back'));
    expect(h.closeWindow).toHaveBeenCalledWith(target);
  });

  it('shows the plugin placeholder with the same actions when it has one', () => {
    const detachedPlaceholder = vi.fn(({ projectId, focusWindow, bringBack }) => (
      <section aria-label="Studio status">
        {projectId}
        <button onClick={focusWindow}>Focus</button>
        <button onClick={bringBack}>Back</button>
      </section>
    ));
    render(<DetachedPluginTab tab={tab({ detachedPlaceholder })} projectId="p-1" />);
    expect(screen.getByRole('region', { name: 'Studio status' }).textContent).toContain('p-1');
    expect(detachedPlaceholder.mock.calls[0]![0]).toMatchObject({ pluginId: 'salesforce', projectId: 'p-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(h.openWindow).toHaveBeenCalledWith(target);
    expect(h.closeWindow).toHaveBeenCalledWith(target);
    expect(screen.queryByTestId('plugin-tab-detached-focus')).toBeNull();
  });
});
