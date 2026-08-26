import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadDetailOverflowMenu, threadOverflowMenuPosition } from './ThreadDetailOverflow.js';

describe('threadOverflowMenuPosition', () => {
  it('anchors the menu just below the trigger in viewport coords', () => {
    expect(threadOverflowMenuPosition({ bottom: 80, left: 24 })).toEqual({ top: 84, left: 24 });
  });
});

describe('ThreadDetailOverflowMenu', () => {
  it('lists unread, rename, fork, and archive', () => {
    const html = renderToStaticMarkup(
      <ThreadDetailOverflowMenu
        canStop={false}
        onUnread={() => undefined}
        onRename={() => undefined}
        onFork={() => undefined}
        onStop={() => undefined}
        onArchive={() => undefined}
      />
    );
    expect(html).toContain('data-testid="thread-overflow-menu"');
    expect(html).toContain('Mark unread');
    expect(html).toContain('Rename');
    expect(html).toContain('Fork');
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
      />
    );
    expect(html).toContain('Stop');
  });
});

describe('ThreadDetailOverflow wiring', () => {
  it('opens from the header trigger and persists rename through product.threads.rename', () => {
    const source = readFileSync(new URL('./ThreadDetailOverflow.tsx', import.meta.url), 'utf8');
    expect(source).toContain('data-testid="thread-overflow-trigger"');
    expect(source).toContain('product.threads.unread');
    expect(source).toContain('product.threads.rename');
    expect(source).toContain('product.threads.fork');
    expect(source).toContain('product.threads.archive');
    expect(source).toContain('product.threads.stop');
    expect(source).toContain('<PromptModal');
    expect(source).toContain('shouldShowThreadStop');
    expect(source).toContain('createPortal(menu, document.body)');
    expect(source).toContain('threadOverflowMenuPosition');
    expect(source).toContain('queueMicrotask(() => setRenaming(true))');
    expect(source).toContain('onRenamed?.(next)');
  });
});
