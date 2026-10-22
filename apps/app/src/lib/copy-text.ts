import { hasDesktopBridge } from './app-surface.js';
import { product } from './product-client.js';

/**
 * Copy text to the system clipboard. Prefer Electron's main-process clipboard
 * — Chromium's `navigator.clipboard` is denied here (the session permission
 * handler only grants `media`), so the web API throws "Failed to copy path"
 * style errors in the desktop renderer.
 */
export async function copyText(text: string): Promise<void> {
  if (hasDesktopBridge()) {
    try {
      const result = await product.clipboard.writeText(text);
      if (result?.ok !== false) return;
    } catch {
      // Fall through to the web clipboard when the desktop write fails.
    }
  }
  // Insecure (plain http) browser origins have no `navigator.clipboard`.
  // Reject rather than resolve, so callers don't report a copy that never
  // happened.
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard) throw new Error('Clipboard unavailable');
  await clipboard.writeText(text);
}
