import type { SidebarMode } from '../store.js';

export interface SidebarShellState {
  /** Mode actually rendered (Settings/Plugins force a stored rail to expanded). */
  effectiveMode: SidebarMode;
  railVariant: 'expanded' | 'rail';
  /** Root `.app-shell` class fragment for the rail width override. */
  railClass: 'sidebar-is-rail' | '';
  /** Trigger override; only the compact layout drives it from the drawer state. */
  overlayCollapsed: boolean | undefined;
}

/**
 * Settings / Plugins list text-only categories, so they show the sidebar
 * expanded while rail is selected, without writing state. The compact layout
 * never gets rail.
 */
export function resolveSidebarShellState(input: {
  isCompact: boolean;
  sidebarMode: SidebarMode;
  shellRail: string;
  sidebarCollapsed: boolean;
}): SidebarShellState {
  const textOnlyPane = input.shellRail === 'settings' || input.shellRail === 'extensions';
  const effectiveMode: SidebarMode =
    input.isCompact || (input.sidebarMode === 'rail' && textOnlyPane) ? 'expanded' : input.sidebarMode;
  const rail = effectiveMode === 'rail';
  return {
    effectiveMode,
    railVariant: rail ? 'rail' : 'expanded',
    railClass: rail ? 'sidebar-is-rail' : '',
    overlayCollapsed: input.isCompact ? input.sidebarCollapsed : undefined
  };
}
