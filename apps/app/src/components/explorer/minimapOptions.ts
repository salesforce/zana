import type { editor } from 'monaco-editor';
import {
  EXPLORER_MINIMAP_MAX_COLUMN,
  EXPLORER_MINIMAP_MIN_EDITOR_WIDTH,
  type ExplorerMinimapPrefs
} from '@zana-ai/zcc-domain/product';

/**
 * True when the minimap is switched on but the editor is narrower than
 * {@link EXPLORER_MINIMAP_MIN_EDITOR_WIDTH} (a `0` width means "not measured
 * yet" and is preserved so the minimap does not flash off during initial mount).
 */
export function minimapAutoHidden(prefs: ExplorerMinimapPrefs, containerWidth: number): boolean {
  return prefs.enabled && containerWidth > 0 && containerWidth < EXPLORER_MINIMAP_MIN_EDITOR_WIDTH;
}

/** Monaco minimap options for the Explorer preview. */
export function minimapOptionsFor(
  prefs: ExplorerMinimapPrefs,
  containerWidth: number
): editor.IEditorMinimapOptions {
  if (!prefs.enabled || minimapAutoHidden(prefs, containerWidth)) return { enabled: false };
  return {
    enabled: true,
    side: prefs.side,
    renderCharacters: prefs.renderCharacters,
    size: prefs.verticalSize,
    scale: 1,
    showSlider: prefs.slider,
    maxColumn: EXPLORER_MINIMAP_MAX_COLUMN[prefs.width]
  };
}
