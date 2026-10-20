import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const h = vi.hoisted(() => ({ desktop: true, surface: false }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => h.desktop }));
vi.mock('../../lib/threadViewSurface.js', () => ({ isThreadViewSurface: () => h.surface }));

import { canOpenInWindow, ThreadDetailOverflowMenu } from './ThreadDetailOverflow.js';

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
});
