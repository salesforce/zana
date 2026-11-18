import { describe, expect, it } from 'vitest';
import { resolveSidebarShellState } from './sidebar-shell-state.js';

const base = { isCompact: false, sidebarMode: 'rail', shellRail: 'projects', sidebarCollapsed: false } as const;

describe('resolveSidebarShellState', () => {
  it('keeps rail on ordinary panes', () => {
    expect(resolveSidebarShellState(base)).toEqual({
      effectiveMode: 'rail', railVariant: 'rail', railClass: 'sidebar-is-rail', overlayCollapsed: undefined
    });
  });

  it.each(['settings', 'extensions'])('shows rail expanded on the %s pane', (shellRail) => {
    const s = resolveSidebarShellState({ ...base, shellRail });
    expect(s).toMatchObject({ effectiveMode: 'expanded', railVariant: 'expanded', railClass: '' });
  });

  it('never gives the compact layout rail and lets the drawer drive the trigger', () => {
    const s = resolveSidebarShellState({ ...base, isCompact: true, sidebarCollapsed: true });
    expect(s).toMatchObject({ effectiveMode: 'expanded', railClass: '', overlayCollapsed: true });
  });

  it.each(['expanded', 'hidden'] as const)('passes %s through unchanged', (sidebarMode) => {
    const s = resolveSidebarShellState({ ...base, sidebarMode, shellRail: 'settings' });
    expect(s.effectiveMode).toBe(sidebarMode);
    expect(s.railVariant).toBe('expanded');
  });
});
