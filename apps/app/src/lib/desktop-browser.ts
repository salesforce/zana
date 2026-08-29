import type { DesktopBrowserApi } from '@zana-ai/zcc-desktop-contract';
import { hasDesktopBridge } from './app-surface.js';

export function getDesktopBrowserApi(): DesktopBrowserApi | null {
  if (!hasDesktopBridge()) return null;
  const browser = (window as unknown as { cc?: { browser?: DesktopBrowserApi } }).cc?.browser;
  return browser ?? null;
}
