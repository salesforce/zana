export type ShellRail = 'primary' | 'settings' | 'extensions';

export interface ShellLayout {
  rail: ShellRail;
}

/**
 * Chooses which left rail the shell shows. Content is always the remaining
 * full track — panels that want list/detail chrome draw it inside themselves.
 * A project-locked Settings view keeps its project rail; only the global
 * Settings/Extensions routes replace the rail.
 */
export function resolveShellLayout(
  nav: string,
  isScopedProjectWindow: boolean
): ShellLayout {
  if (!isScopedProjectWindow && nav === 'settings') {
    return { rail: 'settings' };
  }
  if (!isScopedProjectWindow && nav === 'extensions') {
    return { rail: 'extensions' };
  }
  return { rail: 'primary' };
}
