import type { KeyboardEvent } from 'react';
import { shortcutForCommand } from '../../../../apps/app/src/lib/keyboard-shortcut-settings.js';

/** Accessible name of the doc list's search box; Ctrl+F elsewhere in the panel focuses it by this. */
export const DOC_SEARCH_LABEL = 'Search design docs';

/**
 * True when this key press is Ctrl+F (`thread.find`) and nothing inside the
 * panel took it already. A pane with its own find (the doc content, the
 * comments) calls `preventDefault`; the code editor keeps its own find too.
 * Whoever gets `true` handles the key, so it never reaches thread search.
 */
export function panelFindKey(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.defaultPrevented || !shortcutForCommand('thread.find', event.nativeEvent)) return false;
  return !(event.target as Element | null)?.closest?.('.monaco-editor');
}
