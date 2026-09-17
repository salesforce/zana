import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readTrimmedSelection } from './SecondaryPanelSelectionActions.js';

describe('SecondaryPanelSelectionActions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads a live window selection', () => {
    vi.stubGlobal('window', {
      getSelection: () => ({ toString: () => '  selected  ' })
    });
    expect(readTrimmedSelection()).toBe('selected');
    vi.stubGlobal('window', {
      getSelection: () => ({ toString: () => '   ' })
    });
    expect(readTrimmedSelection()).toBeNull();
  });

  it('does not paint an add-to-chat overlay on selected text', () => {
    const css = readFileSync(fileURLToPath(new URL('../../../styles/global.css', import.meta.url)), 'utf8');
    const source = readFileSync(fileURLToPath(new URL('./SecondaryPanelSelectionActions.tsx', import.meta.url)), 'utf8');
    expect(source).not.toContain('Add to chat');
    expect(source).not.toContain('thread-selection-add');
    expect(source).not.toContain('SecondaryPanelSelectionActions');
    expect(css).not.toContain('.thread-selection-add');
  });
});
