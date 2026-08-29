/**
 * Distinguishes the Electron renderer (preload chrome present) from a regular
 * browser tab. Product I/O does not live on this object — browsers talk HTTP.
 */
export type AppSurface = 'desktop' | 'web';

export function hasDesktopBridge(): boolean {
  return typeof window !== 'undefined' && 'cc' in window && window.cc != null;
}

export function hasDesktopChrome(): boolean {
  return typeof window !== 'undefined' && 'zccDesktop' in window;
}

export function getAppSurface(): AppSurface {
  return hasDesktopBridge() || hasDesktopChrome() ? 'desktop' : 'web';
}
