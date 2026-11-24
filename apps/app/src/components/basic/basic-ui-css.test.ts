import { describe, expect, it } from 'vitest';
import { readSourceText } from '../../__tests__/helpers/source-text.js';

const css = readSourceText(new URL('./basic-ui.css', import.meta.url));

describe('Basic UI mobile header geometry', () => {
  it('aligns the compact menu with the mode switch inset instead of the mobile return reserve', () => {
    expect(css).toContain(".app-shell.basic-ui[data-mobile='true'] .titlebar { padding-left: 12px; }");
    expect(css).toContain(".app-shell.basic-ui[data-mobile='true'] .basic-ui-mode-switch { right: 12px; }");
  });
});
