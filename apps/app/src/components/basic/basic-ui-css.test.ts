import { describe, expect, it } from 'vitest';
import { readSourceText } from '../../__tests__/helpers/source-text.js';

const css = readSourceText(new URL('./basic-ui.css', import.meta.url));

describe('Basic UI mobile header geometry', () => {
  it('keeps the compact menu inset and reserves header space for the conversation slots', () => {
    expect(css).toContain(".app-shell.basic-ui[data-mobile='true'] .titlebar { padding-left: 12px; }");
    expect(css).toContain(".titlebar:has(.mobile-thread-title-slot:not(:empty)) .basic-ui-shell-heading { margin-right: 0; flex-shrink: 0; }");
  });
});
