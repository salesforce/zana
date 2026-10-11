/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThreadSecondaryPanel } from './ThreadSecondaryPanel.js';
import { ThreadFilePreviewView } from './ThreadFilePreviewTab.js';
import {
  activeClosableTab,
  emptySecondaryPanelState,
  openSecondaryPanel,
  selectPinnedView,
  type ClosableSecondaryTab,
  type ThreadSecondaryPanelState
} from './threadSecondaryPanelState.js';

vi.mock('../../../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('../../../lib/product-client.js', () => ({ product: {} }));

afterEach(cleanup);

const handlers = {
  onSelectInfo: () => undefined, onSelectDiff: () => undefined, onNewTab: () => undefined,
  onCloseTab: () => undefined, onActivateTab: () => undefined, onToggleMaximized: () => undefined,
  onHide: () => undefined, onResize: () => undefined
};

const fileTab = (id: string, kind: ClosableSecondaryTab['kind'] = 'file-preview'): ClosableSecondaryTab =>
  ({ id, kind, title: `${id}.txt`, path: `${id}.txt` });
const browserTab: ClosableSecondaryTab = { id: 'web', kind: 'browser', title: 'Docs site', url: 'https://example.com' };

function panelState(tabs: ClosableSecondaryTab[], activeId: string): ThreadSecondaryPanelState {
  return { ...openSecondaryPanel(emptySecondaryPanelState()), tabs, activeId };
}

// Mirrors the real hosts: one preview element in one slot, reused as the active tab changes.
function Host({ state, loading = [] }: { state: ThreadSecondaryPanelState; loading?: string[] }) {
  const tab = activeClosableTab(state);
  return (
    <ThreadSecondaryPanel state={state} {...handlers}>
      {tab?.kind === 'browser'
        ? <div data-testid="browser-surface" />
        : <ThreadFilePreviewView
            path={tab?.path ?? 'pinned.txt'}
            content={tab && loading.includes(tab.id) ? null : `body of ${tab?.id ?? 'pin'}`}
            error={null}
          />}
    </ThreadSecondaryPanel>
  );
}

const preview = (view: ReturnType<typeof render>) => view.getByTestId('thread-file-preview');
function scrollTo(node: HTMLElement, scrollTop: number) {
  node.scrollTop = scrollTop;
  fireEvent.scroll(node);
}

describe('secondary panel file preview scroll retention', () => {
  it.each(['file-preview', 'storage-preview'] as const)(
    'restores a %s reading offset after a visit to another surface',
    (kind) => {
      const tabs = [fileTab('doc', kind), browserTab];
      const view = render(<Host state={panelState(tabs, 'doc')} />);
      scrollTo(preview(view), 640);

      view.rerender(<Host state={panelState(tabs, 'web')} />);
      expect(view.queryByTestId('thread-file-preview')).toBeNull();
      expect(view.getByTestId('browser-surface')).toBeTruthy();

      view.rerender(<Host state={panelState(tabs, 'doc')} />);
      expect(preview(view).scrollTop).toBe(640);
    }
  );

  it('keeps a separate offset for every open file tab', () => {
    const tabs = [fileTab('a'), fileTab('b')];
    const view = render(<Host state={panelState(tabs, 'a')} />);
    scrollTo(preview(view), 300);

    view.rerender(<Host state={panelState(tabs, 'b')} />);
    expect(preview(view).scrollTop).toBe(0);
    scrollTo(preview(view), 900);

    view.rerender(<Host state={panelState(tabs, 'a')} />);
    expect(preview(view).scrollTop).toBe(300);
    view.rerender(<Host state={panelState(tabs, 'b')} />);
    expect(preview(view).scrollTop).toBe(900);
  });

  it('waits for the ready document instead of restoring against a loading skeleton', () => {
    const tabs = [fileTab('doc'), browserTab];
    const view = render(<Host state={panelState(tabs, 'doc')} />);
    scrollTo(preview(view), 500);
    view.rerender(<Host state={panelState(tabs, 'web')} />);

    view.rerender(<Host state={panelState(tabs, 'doc')} loading={['doc']} />);
    expect(view.queryByTestId('thread-file-preview')).toBeNull();
    expect(view.getByLabelText('Loading file')).toBeTruthy();

    view.rerender(<Host state={panelState(tabs, 'doc')} />);
    expect(preview(view).scrollTop).toBe(500);
  });

  it('does not save the offset a layout clamp reports while the document is leaving', () => {
    const tabs = [fileTab('doc'), browserTab];
    const view = render(<Host state={panelState(tabs, 'doc')} />);
    const leaving = preview(view);
    scrollTo(leaving, 700);

    view.rerender(<Host state={panelState(tabs, 'web')} />);
    leaving.scrollTop = 0;
    fireEvent.scroll(leaving);

    view.rerender(<Host state={panelState(tabs, 'doc')} />);
    expect(preview(view).scrollTop).toBe(700);
  });

  it('forgets a closed tab, so reopening the same id starts at the top', () => {
    const tabs = [fileTab('a'), fileTab('b')];
    const view = render(<Host state={panelState(tabs, 'a')} />);
    scrollTo(preview(view), 400);

    view.rerender(<Host state={panelState([fileTab('b')], 'b')} />);
    view.rerender(<Host state={panelState(tabs, 'a')} />);
    expect(preview(view).scrollTop).toBe(0);
  });

  it('keeps the offset of tabs that stay open when another tab closes', () => {
    const tabs = [fileTab('a'), fileTab('b'), fileTab('c')];
    const view = render(<Host state={panelState(tabs, 'a')} />);
    scrollTo(preview(view), 250);
    view.rerender(<Host state={panelState(tabs, 'c')} />);
    scrollTo(preview(view), 60);
    view.rerender(<Host state={panelState(tabs, 'b')} />);
    scrollTo(preview(view), 75);

    const remaining = [tabs[0]!, tabs[1]!];
    view.rerender(<Host state={panelState(remaining, 'a')} />);
    expect(preview(view).scrollTop).toBe(250);
    view.rerender(<Host state={panelState(remaining, 'b')} />);
    expect(preview(view).scrollTop).toBe(75);
  });

  it('retains nothing for pinned views or non-file tabs', () => {
    const tabs = [fileTab('a'), { id: 'plug', kind: 'plugin' as const, title: 'Plugin' }];
    const view = render(<Host state={selectPinnedView(panelState(tabs, 'a'), 'info')} />);
    scrollTo(preview(view), 120);
    view.rerender(<Host state={panelState(tabs, 'plug')} />);
    scrollTo(preview(view), 130);

    view.rerender(<Host state={panelState(tabs, 'a')} />);
    expect(preview(view).scrollTop).toBe(0);
    view.rerender(<Host state={selectPinnedView(panelState(tabs, 'a'), 'info')} />);
    expect(preview(view).scrollTop).toBe(0);
  });

  it('restores each tab when two tabs share one document and DOM node', () => {
    const twin = (id: string): ClosableSecondaryTab => ({ id, kind: 'file-preview', title: 'same.txt', path: 'same.txt' });
    const tabs = [twin('one'), twin('two')];
    const view = render(<Host state={panelState(tabs, 'one')} />);
    const node = preview(view);
    scrollTo(node, 111);
    view.rerender(<Host state={panelState(tabs, 'two')} />);
    expect(preview(view)).toBe(node);
    expect(node.scrollTop).toBe(0);
    scrollTo(node, 222);
    view.rerender(<Host state={panelState(tabs, 'one')} />);
    expect(node.scrollTop).toBe(111);
  });
});
