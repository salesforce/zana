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
    const projectIds = ['inbox', 'agents', 'feed', 'terminals'];
    expect(
      normalizeSidebarNavOrder(['feed', 'inbox', 'terminals'], projectIds, ['inbox'])
    ).toEqual(['inbox', 'feed', 'terminals', 'agents']);
    expect(
      reorderSidebarNavItems(projectIds, 'inbox', 'feed', ['inbox'])
    ).toEqual(projectIds);
  });

  it('maps the retired Agents collection onto the Agents destination', () => {
    expect(
      normalizeSidebarNavOrder(
        ['home', 'inbox', 'sidebar-section:agents', 'scheduler'],
        ['home', 'inbox', 'agents', 'scheduler']
      )
    ).toEqual(['home', 'inbox', 'agents', 'scheduler']);
    expect(
      normalizeSidebarNavOrder(
        ['inbox', 'feed', 'sidebar-section:agents'],
        ['inbox', 'agents', 'feed', 'terminals'],
        ['inbox']
      )
    ).toEqual(['inbox', 'feed', 'agents', 'terminals']);
  });

  it('persists collection sections alongside ordinary destinations', () => {
    const sections = ['home', 'inbox', 'agents', 'scheduler', 'sidebar-section:workspaces'];
    expect(reorderSidebarNavItems(sections, 'sidebar-section:workspaces', 'scheduler')).toEqual([
      'home', 'inbox', 'agents', 'sidebar-section:workspaces', 'scheduler'
    ]);
  });
});
