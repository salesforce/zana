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
});
