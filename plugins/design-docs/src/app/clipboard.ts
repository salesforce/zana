/**
 * Clipboard write that works in the desktop app.
 *
 * The desktop session grants no clipboard permission, so
 * `navigator.clipboard.writeText` rejects there. The legacy `<textarea>` +
 * `document.execCommand('copy')` path still works, so we fall back to it.
 */

function copyViaTextarea(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-9999px';
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    previous?.focus();
  }
}

/** Copy `text`; resolves true when one of the two paths succeeded. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied in the desktop app; try the legacy path.
  }
  return copyViaTextarea(text);
}
