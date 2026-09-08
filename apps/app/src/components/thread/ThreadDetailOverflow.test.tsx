import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadDetailOverflowMenu, threadOverflowMenuPosition } from './ThreadDetailOverflow.js';

describe('threadOverflowMenuPosition', () => {
  it('hangs the menu from the trigger’s right edge in viewport coords', () => {
    expect(threadOverflowMenuPosition({ bottom: 80, right: 400 }, { innerWidth: 1000 })).toEqual({
      top: 84,
      right: 600,
      maxWidth: 392
    });
  });

  it('clamps to a viewport gutter when the trigger sits on the window edge', () => {
    expect(threadOverflowMenuPosition({ bottom: 80, right: 996 }, { innerWidth: 1000 })).toEqual({
      top: 84,
      right: 8,
      maxWidth: 984
    });
  });
});

describe('ThreadDetailOverflowMenu', () => {
  it('lists rename and archive', () => {
    const html = renderToStaticMarkup(
      <ThreadDetailOverflowMenu
        canStop={false}
        onUnread={() => undefined}
        onRename={() => undefined}
        onFork={() => undefined}
        onStop={() => undefined}
        onArchive={() => undefined}
        onCloseFollowup={() => undefined}
      />
    );
    expect(html).toContain('data-testid="thread-overflow-menu"');
    expect(html).toContain('Mark unread');
    expect(html).toContain('Rename');
    expect(html).toContain('Fork');
    expect(html).toContain('Close with follow-up');
    expect(html).toContain('Archive');
    expect(html).not.toContain('Stop');
    expect(html).toContain('tab-context-danger');
  });

  it('adds Stop while the thread is busy', () => {
    const html = renderToStaticMarkup(
      <ThreadDetailOverflowMenu
        canStop
        onUnread={() => undefined}
        onRename={() => undefined}
        onFork={() => undefined}
        onStop={() => undefined}
        onArchive={() => undefined}
        onCloseFollowup={() => undefined}
      />
    );
    expect(html).toContain('Stop');
  });
});

describe('ThreadDetailOverflow wiring', () => {
  it('opens from the header trigger and persists rename through product.threads.rename', () => {
    const source = readFileSync(new URL('./ThreadDetailOverflow.tsx', import.meta.url), 'utf8');
    expect(source).toContain('data-testid="thread-overflow-trigger"');
    expect(source).toContain('SHOW_THREAD_UNREAD = true');
    expect(source).toContain('product.threads.unread');
    expect(source).toContain('product.threads.rename');
    expect(source).toContain('product.threads.fork');
    expect(source).toContain('product.threads.archive');
    expect(source).toContain('product.threads.closeFollowup');
    expect(source).toContain('product.threads.stop');
    expect(source).toContain('<PromptModal');
    expect(source).toContain('shouldShowThreadStop');
    expect(source).toContain('inFlightRetry');
    expect(source).toContain('createPortal(menu, document.body)');
    expect(source).toContain('threadOverflowMenuPosition(rect, window)');
    expect(source).toContain('queueMicrotask(() => setRenaming(true))');
    expect(source).toContain('onRenamed?.(next)');
  });

  it('stacks the portaled menu above the modal backdrop', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    const backdrop = css.slice(
      css.indexOf('.modal-backdrop {'),
      css.indexOf('.modal {')
    );
    const overflow = css.slice(
      css.indexOf('.thread-detail-overflow-menu {'),
      css.indexOf('.thread-status-badge {')
    );
    expect(backdrop).toContain('z-index: 100;');
    expect(overflow).toContain('z-index: 110;');
  });
});
