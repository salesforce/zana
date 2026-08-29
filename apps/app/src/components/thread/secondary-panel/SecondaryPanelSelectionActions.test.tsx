import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  COMPOSER_INSERT_EVENT,
  dispatchComposerInsert,
  readTrimmedSelection,
  SecondaryPanelSelectionActions
} from './SecondaryPanelSelectionActions.js';

describe('SecondaryPanelSelectionActions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches a composer insert event and ignores empty text', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    dispatchComposerInsert('t1', '  hello  ');
    dispatchComposerInsert('t1', '   ');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0]?.[0] as CustomEvent<{ threadId: string; text: string }>;
    expect(event.type).toBe(COMPOSER_INSERT_EVENT);
    expect(event.detail).toEqual({ threadId: 't1', text: 'hello' });
  });

  it('reads a live window selection and passes children through without a thread', () => {
    vi.stubGlobal('window', {
      getSelection: () => ({ toString: () => '  selected  ' })
    });
    expect(readTrimmedSelection()).toBe('selected');
    vi.stubGlobal('window', {
      getSelection: () => ({ toString: () => '   ' })
    });
    expect(readTrimmedSelection()).toBeNull();
    const html = renderToStaticMarkup(
      <SecondaryPanelSelectionActions>
        <pre>preview</pre>
      </SecondaryPanelSelectionActions>
    );
    expect(html).toContain('preview');
    expect(html).not.toContain('data-testid="thread-selection-host"');
    const wrapped = renderToStaticMarkup(
      <SecondaryPanelSelectionActions threadId="t1">
        <pre>preview</pre>
      </SecondaryPanelSelectionActions>
    );
    expect(wrapped).toContain('data-testid="thread-selection-host"');
    expect(wrapped).toContain('preview');
  });

  it('paints the add-to-chat chip with accent tokens so it stays visible on dark surfaces', () => {
    const css = readFileSync(fileURLToPath(new URL('../../../styles/global.css', import.meta.url)), 'utf8');
    const source = readFileSync(fileURLToPath(new URL('./SecondaryPanelSelectionActions.tsx', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.thread-selection-add \{[\s\S]*?background: var\(--accent-blue\);/);
    expect(css).toMatch(/\.thread-selection-add \{[\s\S]*?color: #fff;/);
    expect(css).not.toContain('background: var(--bg, var(--background));');
    expect(source).toContain('MessageSquarePlus');
    expect(source).toContain('Add to chat');
  });
});
