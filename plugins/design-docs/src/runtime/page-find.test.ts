// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FromPage } from '../shared/frame-protocol.js';
import { createPageFind, findKeyFor } from './page-find.js';

function keyEvent(init: KeyboardEventInit & { key: string }) {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
}

const listeners: Array<[string, EventListenerOrEventListenerObject, unknown]> = [];

function setup(html: string) {
  document.body.innerHTML = html;
  // Each test's runtime listens on the shared document; take them off afterwards.
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    listeners.push([type, listener, options]);
    add(type, listener, options);
  });
  const sent: FromPage[] = [];
  const find = createPageFind(document, (message) => sent.push(message));
  const results = () => sent.filter((message): message is Extract<FromPage, { type: 'find-result' }> => message.type === 'find-result');
  return { find, sent, results };
}

afterEach(() => {
  for (const [type, listener, options] of listeners.splice(0)) document.removeEventListener(type, listener, options as boolean);
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('findKeyFor', () => {
  it('maps Ctrl/Cmd+F always, and F3 / Esc only while the bar is open', () => {
    expect(findKeyFor(keyEvent({ key: 'f', ctrlKey: true }), false)).toBe('open');
    expect(findKeyFor(keyEvent({ key: 'F', metaKey: true }), false)).toBe('open');
    expect(findKeyFor(keyEvent({ key: 'f', ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(findKeyFor(keyEvent({ key: 'F3' }), false)).toBeNull();
    expect(findKeyFor(keyEvent({ key: 'Escape' }), false)).toBeNull();
    expect(findKeyFor(keyEvent({ key: 'F3' }), true)).toBe('next');
    expect(findKeyFor(keyEvent({ key: 'F3', shiftKey: true }), true)).toBe('prev');
    expect(findKeyFor(keyEvent({ key: 'Escape' }), true)).toBe('close');
    expect(findKeyFor(keyEvent({ key: 'a' }), true)).toBeNull();
    // A non-Latin layout types another letter on the F key.
    expect(findKeyFor(keyEvent({ key: 'а', code: 'KeyF', ctrlKey: true }), false)).toBe('open');
  });
});

describe('createPageFind', () => {
  it('counts matches in the rendered text, across inline markup and not in hidden text', () => {
    const { find, results } = setup('<p>Retry <b>re</b>try</p><p hidden>retry</p><script>retry</script>');
    find.handle({ type: 'find', query: 'retry', step: 0 });
    expect(results().at(-1)).toEqual({ type: 'find-result', index: 0, count: 2 });
  });

  it('steps through matches and wraps, in both directions', () => {
    const { find, results } = setup('<p>a b a b a</p>');
    find.handle({ type: 'find', query: 'a', step: 0 });
    find.handle({ type: 'find', query: 'a', step: 1 });
    find.handle({ type: 'find', query: 'a', step: 1 });
    find.handle({ type: 'find', query: 'a', step: 1 });
    find.handle({ type: 'find', query: 'a', step: -1 });
    expect(results().map((result) => result.index)).toEqual([0, 1, 2, 0, 2]);
  });

  it('restarts at the first match when the query changes, and reports none when nothing matches', () => {
    const { find, results } = setup('<p>one two two</p>');
    find.handle({ type: 'find', query: 'two', step: 0 });
    find.handle({ type: 'find', query: 'two', step: 1 });
    find.handle({ type: 'find', query: 'one', step: 0 });
    find.handle({ type: 'find', query: 'zzz', step: 0 });
    expect(results().map(({ index, count }) => [index, count])).toEqual([[0, 2], [1, 2], [0, 1], [-1, 0]]);
  });

  it('paints highlights and scrolls the window to the current match, and clears them when closed', () => {
    const painted = new Map<string, unknown>();
    vi.stubGlobal('CSS', { highlights: { set: (name: string, value: unknown) => painted.set(name, value), delete: (name: string) => painted.delete(name) } });
    vi.stubGlobal('Highlight', class { constructor(public range: unknown) {} });
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const { find } = setup('<p>needle</p>');
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({ top: 1000, height: 20 } as DOMRect);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    find.handle({ type: 'find', query: 'needle', step: 0 });
    expect(painted.size).toBe(2);
    expect(scrollBy).toHaveBeenCalledWith(0, 710);
    find.handle({ type: 'find', query: null, step: 0 });
    expect(painted.size).toBe(0);
    vi.unstubAllGlobals();
  });

  it('recounts quietly when content arrives after the search', async () => {
    const { find, results } = setup('<p>alpha</p>');
    const scroll = vi.spyOn(window, 'scrollBy');
    find.handle({ type: 'find', query: 'alpha', step: 0 });
    expect(results().at(-1)!.count).toBe(1);
    scroll.mockClear();
    document.body.insertAdjacentHTML('beforeend', '<p>alpha again</p>');
    await vi.waitFor(() => expect(results().at(-1)!.count).toBe(2));
    expect(scroll).not.toHaveBeenCalled();
  });

  it('bounds the query length', () => {
    const { find, results } = setup(`<p>${'x'.repeat(400)}</p>`);
    find.handle({ type: 'find', query: 'x'.repeat(300), step: 0 });
    // Cut to 200 characters the query fits twice; uncut it would fit once.
    expect(results().at(-1)!.count).toBe(2);
  });

  it('hands the find keys back to the app, and leaves other keys alone', () => {
    const { find, sent } = setup('<p>text</p>');
    const open = keyEvent({ key: 'f', ctrlKey: true });
    document.body.dispatchEvent(open);
    expect(open.defaultPrevented).toBe(true);
    const idle = keyEvent({ key: 'Escape' });
    document.body.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);
    find.handle({ type: 'find', query: 'text', step: 0 });
    document.body.dispatchEvent(keyEvent({ key: 'Escape' }));
    document.body.dispatchEvent(keyEvent({ key: 'F3', shiftKey: true }));
    expect(sent.filter((message) => message.type === 'find-key')).toEqual([
      { type: 'find-key', key: 'open' },
      { type: 'find-key', key: 'close' },
      { type: 'find-key', key: 'prev' }
    ]);
  });
});
