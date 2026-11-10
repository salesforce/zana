// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  ui: { sidebarCollapsed: false },
  data: { companionEnabled: true },
  bridge: true,
  mac: true,
  enter: vi.fn(),
  footer: [] as never[]
}));

vi.mock('../../store', () => ({
  useUi: Object.assign((s: (x: typeof h.ui) => unknown) => s(h.ui), { getState: () => h.ui }),
  useData: (s: (x: typeof h.data) => unknown) => s(h.data),
  applySidebarWidth: vi.fn(),
  SIDEBAR_MIN: 256,
  SIDEBAR_MAX: 480
}));
vi.mock('../../plugins/plugin-slots', () => ({
  subscribePluginSlots: (l: () => void) => {
    l();
    return () => undefined;
  },
  listSidebarFooterActions: () => h.footer
}));
vi.mock('../../lib/resolveIcon', () => ({ resolveIcon: () => () => null }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => h.bridge }));
vi.mock('../../lib/platformShortcut.js', () => ({ isMacShortcutPlatform: () => h.mac }));
vi.mock('../../lib/product-client.js', () => ({
  product: { companion: { enter: (...a: unknown[]) => h.enter(...a) } }
}));
vi.mock('../sidebar/useThreadRowSplitDrag.js', () => ({
  usePaneContentSplitDrag: () => ({ onPointerDown: vi.fn(), openInSplit: vi.fn(), consumeClick: () => false })
}));
vi.mock('../sidebar/paneContentSplitIndicator.js', () => ({
  usePaneContentSplitIndicator: () => ({ miniMap: null })
}));

import { SidebarRail } from '../SidebarRail.js';

function mount() {
  render(
    <MemoryRouter>
      <SidebarRail className="sidebar" navAriaLabel="Nav" storageKey="zcc.testCompanion" pinnedIds={[]} items={[]} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  h.data.companionEnabled = true;
  h.bridge = true;
  h.mac = true;
  h.enter.mockReturnValue(Promise.resolve());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('SidebarRail Command Center button', () => {
  it('enters the companion rail on click', () => {
    mount();
    fireEvent.click(screen.getByLabelText('Minimize to Command Center'));
    expect(h.enter).toHaveBeenCalledTimes(1);
  });
  it('owns an enter rejection and allows a retry', async () => {
    const error = new Error('companion unavailable');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.enter.mockRejectedValueOnce(error);
    mount();
    fireEvent.click(screen.getByLabelText('Minimize to Command Center'));
    await waitFor(() => expect(logged).toHaveBeenCalledWith('[companion] enter:', error));
    fireEvent.click(screen.getByLabelText('Minimize to Command Center'));
    expect(h.enter).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['flag off', () => (h.data.companionEnabled = false)],
    ['no desktop bridge', () => (h.bridge = false)],
    ['not macOS', () => (h.mac = false)]
  ])('hides the button when %s', (_n, setup) => {
    setup();
    mount();
    expect(screen.queryByLabelText('Minimize to Command Center')).toBeNull();
  });
});
