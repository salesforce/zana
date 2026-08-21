import { describe, expect, it } from 'vitest';
import {
  normalizeSidebarNavOrder,
  reorderSidebarNavItems
} from './sidebarNavOrder.js';

describe('sidebar navigation order', () => {
  const available = ['home', 'inbox', 'agents', 'module-id'];

  it('normalizes stale preferences and appends available entries', () => {
    expect(normalizeSidebarNavOrder(['settings', 'settings', 'removed', 'home'], available)).toEqual([
      'home',
      'inbox',
      'agents',
      'module-id'
    ]);
  });

  it('keeps Home and Inbox first despite a saved custom order', () => {
    expect(
      normalizeSidebarNavOrder(['module-id', 'agents', 'inbox', 'home'], available)
    ).toEqual(['home', 'inbox', 'module-id', 'agents']);
  });

  it('keeps a temporarily unavailable module out of the current list', () => {
    expect(normalizeSidebarNavOrder(['module-id', 'home'], ['home', 'inbox'])).toEqual([
      'home',
      'inbox'
    ]);
  });

  it('moves one entry without changing the remaining relative order', () => {
    expect(reorderSidebarNavItems(available, 'module-id', 'agents')).toEqual([
      'home',
      'inbox',
      'module-id',
      'agents'
    ]);
  });

  it('leaves an invalid drag target unchanged', () => {
    expect(reorderSidebarNavItems(available, 'agents', 'unknown')).toEqual(available);
  });

  it('does not move either pinned navigation item', () => {
    expect(reorderSidebarNavItems(available, 'home', 'agents')).toEqual(available);
    expect(reorderSidebarNavItems(available, 'agents', 'inbox')).toEqual(available);
  });

  it('pins Inbox first on the project rail', () => {
    const projectIds = ['inbox', 'feed', 'terminals', 'sidebar-section:agents'];
    expect(
      normalizeSidebarNavOrder(['feed', 'inbox', 'terminals'], projectIds, ['inbox'])
    ).toEqual(['inbox', 'feed', 'terminals', 'sidebar-section:agents']);
    expect(
      reorderSidebarNavItems(projectIds, 'inbox', 'feed', ['inbox'])
    ).toEqual(projectIds);
  });

  it('persists collection sections alongside ordinary destinations', () => {
    const sections = ['home', 'inbox', 'scheduler', 'sidebar-section:agents', 'sidebar-section:workspaces'];
    expect(reorderSidebarNavItems(sections, 'sidebar-section:workspaces', 'scheduler')).toEqual([
      'home', 'inbox', 'sidebar-section:workspaces', 'scheduler', 'sidebar-section:agents'
    ]);
  });
});
