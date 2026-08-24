import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PINNED_PROJECT_NAV_IDS,
  PROJECT_NAV_ORDER_KEY,
  GLOBAL_NAV_ORDER_KEY,
  useSortableSidebarNav
} from '../sidebarSortable.js';

function Probe({
  available,
  pinned
}: {
  available: string[];
  pinned: readonly string[];
}) {
  const { pinnedNavIds, sortableNavIds } = useSortableSidebarNav(
    PROJECT_NAV_ORDER_KEY,
    available,
    pinned
  );
  return (
    <div
      data-pinned={pinnedNavIds.join(',')}
      data-sortable={sortableNavIds.join(',')}
    />
  );
}

describe('sidebarSortable', () => {
  it('keeps the global and project rails on separate persisted orders', () => {
    expect(GLOBAL_NAV_ORDER_KEY).toBe('zcc.sidebarNavOrder');
    expect(PROJECT_NAV_ORDER_KEY).toBe('zcc.projectSidebarNavOrder');
    expect(PINNED_PROJECT_NAV_IDS).toEqual(['inbox']);
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

  it('uses translation-only transforms so collection sections keep their height', () => {
    const source = readFileSync(new URL('../sidebarSortable.tsx', import.meta.url), 'utf8');

    expect(source).toContain('CSS.Translate.toString(transform)');
    expect(source).not.toContain('CSS.Transform.toString(transform)');
    expect(source).toContain('animateLayoutChanges: disableSortableLayoutAnimation');
    expect(source).toContain('transition: undefined');
    expect(source).toContain('localStorage.setItem(storageKey');
    expect(source).toContain('activationConstraint: { distance: 6 }');
    expect(source).toContain('POST_DRAG_CLICK_SUPPRESS_MS');
  });
});
