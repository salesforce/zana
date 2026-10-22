import { hasDesktopBridge } from './app-surface.js';
import { product } from './product-client.js';

/**
 * Copy text to the system clipboard. Prefer Electron's main-process clipboard
 * — Chromium's `navigator.clipboard` is denied here (the session permission
 * handler only grants `media`), so the web API throws "Failed to copy path"
 * style errors in the desktop renderer.
 */
export async function copyText(text: string): Promise<void> {
  await writeClipboard(text, false);
}

/**
 * Like `copyText`, but rejects with `Clipboard unavailable` when there is no
 * clipboard at all (plain-http browser origins), so a caller that shows
 * "Copied" never reports a copy that didn't happen.
 */
export async function copyTextOrFail(text: string): Promise<void> {
  await writeClipboard(text, true);
}

async function writeClipboard(text: string, required: boolean): Promise<void> {
  if (hasDesktopBridge()) {
    try {
      const result = await product.clipboard.writeText(text);
      if (result?.ok !== false) return;
    } catch {
      // Fall through to the web clipboard when the desktop write fails.
    }
  }
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard) {
    if (required) throw new Error('Clipboard unavailable');
    return;
  }
  await clipboard.writeText(text);
}
