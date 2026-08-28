/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  LibraryMarkdownBubbleToolbar,
  LibraryMarkdownEditor,
  shouldShowLibraryBubble
} from './LibraryMarkdownEditor.js';
import { createLibraryMarkdownEditor } from './library-markdown.js';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const FRONT_MATTER = `---
id: note-1
title: Untitled idea
---
`;

const INITIAL = `${FRONT_MATTER}# Untitled idea\n\nHello world.\n`;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await flush();
  }
}

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <LibraryMarkdownEditor value={value} onChange={setValue} autofocus />
      <pre data-testid="draft">{value}</pre>
      <button type="button" data-testid="replace" onClick={() => setValue(`${FRONT_MATTER}# Replaced\n`)}>
        Replace
      </button>
      <button type="button" data-testid="clear-body" onClick={() => setValue(FRONT_MATTER.replace(/\n$/, '') + '\n')}>
        Clear
      </button>
    </>
  );
}

describe('LibraryMarkdownEditor', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
  });

  function mount(initial = INITIAL) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<Harness initial={initial} />);
    });
    return container;
  }

  it('wires a bubble toolbar and markdown contentType without the deprecated TipTap 2 plugin', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'LibraryMarkdownEditor.tsx'),
      'utf8'
    );
    expect(source).toContain('BubbleMenu');
    expect(source).toContain("contentType: initial.body ? 'markdown' : 'json'");
    expect(source).toContain('toggleTaskList');
    expect(source).not.toContain('tiptap-markdown');
  });

  it('hides front-matter, keeps it on parent edits, and reloads when the parent value changes', async () => {
    const el = mount();
    await waitFor(
      () => Boolean(el.querySelector('.library-md-editor-surface')),
      'editor surface'
    );

    const surface = el.querySelector('.library-md-editor-surface');
    expect(surface?.textContent).toContain('Untitled idea');
    expect(surface?.textContent).toContain('Hello world');
    expect(surface?.textContent).not.toContain('id: note-1');

    const draft = el.querySelector('[data-testid="draft"]')?.textContent ?? '';
    expect(draft.startsWith(FRONT_MATTER)).toBe(true);
    expect(draft).toContain('Untitled idea');

    await act(async () => {
      el.querySelector('[data-testid="replace"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    await waitFor(
      () => (el.querySelector('.library-md-editor-surface')?.textContent ?? '').includes('Replaced'),
      'replaced heading'
    );
    expect(el.querySelector('.library-md-editor-surface')?.textContent).not.toContain('Hello world');

    await act(async () => {
      el.querySelector('[data-testid="clear-body"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    await flush();
    expect(el.querySelector('[data-testid="draft"]')?.textContent?.startsWith('---')).toBe(true);
  });

  it('formats a selection from the bubble toolbar and hides the menu for an empty caret', async () => {
    const editor = createLibraryMarkdownEditor('Hello world');
    try {
      expect(
        shouldShowLibraryBubble({
          editor,
          state: editor.state,
          from: editor.state.selection.from,
          to: editor.state.selection.to
        })
      ).toBe(false);

      editor.commands.selectAll();
      expect(
        shouldShowLibraryBubble({
          editor,
          state: editor.state,
          from: editor.state.selection.from,
          to: editor.state.selection.to
        })
      ).toBe(true);

      editor.setEditable(false);
      expect(
        shouldShowLibraryBubble({
          editor,
          state: editor.state,
          from: editor.state.selection.from,
          to: editor.state.selection.to
        })
      ).toBe(false);
      editor.setEditable(true);

      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      act(() => {
        root!.render(<LibraryMarkdownBubbleToolbar editor={editor} />);
      });
      const bold = container.querySelector('[aria-label="Bold"]') as HTMLButtonElement;
      await act(async () => {
        bold.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        bold.click();
      });
      expect(editor.getMarkdown()).toMatch(/\*\*|__/);

      for (const label of ['Italic', 'Inline code', 'Heading', 'Bullet list', 'Checklist', 'Code block', 'Quote']) {
        const button = container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
        await act(async () => {
          button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          button.click();
        });
      }

      editor.commands.setTextSelection(1);
      editor.commands.selectAll();
      const selected = editor.state.selection;
      editor.commands.setNodeSelection(0);
      expect(
        shouldShowLibraryBubble({
          editor,
          state: editor.state,
          from: editor.state.selection.from,
          to: editor.state.selection.to
        })
      ).toBe(false);
      expect(selected.empty).toBe(false);
    } finally {
      editor.destroy();
    }
  });
});
