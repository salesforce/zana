/**
 * Clipboard write with a legacy fallback.
 *
 * `navigator.clipboard.writeText` frequently rejects in a sandboxed Electron
 * renderer (permission / focus requirements), which is why the naive
 * clipboard-only path surfaced "Failed to copy link". `copyText` tries the
 * modern API first, then falls back to a temporary `<textarea>` +
 * `document.execCommand('copy')`, which still works in that context.
 */

/** Legacy clipboard write via an off-screen <textarea>. Returns true on success. */
export function copyViaTextarea(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  ta.setAttribute('readonly', '');
  document.body.appendChild(ta);
  try {
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}

/** Copy `text`, preferring navigator.clipboard and falling back. Returns true on success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the execCommand fallback
  }
  return copyViaTextarea(text);
}
