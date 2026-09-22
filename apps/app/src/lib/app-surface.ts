import { getNativeShell } from './native-shell.js';
/**
 * Distinguishes the Electron renderer (preload chrome present) from a regular
 * browser tab. Product I/O does not live on this object — browsers talk HTTP.
 */
export type AppSurface = 'desktop' | 'web' | 'mobile';

export function hasDesktopBridge(): boolean {
  return typeof window !== 'undefined' && 'cc' in window && window.cc != null;
}

export function hasDesktopChrome(): boolean {
  return typeof window !== 'undefined' && 'zccDesktop' in window;
}

export function getAppSurface(): AppSurface {
  if (hasDesktopBridge() || hasDesktopChrome()) return 'desktop';
  return getNativeShell() ? 'mobile' : 'web';
}
