// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { MobileConnectionMenu, MobileNavDrawer, MobileShellReporter, useMobileNavigation } from './MobileShellChrome.js';
const native = vi.hoisted(() => ({
  available: true,
  bridgeVersion: 3,
  post: vi.fn(),
  capabilities: ['badge'],
  subscribe: vi.fn(() => () => {})
}));
const surface = vi.hoisted(() => ({ value: 'web' }));
vi.mock('../lib/app-surface.js', () => ({ getAppSurface: () => surface.value }));
vi.mock('../lib/native-shell.js', () => ({
  getNativeShell: () => native.available ? native : null,
  installNativeShellEvents: (resume: () => void) => {
    resume();
    return native.subscribe();
  }
}));
let listener: () => void;
let narrow = true;
beforeEach(() => {
  native.available = true;
  native.bridgeVersion = 3;
  native.capabilities = ['badge', 'open-native'];
  surface.value = 'web';
  narrow = true;
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return narrow;
    },
    addEventListener: (_: string, callback: () => void) => {
      listener = callback;
    },
    removeEventListener: vi.fn()
  }));
});
it('hosts the native connection menu in the page header and restores fallback chrome on unmount', () => {
  const { unmount } = render(<MobileConnectionMenu />);
  expect(native.post).toHaveBeenCalledWith({ type: 'shell-chrome', visible: true });
  fireEvent.click(screen.getByRole('button', { name: 'Connection options' }));
  expect(native.post).toHaveBeenCalledWith({ type: 'open-native', screen: 'connection-menu' });
  unmount();
  expect(native.post).toHaveBeenLastCalledWith({ type: 'shell-chrome', visible: false });
});
it.each(['browser', 'older-shell', 'no-native-ui'])('does not replace existing controls for %s', (kind) => {
  if (kind === 'browser') native.available = false;
  if (kind === 'older-shell') native.bridgeVersion = 2;
  if (kind === 'no-native-ui') native.capabilities = ['badge'];
  render(<MobileConnectionMenu />);
  expect(screen.queryByRole('button', { name: 'Connection options' })).toBeNull();
  expect(native.post).not.toHaveBeenCalled();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('uses a drawer on phones without changing desktop preferences, and resets on resize', () => {
  const { result } = renderHook(useMobileNavigation, {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>
  });
  expect(result.current.isCompact).toBe(true);
  expect(result.current.drawerOpen).toBe(false);
  act(() => result.current.setDrawerOpen(true));
  expect(result.current.drawerOpen).toBe(true);
  act(() => {
    narrow = false;
    listener();
  });
  expect(result.current.isCompact).toBe(false);
  expect(result.current.drawerOpen).toBe(false);
});
it('keeps desktop narrow windows in the desktop layout', () => {
  surface.value = 'desktop';
  const { result } = renderHook(useMobileNavigation, {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>
  });
  expect(result.current.isCompact).toBe(false);
});
it('traps drawer focus, closes on Escape and restores focus', () => {
  const close = vi.fn();
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const { rerender } = render(
    <MobileNavDrawer enabled open onClose={close}>
      <button>Last item</button>
      <div hidden><button>Collapsed item</button></div>
      <div style={{ display: 'none' }}><button>Desktop action</button></div>
      <button style={{ visibility: 'hidden' }}>Invisible action</button>
    </MobileNavDrawer>
  );
  const first = screen.getAllByRole('button', { name: 'Close navigation' })[1]!;
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByText('Last item'));
  fireEvent.keyDown(screen.getByText('Last item'), { key: 'Tab' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
  fireEvent.click(first);
  expect(close).toHaveBeenCalledTimes(2);
  rerender(
    <MobileNavDrawer enabled open={false} onClose={close}>
      <button>Last item</button>
    </MobileNavDrawer>
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});
it('renders ordinary sidebar children outside mobile and reports badge/path events', () => {
  render(
    <MemoryRouter>
      <MobileNavDrawer enabled={false} open onClose={vi.fn()}>
        <span>Sidebar</span>
      </MobileNavDrawer>
      <MobileShellReporter unread={4} />
    </MemoryRouter>
  );
  expect(screen.getByText('Sidebar')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(native.post).toHaveBeenCalledWith({ type: 'badge', count: 4 });
  expect(native.post).toHaveBeenCalledWith(expect.objectContaining({ type: 'title' }));
});

it('uses the settings return action in the drawer header and keeps it in the focus loop', () => {
  render(<MobileNavDrawer enabled open onClose={vi.fn()} headerStart={<a href="/agents">Back to app</a>}>
    <button>Preferences</button>
  </MobileNavDrawer>);
  const back = screen.getByRole('link', { name: 'Back to app' });
  expect(back.closest('.mobile-nav-header')).toBeTruthy();
  expect(screen.queryByText('Zana')).toBeNull();
  expect(document.activeElement).toBe(back);
  fireEvent.keyDown(back, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Preferences' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(document.activeElement).toBe(back);
});
