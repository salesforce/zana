import { describe, expect, it } from 'vitest';
import {
  EXPLORER_FILE_ICON_THEME_CHOICES,
  EXPLORER_FILE_ICON_THEME_DEFAULT,
  EXPLORER_FILE_ICON_THEME_LABELS,
  resolveExplorerFileIconTheme
} from './product.js';

describe('resolveExplorerFileIconTheme', () => {
  it('defaults to seti when unset', () => {
    expect(EXPLORER_FILE_ICON_THEME_DEFAULT).toBe('seti');
    expect(resolveExplorerFileIconTheme({})).toBe('seti');
  });

  it.each(EXPLORER_FILE_ICON_THEME_CHOICES)('keeps the valid theme %s', (theme) => {
    expect(resolveExplorerFileIconTheme({ explorerFileIconTheme: theme })).toBe(theme);
  });

  it('falls back to the default for an unknown value', () => {
    expect(resolveExplorerFileIconTheme({ explorerFileIconTheme: 'material' as never })).toBe('seti');
  });

  it('labels every choice', () => {
    for (const theme of EXPLORER_FILE_ICON_THEME_CHOICES) {
      expect(EXPLORER_FILE_ICON_THEME_LABELS[theme]).toBeTruthy();
    }
  });
});
