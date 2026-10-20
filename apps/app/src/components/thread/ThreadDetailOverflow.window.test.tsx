import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const h = vi.hoisted(() => ({ desktop: true, surface: false, open: vi.fn(async () => true) }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => h.desktop }));
vi.mock('../../lib/thread-view-windows.js', () => ({ openThreadViewWindow: h.open }));
vi.mock('../../lib/threadViewSurface.js', () => ({ isThreadViewSurface: () => h.surface }));

import { canOpenInWindow, ThreadDetailOverflowMenu, threadOpenInWindowAction } from './ThreadDetailOverflow.js';

const props = {
  canStop: false,
  onUnread: () => undefined,
  onRename: () => undefined,
  onFork: () => undefined,
  onStop: () => undefined,
  onArchive: () => undefined,
  onCloseFollowup: () => undefined
};

afterEach(() => {
  h.open.mockClear();
  h.desktop = true;
  h.surface = false;
});

describe('Open in new window', () => {
  it('is offered only when the host passes the action', () => {
    expect(renderToStaticMarkup(<ThreadDetailOverflowMenu {...props} />)).not.toContain('thread-open-in-window');
    const html = renderToStaticMarkup(<ThreadDetailOverflowMenu {...props} onOpenInWindow={() => undefined} />);
    expect(html).toContain('data-testid="thread-open-in-window"');
    expect(html).toContain('Open in new window');
  });

  it('is available on desktop, outside the thread window', () => {
    expect(canOpenInWindow()).toBe(true);
    h.surface = true;
    expect(canOpenInWindow()).toBe(false);
    h.surface = false;
    h.desktop = false;
    expect(canOpenInWindow()).toBe(false);
  });

  it('closes the menu, then opens the thread with its project when it has one', () => {
    const closeMenu = vi.fn();
    threadOpenInWindowAction('t-1', 'p-1', closeMenu)!();
    expect(closeMenu).toHaveBeenCalled();
    expect(h.open).toHaveBeenCalledWith({ threadId: 't-1', projectId: 'p-1' });
    threadOpenInWindowAction('t-2', null, closeMenu)!();
    expect(h.open).toHaveBeenCalledWith({ threadId: 't-2' });
  });

  it('offers no action inside the thread window', () => {
    h.surface = true;
    expect(threadOpenInWindowAction('t-1', 'p-1', () => {})).toBeUndefined();
  });
});
