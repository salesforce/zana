// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openThreadFind, registerThreadFindTarget, threadFindClaims } from '../../lib/thread-find.js';
import MarkdownPreview from './MarkdownPreview';

const DOC_PATH = '/repo/notes.md';
const DOC = [
  '# Threads',
  '',
  'A **thr*ea*d** is a conversation. Search the thread with [thread links](https://example.com/thread).',
  '',
  '| Name |',
  '| --- |',
  '| Thread row |'
].join('\n');

class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) { this.ranges = ranges; }
}

let registry: Map<string, FakeHighlight>;
let scrolled: Element[];

beforeEach(() => {
  Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
  localStorage.clear();
  registry = new Map();
  scrolled = [];
  vi.stubGlobal('CSS', { highlights: registry });
  vi.stubGlobal('Highlight', FakeHighlight);
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value(this: Element) { scrolled.push(this); },
    configurable: true
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

function renderPreview(content = DOC) {
  const view = render(<MarkdownPreview content={content} documentPath={DOC_PATH} />);
  const host = view.container.querySelector<HTMLElement>('[data-own-find]')!;
  return { ...view, host, text: view.container.querySelector('.inbox-md')! };
}

function pressCtrlF(target: Element) {
  fireEvent.keyDown(target, { key: 'f', ctrlKey: true });
}

function openFind(content?: string) {
  const preview = renderPreview(content);
  pressCtrlF(preview.text);
  return { ...preview, input: screen.getByRole('searchbox', { name: 'Find in preview' }) as HTMLInputElement };
}

function type(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

const counter = () => screen.getByTestId('dom-find-bar-count').textContent;
const paintedUnder = (prefix: string) => {
  const key = [...registry.keys()].find((name) => name.startsWith(prefix));
  return key ? registry.get(key)!.ranges.map((range) => range.toString()) : undefined;
};
const matchesPainted = () => paintedUnder('find-match-');
const currentPainted = () => paintedUnder('find-current-');

describe('Ctrl+F routing', () => {
  it('opens the preview find, not thread find, while a primary thread is mounted', () => {
    const open = vi.fn();
    const root = document.createElement('section');
    const main = document.createElement('div');
    root.append(main);
    document.body.append(root);
    const unregister = registerThreadFindTarget({ root: () => root, main: () => main, isPrimary: () => true, open });
    try {
      const { text } = renderPreview();
      let threadClaimed = true;
      let threadOpened = true;
      // Same order as the window-level handler: thread find first, then the surface.
      window.addEventListener('keydown', (event) => {
        threadClaimed = threadFindClaims(event);
        threadOpened = openThreadFind(event);
      }, { capture: true, once: true });
      act(() => { pressCtrlF(text); });
      expect(threadClaimed).toBe(false);
      expect(threadOpened).toBe(false);
      expect(open).not.toHaveBeenCalled();
      expect(screen.getByRole('searchbox', { name: 'Find in preview' })).toBeTruthy();
    } finally {
      unregister();
      root.remove();
    }
  });

  it('only answers the find chord', () => {
    const { text } = renderPreview();
    fireEvent.keyDown(text, { key: 'g', ctrlKey: true });
    expect(screen.queryByRole('searchbox')).toBeNull();
    pressCtrlF(text);
    expect(screen.getByRole('searchbox')).toBeTruthy();
  });
});

describe('matching and highlights', () => {
  it('counts rendered text only and highlights the same ranges', () => {
    const { input } = openFind();
    type(input, 'thread');
    // heading, markup-spanning word, prose, link text and table row; not the URL.
    expect(counter()).toBe('1/5');
    expect(matchesPainted()).toEqual(['Thread', 'thread', 'thread', 'thread', 'Thread']);
    expect(currentPainted()).toEqual(['Thread']);
  });

  it('shows 0/0 and no highlights without a match', () => {
    const { input } = openFind();
    type(input, 'zzz');
    expect(counter()).toBe('0/0');
    expect(registry.size).toBe(0);
  });

  it('scrolls the current match into view', () => {
    const { input } = openFind();
    type(input, 'row');
    expect(scrolled.at(-1)?.textContent).toBe('Thread row');
  });

  it('re-counts when the document changes while the bar is open', () => {
    const { input, rerender } = openFind('one one');
    type(input, 'one');
    expect(counter()).toBe('1/2');
    rerender(<MarkdownPreview content="one" documentPath={DOC_PATH} />);
    expect(counter()).toBe('1/1');
  });
});

describe('keyboard navigation', () => {
  it('Enter and Shift+Enter step through matches and wrap', () => {
    const { input } = openFind('a b a b a');
    type(input, 'a');
    expect(counter()).toBe('1/3');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(counter()).toBe('2/3');
    expect(currentPainted()).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(counter()).toBe('1/3');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(counter()).toBe('3/3');
  });

  it('F3 and Shift+F3 step from the field or from the document', () => {
    const { input, text } = openFind('a b a b a');
    type(input, 'a');
    fireEvent.keyDown(input, { key: 'F3' });
    expect(counter()).toBe('2/3');
    fireEvent.keyDown(text, { key: 'F3', shiftKey: true });
    expect(counter()).toBe('1/3');
  });

  it('the next and previous buttons step, and are disabled without matches', () => {
    const { input } = openFind('a b a');
    type(input, 'a');
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    expect(counter()).toBe('2/2');
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(counter()).toBe('1/2');
    type(input, 'zzz');
    expect((screen.getByRole('button', { name: 'Next match' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(counter()).toBe('0/0');
  });

  it('ignores Enter while an IME composition is active', () => {
    const { input } = openFind('a b a');
    type(input, 'a');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(counter()).toBe('1/2');
  });

  it('F3 does nothing while the bar is closed', () => {
    const { text } = renderPreview();
    fireEvent.keyDown(text, { key: 'F3' });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('pressing Ctrl+F again refocuses the field', () => {
    const { input, text } = openFind();
    type(input, 'thread');
    input.blur();
    pressCtrlF(text);
    expect(document.activeElement).toBe(input);
  });
});

describe('Esc', () => {
  it('closes the bar, clears the highlights and restores focus to the preview', () => {
    const { input, host } = openFind();
    type(input, 'thread');
    expect(registry.size).toBeGreaterThan(0);
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    fireEvent.keyDown(input, { key: 'Escape' });
    document.removeEventListener('keydown', outer);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(registry.size).toBe(0);
    expect(document.activeElement).toBe(host);
    expect(outer).not.toHaveBeenCalled();
  });

  it('the close button does the same', () => {
    const { input, host } = openFind();
    type(input, 'thread');
    fireEvent.click(screen.getByRole('button', { name: 'Close find' }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(document.activeElement).toBe(host);
  });

  it('Esc with the bar closed is left alone', () => {
    const { text } = renderPreview();
    expect(fireEvent.keyDown(text, { key: 'Escape' })).toBe(true);
  });

  it('clears highlights when the preview unmounts with the bar open', () => {
    const { input, unmount } = openFind();
    type(input, 'thread');
    unmount();
    expect(registry.size).toBe(0);
  });
});

describe('several find surfaces', () => {
  it('a closed preview mounting or unmounting leaves another preview highlights alone', () => {
    const { input } = openFind();
    type(input, 'thread');
    const before = [...registry.keys()].sort();
    expect(before).toHaveLength(2);
    const other = render(<MarkdownPreview content="thread elsewhere" documentPath="/repo/other.md" />);
    expect([...registry.keys()].sort()).toEqual(before);
    other.unmount();
    expect([...registry.keys()].sort()).toEqual(before);
    expect(counter()).toBe('1/5');
  });

  it('two open previews paint under different names', () => {
    const first = openFind();
    type(first.input, 'thread');
    const second = render(<MarkdownPreview content="thread again" documentPath="/repo/two.md" />);
    pressCtrlF(second.container.querySelector('.inbox-md')!);
    fireEvent.change(second.container.querySelector('input[type="search"]')!, { target: { value: 'thread' } });
    expect(registry.size).toBe(4);
    second.unmount();
    expect(registry.size).toBe(2);
  });
});

describe('focus on open', () => {
  function viewer(withFocusInside: 'toggle' | 'tree' | 'none') {
    const section = document.createElement('section');
    section.className = 'explorer-viewer';
    const toggle = document.createElement('button');
    const tree = document.createElement('button');
    section.append(toggle);
    document.body.append(section, tree);
    if (withFocusInside === 'toggle') toggle.focus();
    if (withFocusInside === 'tree') tree.focus();
    const mount = document.createElement('div');
    section.append(mount);
    const view = render(<MarkdownPreview content={DOC} documentPath={DOC_PATH} />, { container: mount });
    return { view, section, tree, host: mount.querySelector<HTMLElement>('[data-own-find]')! };
  }

  it('focuses the preview when focus came from the viewer toolbar', () => {
    const { host, section, tree } = viewer('toggle');
    expect(document.activeElement).toBe(host);
    section.remove();
    tree.remove();
  });

  it('focuses the preview when nothing has focus', () => {
    const { host, section, tree } = viewer('none');
    expect(document.activeElement).toBe(host);
    section.remove();
    tree.remove();
  });

  it('leaves focus alone when the user is in the file tree', () => {
    const { host, section, tree } = viewer('tree');
    expect(document.activeElement).toBe(tree);
    expect(document.activeElement).not.toBe(host);
    section.remove();
    tree.remove();
  });
});
