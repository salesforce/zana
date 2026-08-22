import type { AppSurface } from './app-surface.js';

/** Shared geometry for the application-chrome sidebar trigger. */
export const SHELL_CHROME_HEIGHT = 38;
export const SIDEBAR_TRIGGER_SIZE = 28;
export const SIDEBAR_TRIGGER_GAP = 8;
export const BROWSER_SIDEBAR_TRIGGER_LEFT = 12;
export const BROWSER_COLLAPSED_LEADING_EDGE =
  BROWSER_SIDEBAR_TRIGGER_LEFT + SIDEBAR_TRIGGER_SIZE + SIDEBAR_TRIGGER_GAP;

export type ShellPlatform = 'macos' | 'other';

export function shellPlatform(): ShellPlatform {
  if (typeof navigator === 'undefined') return 'other';
  return navigator.platform.toUpperCase().includes('MAC') ? 'macos' : 'other';
}

/** Native window controls exist only in the Electron frame, never a browser tab. */
export function shouldReserveMacosTrafficLights(
  platform: ShellPlatform,
  isFullScreen: boolean,
  surface: AppSurface
): boolean {
  return surface === 'desktop' && platform === 'macos' && !isFullScreen;
}
