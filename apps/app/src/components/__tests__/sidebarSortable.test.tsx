import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PINNED_PROJECT_NAV_IDS,
  PROJECT_NAV_ORDER_KEY,
  GLOBAL_NAV_ORDER_KEY,
  TRAILING_PROJECT_NAV_IDS,
  useSortableSidebarNav
} from '../sidebarSortable.js';

function Probe({
  available,
  pinned,
  trailing = []
}: {
  available: string[];
  pinned: readonly string[];
  trailing?: readonly string[];
}) {
  const { pinnedNavIds, sortableNavIds, trailingNavIds } = useSortableSidebarNav(
    PROJECT_NAV_ORDER_KEY,
    available,
    pinned,
    trailing
  );
  return (
    <div
      data-pinned={pinnedNavIds.join(',')}
      data-sortable={sortableNavIds.join(',')}
      data-trailing={trailingNavIds.join(',')}
    />
  );
}

describe('sidebarSortable', () => {
  it('keeps the global and project rails on separate persisted orders', () => {
    expect(GLOBAL_NAV_ORDER_KEY).toBe('zcc.sidebarNavOrder');
    expect(PROJECT_NAV_ORDER_KEY).toBe('zcc.projectSidebarNavOrder');
    expect(PINNED_PROJECT_NAV_IDS).toEqual(['inbox']);
    expect(TRAILING_PROJECT_NAV_IDS).toEqual(['sidebar-section:project-sessions']);
  });

  it('pins Inbox and leaves Agents movable on the project rail', () => {
    const markup = renderToStaticMarkup(
      <Probe
        available={['inbox', 'agents', 'feed', 'terminals']}
        pinned={PINNED_PROJECT_NAV_IDS}
      />
    );

    expect(markup).toContain('data-pinned="inbox"');
    expect(markup).toContain('data-sortable="agents,feed,terminals"');
  });

  it('keeps the Project session tree last and out of the sortable destinations', () => {
    const markup = renderToStaticMarkup(
      <Probe
        available={['inbox', 'agents', 'feed', 'sidebar-section:project-sessions']}
        pinned={PINNED_PROJECT_NAV_IDS}
        trailing={TRAILING_PROJECT_NAV_IDS}
      />
    );

    expect(markup).toContain('data-pinned="inbox"');
    expect(markup).toContain('data-sortable="agents,feed"');
    expect(markup).toContain('data-trailing="sidebar-section:project-sessions"');
  });

  it('uses translation-only transforms so collection sections keep their height', () => {
    const source = readFileSync(new URL('../sidebarSortable.tsx', import.meta.url), 'utf8');

    expect(source).toContain('CSS.Translate.toString(transform)');
    expect(source).not.toContain('CSS.Transform.toString(transform)');
    expect(source).toContain('animateLayoutChanges: disableSortableLayoutAnimation');
    expect(source).toContain('transition: undefined');
    expect(source).toContain('localStorage.setItem(storageKey');
    expect(source).toContain('activationConstraint: { distance: 6 }');
    expect(source).toContain('suppressPostDragClick()');
    expect(source).toContain('POST_DRAG_CLICK_SUPPRESS_MS');
  });
});
