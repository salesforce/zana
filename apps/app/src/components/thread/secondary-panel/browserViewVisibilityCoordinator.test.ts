import { describe, expect, it, vi } from 'vitest';
import type { DesktopBrowserApi } from '@zana-ai/zcc-desktop-contract';
import {
  createBrowserViewVisibilityCoordinator,
  destroyPersistedBrowserView,
  resetBrowserViewPersistence
} from './browserViewVisibilityCoordinator.js';

function fakeBrowser(): DesktopBrowserApi & { visible: Record<string, boolean> } {
  const visible: Record<string, boolean> = {};
  return {
    visible,
    attach() {},
    detach() {},
    navigate() {},
    goBack() {},
    goForward() {},
    reload() {},
    stop() {},
    setBounds() {},
    setVisible(request) {
      visible[request.tabId] = request.visible;
    },
    onState() {
      return () => undefined;
    },
    onOpenTab() {
      return () => undefined;
    }
  };
}

describe('browserViewVisibilityCoordinator', () => {
  it('preserves a snapshot only for temporary occlusion and only for the owning host', () => {
    const desktop = fakeBrowser();
    const visible = vi.spyOn(desktop, 'setVisible');
    const pane = createBrowserViewVisibilityCoordinator(desktop);
    const inspector = createBrowserViewVisibilityCoordinator(desktop);
    pane.show('a', () => {}); inspector.show('a', () => {});
    visible.mockClear(); pane.hide('a', true);
    expect(visible).not.toHaveBeenCalled();
    inspector.hide('a', true);
    expect(visible).toHaveBeenLastCalledWith({ tabId: 'a', visible: false, preserveSnapshot: true });
    inspector.show('a', () => {}); inspector.hide('a');
    expect(visible).toHaveBeenLastCalledWith({ tabId: 'a', visible: false });
  });
  it('hides the previous tab before showing the next', () => {
    const desktop = fakeBrowser();
    const coordinator = createBrowserViewVisibilityCoordinator(desktop);
    const syncA = vi.fn();
    const syncB = vi.fn();
    coordinator.show('a', syncA);
    expect(desktop.visible.a).toBe(true);
    coordinator.show('b', syncB);
    expect(desktop.visible.a).toBe(false);
    expect(desktop.visible.b).toBe(true);
    expect(syncB).toHaveBeenCalledOnce();
  });

  it('detaches a closed tab', () => {
    resetBrowserViewPersistence();
    const desktop = fakeBrowser();
    const detach = vi.spyOn(desktop, 'detach');
    destroyPersistedBrowserView({ desktopBrowser: desktop, tabId: 'gone' });
    expect(desktop.visible.gone).toBe(false);
    expect(detach).toHaveBeenCalledWith('gone');
  });

  it('lets an inspector take ownership before syncing bounds and ignores background cleanup', () => {
    const desktop = fakeBrowser();
    const pane = createBrowserViewVisibilityCoordinator(desktop);
    const inspector = createBrowserViewVisibilityCoordinator(desktop);
    pane.show('a', () => expect(pane.owns('a')).toBe(true));
    inspector.show('a', () => expect(inspector.owns('a')).toBe(true));
    expect(pane.owns('a')).toBe(false);
    pane.hide('a');
    pane.release('a');
    expect(desktop.visible.a).toBe(true);
    expect(inspector.owns('a')).toBe(true);
    inspector.hide('a');
    expect(desktop.visible.a).toBe(false);
    expect(inspector.owns('a')).toBe(false);
    pane.show('a', () => {});
    pane.release('a');
    expect(pane.owns('a')).toBe(false);
  });

  it('does not hide a transferred tab when its former host switches tabs', () => {
    const desktop = fakeBrowser();
    const pane = createBrowserViewVisibilityCoordinator(desktop);
    const inspector = createBrowserViewVisibilityCoordinator(desktop);
    pane.show('a', () => {});
    inspector.show('a', () => {});
    pane.show('b', () => {});
    expect(desktop.visible).toEqual({ a: true, b: true });
    destroyPersistedBrowserView({ desktopBrowser: desktop, tabId: 'a' });
    expect(inspector.owns('a')).toBe(false);
    expect(desktop.visible.a).toBe(false);
  });
});
